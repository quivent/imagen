#!/usr/bin/env python3
"""Copy a pair of factory originals and measured receipts into the local gallery."""
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile

ROOT = Path(__file__).resolve().parent


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def atomic_json(path, value):
    fd, temporary = tempfile.mkstemp(prefix='.comparison-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def side(db, factory, data, job_id):
    job = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
    if job is None:
        raise ValueError(f'Unknown factory job: {job_id}')
    spec = json.loads(job['spec'])
    version = db.execute('SELECT * FROM versions WHERE job=?', (job_id,)).fetchone()
    model = {'flux1-dev': 'FLUX.1 dev', 'flux2-dev-nf4': 'FLUX.2 dev'}.get(spec['model'], spec['model'])
    result = {'jobId': job_id, 'model': model, 'prompt': spec['prompt']}
    if version is None:
        return result
    metadata = json.loads(version['metadata'])
    record = metadata['files']['original']
    source = (Path(version['directory']) / record['name']).resolve()
    if not source.is_relative_to(factory / 'versions') or digest(source) != record['sha256']:
        raise ValueError('The source original does not match its factory record')
    receipt_path = factory / 'work' / job['attempt'] / 'generation.json'
    receipt = json.loads(receipt_path.read_text()).get('generation', {}) if receipt_path.is_file() else {}
    if receipt.get('sha256') and receipt['sha256'] != record['sha256']:
        raise ValueError('Generation receipt and original hashes differ')
    name = f"{version['id']}-{record['sha256'][:12]}{source.suffix.lower()}"
    destination = data / name
    # Exclusive creation prevents overwriting any previous image, even on retries.
    if destination.exists():
        if digest(destination) != record['sha256']:
            raise ValueError('A previously copied original has changed')
    else:
        fd, temporary = tempfile.mkstemp(prefix='.original-', dir=data)
        try:
            with os.fdopen(fd, 'wb') as output, source.open('rb') as incoming:
                while chunk := incoming.read(1024 * 1024):
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            if digest(Path(temporary)) != record['sha256']:
                raise ValueError('Copied original hash differs')
            os.link(temporary, destination)
        finally:
            os.unlink(temporary)
    parameters = receipt.get('parameters', {})
    precision = receipt.get('precision', {})
    dtype = precision.get('transformer_dtype', '').replace('torch.', '').upper().replace('BFLOAT16', 'BF16')
    quantization = precision.get('text_encoder_quantization', {})
    precision_label = dtype or None
    if precision.get('text_encoder_4bit'):
        encoder_type = quantization.get('bnb_4bit_quant_type', '4 bit').upper()
        precision_label = f'{dtype} / {encoder_type} encoder'.strip(' /')
    models = receipt.get('model_manifest', {}).get('models', {})
    model_key = 'flux1' if receipt.get('profile') == 'flux1-dev' else 'flux2'
    settings = {key: value for key, value in parameters.items() if key not in {'width', 'height', 'num_inference_steps'}}
    for key in ['gpu', 'cuda', 'load_seconds', 'peak_allocated_bytes', 'peak_reserved_bytes', 'packages']:
        if key in receipt:
            settings[key] = receipt[key]
    if models.get('flux2-nf4') and receipt.get('profile') == 'flux2-dev-nf4':
        settings['encoder_revision'] = models['flux2-nf4']['revision']
    settings['factory_version'] = version['id']
    result.update({
        'image': 'data/' + name, 'imageSha256': record['sha256'],
        'versionId': version['id'], 'seed': receipt.get('seed'),
        'steps': parameters.get('num_inference_steps'),
        'width': metadata['width'], 'height': metadata['height'],
        'seconds': receipt.get('generation_seconds'), 'precision': precision_label,
        'revision': models.get(model_key, {}).get('revision'), 'settings': settings,
    })
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', type=Path, default=ROOT.parent / '.state')
    parser.add_argument('--id', required=True)
    parser.add_argument('--title', required=True)
    parser.add_argument('--left-job', required=True)
    parser.add_argument('--right-job', required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_-]+', args.id):
        parser.error('Comparison ID must use letters, digits, underscores or hyphens')
    factory = args.state.expanduser().resolve()
    data = ROOT / 'data'
    data.mkdir(exist_ok=True)
    path = data / 'comparisons.json'
    with (data / '.import.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        collection = json.loads(path.read_text()) if path.exists() else {'schemaVersion': 1, 'comparisons': []}
        if collection.get('schemaVersion') != 1:
            raise ValueError('Unsupported comparison schema')
        old = next((row for row in collection['comparisons'] if row['id'] == args.id), None)
        if old:
            for position, job_id in [('left', args.left_job), ('right', args.right_job)]:
                previous = old.get(position)
                if previous and previous.get('jobId') != job_id:
                    raise ValueError('Use a new comparison ID for different jobs')
        with sqlite3.connect((factory / 'queue.sqlite3').as_uri() + '?mode=ro', uri=True) as db:
            db.row_factory = sqlite3.Row
            left = side(db, factory, data, args.left_job)
            right = side(db, factory, data, args.right_job)
        row = {'id': args.id, 'title': args.title, 'prompt': left['prompt'], 'left': left, 'right': right}
        if old:
            for position in ['left', 'right']:
                prior_version = (old.get(position) or {}).get('versionId')
                if prior_version and prior_version != row[position].get('versionId'):
                    raise ValueError('An existing comparison version cannot be replaced')
        if old:
            if old == row:
                print(json.dumps({'id': args.id, 'changed': False}))
                return
            collection['comparisons'][collection['comparisons'].index(old)] = row
        else:
            collection['comparisons'].append(row)
        collection['updatedAt'] = datetime.now(timezone.utc).isoformat()
        atomic_json(path, collection)
        print(json.dumps({'id': args.id, 'images': sum(bool(item.get('image')) for item in [left, right]), 'changed': True}))


if __name__ == '__main__':
    main()
