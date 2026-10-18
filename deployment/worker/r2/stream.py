#!/usr/bin/env python3
"""Archive completed study images through the existing Chorus R2 helpers."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import threading
import time

import chorus_r2sync as upstream

ROOT = Path('/workspace/artwork/r2')
JOBS = Path('/workspace/artwork/jobs')
EXTRA_JOBS = (Path('/workspace/artwork-flux1-gpu1/jobs'),)
PREFIX = 'artwork-comparison/2026-10-17-flux-study/'
INDEX_KEY = PREFIX + 'index.json'


def job_stores():
    """Both native lanes feed the same lock-holding archive/index writer."""
    return (JOBS, *EXTRA_JOBS)


def atomic_json(path, value):
    """Commit restart state before acknowledging an archive operation."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.part')
    with temporary.open('w') as out:
        json.dump(value, out, sort_keys=True)
        out.write('\n')
        out.flush()
        os.fsync(out.fileno())
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def error_code(exc):
    response = getattr(exc, 'response', {})
    return str(response.get('Error', {}).get('Code', type(exc).__name__))[:80]


class ImmutableUploads:
    """Preserve Chorus's upload helper while enforcing conditional writes."""
    def __init__(self, s3):
        self.s3 = s3
        self.proofs = {}
        self.expected = {}

    def verify(self, bucket, key, expected, size):
        try:
            head = self.s3.head_object(Bucket=bucket, Key=key)
        except Exception as exc:
            if error_code(exc) in ('404', 'NoSuchKey', 'NotFound'):
                return None
            raise
        if head['ContentLength'] != size:
            raise ValueError('Existing R2 object has conflicting size')
        stored = head.get('Metadata', {}).get('sha256')
        if stored is not None and stored != expected:
            raise ValueError('Existing R2 object has conflicting SHA-256 metadata')
        # Verify actual remote bytes, including objects carrying our metadata.
        # Metadata alone does not establish that the object content is intact.
        response = self.s3.get_object(Bucket=bucket, Key=key)
        digest = hashlib.sha256()
        with response['Body'] as body:
            for chunk in iter(lambda: body.read(1024 * 1024), b''):
                digest.update(chunk)
        if digest.hexdigest() != expected:
            raise ValueError('Existing R2 object has conflicting SHA-256')
        return {'key': key, 'sha256': expected, 'bytes': size,
                'etag': head.get('ETag'), 'verifiedAt': time.time(),
                'verification': 'HEAD size and GET SHA-256'}

    def upload_file(self, filename, bucket, key, ExtraArgs):
        if not key.startswith(PREFIX):
            raise ValueError('Object is outside this study prefix')
        path = Path(filename)
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if self.expected.get(key) != digest:
            raise ValueError('Local file changed after its generation receipt was checked')
        proof = self.verify(bucket, key, digest, len(data))
        if proof is None:
            try:
                self.s3.put_object(Bucket=bucket, Key=key, Body=data,
                                   ContentType=ExtraArgs['ContentType'],
                                   Metadata={'sha256': digest}, IfNoneMatch='*')
            except Exception as exc:
                # A simultaneous writer may have won the conditional PUT.
                # Reconcile exact bytes; never retry as an unconditional PUT.
                if error_code(exc) not in ('PreconditionFailed', '412', 'ConditionalRequestConflict', '409'):
                    raise
            proof = self.verify(bucket, key, digest, len(data))
            if proof is None:
                raise ValueError('Uploaded object is not visible for verification')
        self.proofs[key] = proof


class StudyIndex:
    """One mutable index, retaining previously archived jobs in this prefix."""
    def __init__(self, s3, bucket):
        self.s3, self.bucket = s3, bucket
        self.jobs, self.pending, self.etag = {}, {}, None
        self.last_publish = 0
        self.load()

    def load(self):
        try:
            response = self.s3.get_object(Bucket=self.bucket, Key=INDEX_KEY)
        except Exception as exc:
            if error_code(exc) in ('404', 'NoSuchKey', 'NotFound'):
                self.etag = None
                return
            raise
        with response['Body'] as body:
            value = json.loads(body.read())
        if value.get('schema') != 'artwork.r2-index.v1' or value.get('prefix') != PREFIX:
            raise ValueError('Existing index is not owned by this study')
        for entry in value['jobs']:
            base = PREFIX + entry['profile'] + '/' + entry['id'] + '/'
            if entry['profile'] not in ('flux1-dev', 'flux2-dev-nf4') or entry['imageKey'] != base + 'result.png' or entry['receiptKey'] != base + 'receipt.json':
                raise ValueError('Existing index contains an unrelated key')
            self.jobs[entry['profile'] + '/' + entry['id']] = entry
        self.etag = response['ETag']

    def add(self, ident, entry):
        previous = self.jobs.get(ident)
        if previous and previous['sha256'] != entry['sha256']:
            raise ValueError('Index job has conflicting image SHA-256')
        if previous != entry:
            self.pending[ident] = entry

    def flush(self):
        if not self.pending:
            return
        for ident, entry in self.pending.items():
            if ident in self.jobs and self.jobs[ident]['sha256'] != entry['sha256']:
                raise ValueError('Concurrent index job has conflicting image SHA-256')
        merged = {**self.jobs, **self.pending}
        value = {'schema': 'artwork.r2-index.v1', 'prefix': PREFIX,
                 'updatedAt': datetime.now(timezone.utc).isoformat(),
                 'jobs': sorted(merged.values(), key=lambda item: (item.get('created') or 0, item['profile'], item['id']))}
        data = json.dumps(value, ensure_ascii=False).encode()
        condition = {'IfMatch': self.etag} if self.etag else {'IfNoneMatch': '*'}
        try:
            response = self.s3.put_object(Bucket=self.bucket, Key=INDEX_KEY, Body=data,
                                         ContentType='application/json',
                                         Metadata={'sha256': hashlib.sha256(data).hexdigest()}, **condition)
        except Exception as exc:
            if error_code(exc) in ('PreconditionFailed', '412', 'ConditionalRequestConflict', '409'):
                self.load()
            raise
        self.jobs, self.etag = merged, response['ETag']
        self.pending.clear()
        self.last_publish = time.monotonic()


def prepare_archive(client, bucket, image, ident):
    parts = ident.split('/')
    if image.is_symlink() or not any(image.resolve().is_relative_to(root.resolve()) for root in job_stores()):
        raise ValueError('Image path escapes job store')
    record = json.loads((image.parent / 'job.json').read_text())
    receipt_path = image.parent / 'receipt.json'
    receipt = json.loads(receipt_path.read_text())
    if record.get('status') != 'done' or receipt.get('id') != parts[1] or receipt.get('profile') != parts[0] or receipt.get('source') != str(image):
        raise ValueError('Generation receipt identity mismatch')
    image_sha = upstream.sha256_file(image)
    receipt_sha = upstream.sha256_file(receipt_path)
    if receipt.get('sha256') != image_sha or record.get('receipt', {}).get('sha256') != image_sha:
        raise ValueError('Generation receipt SHA-256 mismatch')
    proof_path = ROOT / 'receipts' / parts[0] / (parts[1] + '.json')
    if proof_path.exists():
        prior = json.loads(proof_path.read_text())
        if prior['imageSha256'] != image_sha or prior['receiptSha256'] != receipt_sha:
            raise ValueError('Completed local job changed after archival')
    keys = [PREFIX + ident + '/result.png', PREFIX + ident + '/receipt.json']
    for path, key, digest in zip((image, receipt_path), keys, (image_sha, receipt_sha)):
        client.expected[key] = digest
        upstream.upload_file(client, bucket, path, key)
    a, b = image.stat(), receipt_path.stat()
    proof = {'job': ident, 'prefix': PREFIX, 'imageSha256': image_sha,
             'receiptSha256': receipt_sha, 'objects': [client.proofs[k] for k in keys],
             'confirmedAt': time.time(), 'localSignature': [a.st_size, a.st_mtime_ns, b.st_size, b.st_mtime_ns]}
    spec = record.get('spec', {})
    entry = {
        'id': parts[1], 'profile': parts[0], 'scene': spec.get('scene'),
        'name': spec.get('name'), 'prompt': receipt.get('prompt', spec.get('prompt')),
        'width': receipt.get('width', spec.get('width')), 'height': receipt.get('height', spec.get('height')),
        'settings': spec.get('settings', {}), 'parameters': receipt.get('parameters', {}),
        'seconds': receipt.get('generation_seconds'), 'sha256': image_sha,
        'imageKey': keys[0], 'receiptKey': keys[1],
        'created': record.get('finished', receipt.get('created')),
    }
    return proof, entry, proof_path


def commit_archive(index, ident, prepared):
    proof, entry, proof_path = prepared
    index.add(ident, entry)
    # Publish before acknowledging durable coverage. Interrupted writes are
    # reconciled from immutable remote objects on the following attempt.
    index.flush()
    atomic_json(proof_path, proof)
    return proof


def archive_one(client, bucket, index, image, ident):
    return commit_archive(index, ident, prepare_archive(client, bucket, image, ident))


class Reconciler:
    def __init__(self, client, bucket, index, verify_interval=600):
        self.client, self.bucket, self.index = client, bucket, index
        self.verify_interval = verify_interval
        self.path = ROOT / 'backlog.json'
        try:
            value = json.loads(self.path.read_text())
            self.entries = value['jobs'] if value.get('schema') == 'artwork.r2-backlog.v1' else {}
        except (OSError, ValueError, KeyError):
            self.entries = {}
        self.active = None

    def discover(self):
        current, waiting, young = {}, 0, 0
        # Enumerate done job records rather than images: a lost/missing local
        # image or receipt must become an explicit backlog item, not disappear.
        for job_root, record_path in ((root, path) for root in job_stores() for path in root.glob('*/*/job.json')):
            image = record_path.parent / 'result.png'
            parts = image.relative_to(job_root).parts
            if parts[0] not in ('flux1-dev', 'flux2-dev-nf4'):
                continue
            try:
                record = json.loads(record_path.read_text())
                if record.get('status') != 'done':
                    continue
                receipt = image.parent / 'receipt.json'
                if image.is_file() and time.time() - image.stat().st_mtime < 2:
                    young += 1
                    continue
                ident = '/'.join(parts[:2])
                if ident in current and current[ident].resolve()!=image.resolve():
                    raise ValueError('Conflicting lane job identity retained without replacement')
                current[ident] = image
                entry = self.entries.get(ident)
                complete_local = image.is_file() and receipt.is_file()
                a = image.stat() if image.is_file() else record_path.stat()
                b = receipt.stat() if receipt.is_file() else record_path.stat()
                signature = [a.st_size, a.st_mtime_ns, b.st_size, b.st_mtime_ns] if complete_local else None
                if entry is None:
                    try:
                        proof = json.loads((ROOT / 'receipts' / parts[0] / (parts[1] + '.json')).read_text())
                        verified = proof.get('confirmedAt', 0) if proof.get('localSignature') == signature else 0
                    except (OSError, ValueError):
                        verified = 0
                    entry = self.entries[ident] = {'attempts': 0, 'lastSuccessAt': verified, 'errorCode': None, 'nextAttemptAt': 0}
                if entry.get('signature') != signature:
                    # A legacy proof can seed the first signature. Later changes
                    # require remote verification and immutable receipt checks.
                    if entry.get('signature') is not None:
                        entry['lastSuccessAt'] = 0
                    entry['signature'] = signature
                if not complete_local:
                    entry['lastSuccessAt'] = 0
                if 'contentVerifiedAt' not in entry:
                    try:
                        proof = json.loads((ROOT / 'receipts' / parts[0] / (parts[1] + '.json')).read_text())
                        entry['contentVerifiedAt'] = proof.get('confirmedAt', 0) if all(x.get('verification') == 'HEAD size and GET SHA-256' for x in proof.get('objects', [])) and len(proof.get('objects', [])) == 2 else 0
                    except (OSError, ValueError):
                        entry['contentVerifiedAt'] = 0
                entry['finishedAt'] = record.get('finished') or a.st_mtime
                entry['indexed'] = ident in self.index.jobs
            except (OSError, ValueError, TypeError):
                waiting += 1
        return current, waiting, young

    def pending(self, ident, now):
        e = self.entries[ident]
        return not e.get('lastSuccessAt') or not e.get('indexed') or bool(e.get('errorCode'))

    def save(self, current, waiting=0, young=0):
        now = time.time()
        pending = [k for k in current if self.pending(k, now)]
        due = [k for k in current if not self.pending(k, now) and now - self.entries[k].get('contentVerifiedAt', 0) >= self.verify_interval]
        errors = [{'job': k, 'code': self.entries[k]['errorCode']} for k in current if self.entries[k].get('errorCode')]
        oldest = max((now - self.entries[k]['finishedAt'] for k in pending), default=0)
        last_success = max((self.entries[k].get('lastSuccessAt', 0) for k in current), default=0)
        atomic_json(self.path, {'schema': 'artwork.r2-backlog.v1', 'observedAt': now, 'jobs': self.entries})
        status = {'schema': 'artwork.r2-stream.v1', 'prefix': PREFIX,
                  'status': 'healthy' if not pending and not due and not errors and not waiting else 'degraded',
                  'confirmedJobs': len(current) - len(pending), 'confirmedObjects': (len(current) - len(pending)) * 2,
                  'completedJobs': len(current), 'pendingJobs': len(pending), 'verificationDueJobs': len(due),
                  'oldestPendingSeconds': round(max(0, oldest), 1), 'attempts': sum(self.entries[k].get('attempts', 0) for k in current),
                  'lastSuccessAt': last_success or None, 'heartbeatAt': now, 'activeJob': self.active,
                  'waitingJobs': waiting, 'settlingImages': young,
                  'indexKey': INDEX_KEY, 'indexedJobs': len(self.index.jobs),
                  'errors': errors[:20], 'errorCount': len(errors), 'sweptAt': now,
                  'remoteVerifiedAt': min((self.entries[k].get('contentVerifiedAt', 0) for k in current), default=0) or None}
        atomic_json(ROOT / 'status.json', status)
        return status

    def cycle(self, stop=None):
        current, waiting, young = self.discover()
        self.save(current, waiting, young)
        now = time.time()
        eligible = [k for k in current if self.entries[k].get('nextAttemptAt', 0) <= now
                    and (self.pending(k, now) or now - self.entries[k].get('contentVerifiedAt', 0) >= self.verify_interval)]
        # Missing archives always precede background reverification. Limit work
        # per cycle so newly finished jobs are discovered promptly.
        eligible.sort(key=lambda k: (not self.pending(k, now), self.entries[k].get('contentVerifiedAt', 0), self.entries[k]['finishedAt'], k))
        # Parallelize immutable object transfer/verification only. The sole
        # lock-holding supervisor process commits the mutable index serially.
        batch = eligible[:4]
        if stop is not None and stop.is_set():
            batch = []
        for ident in batch:
            e = self.entries[ident]
            e['attempts'] = e.get('attempts', 0) + 1
            e['lastAttemptAt'] = time.time()
        self.active = ','.join(batch) or None
        self.save(current, waiting, young)
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = {pool.submit(prepare_archive, self.client, self.bucket, current[ident], ident): ident for ident in batch}
            for future in as_completed(futures):
                ident = futures[future]
                e = self.entries[ident]
                try:
                    proof = commit_archive(self.index, ident, future.result())
                    e.update(lastSuccessAt=proof['confirmedAt'], contentVerifiedAt=proof['confirmedAt'], errorCode=None, nextAttemptAt=0, failures=0, indexed=True)
                except Exception as exc:
                    failures = e.get('failures', 0) + 1
                    e.update(errorCode=error_code(exc), failures=failures, nextAttemptAt=time.time() + min(300, 2 ** min(failures, 8)))
                self.save(current, waiting, young)
        self.active = None
        return self.save(current, waiting, young)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--interval', type=float, default=1)
    parser.add_argument('--verify-interval', type=float, default=600)
    args = parser.parse_args()
    ROOT.mkdir(parents=True, exist_ok=True)
    lock = (ROOT / '.stream.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    credentials_path = ROOT / 'credentials.json'
    if credentials_path.stat().st_mode & 0o077:
        raise ValueError('Credential file must be private')
    credentials = json.loads(credentials_path.read_text())
    for key in ('R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT', 'R2_BUCKET'):
        os.environ[key] = credentials[key]
    # Bound network stalls. Retry state survives service/instance restarts.
    import boto3
    from botocore.config import Config
    s3 = boto3.client('s3', endpoint_url=os.environ['R2_ENDPOINT'],
                      aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
                      aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'], region_name='auto',
                      config=Config(connect_timeout=5, read_timeout=15,
                                    retries={'max_attempts': 2, 'mode': 'standard'}, max_pool_connections=8))
    bucket = os.environ['R2_BUCKET']
    client = ImmutableUploads(s3)
    index = StudyIndex(s3, bucket)
    reconciler = Reconciler(client, bucket, index, args.verify_interval)
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    while not stop.is_set():
        status = reconciler.cycle(stop)
        print(json.dumps(status), flush=True)
        if args.once:
            return 0 if status['status'] == 'healthy' else 2
        stop.wait(max(args.interval, 0.1))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({'status': 'stopped', 'code': error_code(exc)}), flush=True)
        raise SystemExit(1)
