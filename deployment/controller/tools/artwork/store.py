"""Durable artwork requests, fenced claims, immutable versions and review history."""
from contextlib import contextmanager
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import sqlite3
import tempfile
import time
import uuid

from images import digest, fingerprint, process

STYLE = ('Painterly realism, tactile natural materials, convincing depth, softened edges '
         'and readable shadows. Restrained colour and believable light. One coherent scene; '
         'no captions, lettering, watermark, border or invented fantasy elements.')
FAMILIES = {
    'landscape': 'Preserve the named landforms and vegetation. Distinguish near, middle and far distance.',
    'architecture': 'Preserve the specified architecture, proportions, materials and spatial arrangement.',
    'animals': 'Keep the named animals legible, with believable anatomy, scale and contact with their surroundings.',
    'underwater': 'Keep the specified marine life distinct at multiple depths, with light appropriate to the stated depth.',
}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}', value):
        raise ValueError('Use a short identifier containing letters, numbers, hyphens or underscores')
    return value


class Store:
    def __init__(self, root):
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        with self.db() as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS scenes (
              id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL,
              metadata TEXT NOT NULL, selected TEXT);
            CREATE TABLE IF NOT EXISTS jobs (
              id TEXT PRIMARY KEY, scene TEXT NOT NULL REFERENCES scenes(id),
              cache_key TEXT UNIQUE NOT NULL, spec TEXT NOT NULL, backend TEXT NOT NULL,
              state TEXT NOT NULL, created REAL NOT NULL, updated REAL NOT NULL,
              token TEXT, lease REAL, attempt TEXT, tries INTEGER NOT NULL DEFAULT 0,
              remote TEXT, available REAL NOT NULL DEFAULT 0, note TEXT);
            CREATE TABLE IF NOT EXISTS attempts (
              id TEXT PRIMARY KEY, job TEXT NOT NULL REFERENCES jobs(id),
              started REAL NOT NULL, finished REAL, outcome TEXT, cost REAL,
              currency TEXT, remote TEXT);
            CREATE TABLE IF NOT EXISTS versions (
              id TEXT PRIMARY KEY, scene TEXT NOT NULL REFERENCES scenes(id),
              job TEXT UNIQUE REFERENCES jobs(id), created REAL NOT NULL,
              state TEXT NOT NULL, metadata TEXT NOT NULL, directory TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS events (
              id INTEGER PRIMARY KEY, at REAL NOT NULL, kind TEXT NOT NULL,
              subject TEXT NOT NULL, details TEXT NOT NULL);
            ''')

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.root / 'queue.sqlite3', timeout=30, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('PRAGMA synchronous=FULL')
        try:
            db.execute('BEGIN IMMEDIATE')
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def event(db, kind, subject, details):
        db.execute('INSERT INTO events(at,kind,subject,details) VALUES(?,?,?,?)',
                   (time.time(), kind, subject, canonical(details)))

    def enqueue(self, request):
        if not isinstance(request, dict):
            raise ValueError('A request must be an object')
        scene = identifier(request['scene'])
        backend = request.get('backend', 'builtin')
        if backend not in ('builtin', 'bfl', 'command'):
            raise ValueError('Unknown backend')
        family = request.get('family', 'landscape')
        if family not in FAMILIES:
            raise ValueError('Unknown subject family')
        prompt = request.get('prompt')
        if not prompt:
            brief = request.get('brief', '').strip()
            if not brief:
                raise ValueError('A prompt or brief is required')
            prompt = f'{brief}\n{STYLE}\n{FAMILIES[family]}'
        if not isinstance(prompt, str) or not 1 <= len(prompt) <= 20_000:
            raise ValueError('Prompt must be between 1 and 20,000 characters')
        width, height = request.get('width', 1536), request.get('height', 1024)
        if any(type(n) is not int or not 64 <= n <= 4096 for n in (width, height)):
            raise ValueError('Dimensions must be integers between 64 and 4096')
        settings = request.get('settings', {})
        if not isinstance(settings, dict):
            raise ValueError('Settings must be an object')
        if backend == 'builtin' and set(settings) - {'transparent_background'}:
            raise ValueError('Built-in jobs support only transparent_background in settings')
        if backend == 'builtin' and 'transparent_background' in settings and type(settings['transparent_background']) is not bool:
            raise ValueError('transparent_background must be a boolean')
        model = request.get('model', {'builtin': 'builtin', 'bfl': 'flux-2-pro', 'command': 'local-model'}[backend])
        if not isinstance(model, str) or not model.strip() or len(model) > 100:
            raise ValueError('A short model name is required')
        if backend == 'builtin' and model != 'builtin':
            raise ValueError('The built-in tool does not expose model selection')
        if backend == 'bfl':
            if model not in ('flux-2-pro', 'flux-2-max', 'flux-2-klein-4b', 'flux-2-klein-9b'):
                raise ValueError('Unsupported FLUX.2 model')
            if set(settings) - {'seed', 'disable_pup'}:
                raise ValueError('BFL settings support seed and disable_pup')
            if model.startswith('flux-2-klein') and 'disable_pup' in settings:
                raise ValueError('Klein does not support disable_pup')
            if 'seed' in settings and type(settings['seed']) is not int:
                raise ValueError('Seed must be an integer')
            if 'disable_pup' in settings and type(settings['disable_pup']) is not bool:
                raise ValueError('disable_pup must be a boolean')
            if width % 16 or height % 16 or width * height > 4_000_000:
                raise ValueError('BFL dimensions must be multiples of 16 and at most 4 megapixels')
        refs = []
        for item in request.get('references', []):
            role = item.get('role', 'reference')
            if role not in ('reference', 'edit-target', 'style'):
                raise ValueError('Unknown reference role')
            path = Path(item['path']).expanduser().resolve()
            if not path.is_file() or path.stat().st_size > 50_000_000:
                raise ValueError('Reference must be a file under 50 MB')
            sha = digest(path)
            dest = self.root / 'references' / (sha + path.suffix.lower())
            dest.parent.mkdir(exist_ok=True)
            if not dest.exists():
                with tempfile.NamedTemporaryFile(dir=dest.parent, delete=False) as f:
                    tmp = Path(f.name)
                shutil.copyfile(path, tmp)
                if digest(tmp) != sha:
                    tmp.unlink()
                    raise ValueError('Reference changed while copying')
                tmp.replace(dest)
            refs.append({'role': role, 'sha256': sha, 'path': str(dest)})
        if len(refs) > 8:
            raise ValueError('At most eight references per request')
        if backend == 'bfl' and model.startswith('flux-2-klein') and len(refs) > 4:
            raise ValueError('Klein accepts at most four references')
        spec = {'scene': scene, 'name': request.get('name', scene), 'backend': backend,
                'model': model,
                'prompt': prompt, 'width': width, 'height': height, 'settings': settings,
                'references': refs, 'family': family, 'variant': request.get('variant', '')}
        key_spec = dict(spec, references=[{k: v for k, v in r.items() if k != 'path'} for r in refs])
        for descriptive in ('name', 'family'):
            key_spec.pop(descriptive)
        key = hashlib.sha256(canonical(key_spec).encode()).hexdigest()
        now, job = time.time(), uuid.uuid4().hex
        with self.db() as db:
            old = db.execute('SELECT id FROM jobs WHERE cache_key=?', (key,)).fetchone()
            if old:
                return {'id': old['id'], 'cached': True}
            db.execute('INSERT OR IGNORE INTO scenes VALUES(?,?,?,?,NULL)',
                       (scene, spec['name'], request.get('position', 10000), canonical(request)))
            db.execute('INSERT INTO jobs(id,scene,cache_key,spec,backend,state,created,updated) '
                       'VALUES(?,?,?,?,?,?,?,?)', (job, scene, key, canonical(spec), backend, 'queued', now, now))
            self.event(db, 'queued', job, {'scene': scene})
        return {'id': job, 'cached': False}

    def expire(self, db, now):
        stale = db.execute("SELECT id FROM jobs WHERE state='active' AND lease<?", (now,)).fetchall()
        for row in stale:
            db.execute("UPDATE jobs SET state='uncertain',note='Lease expired without a durable receipt',updated=? WHERE id=?", (now, row['id']))
            self.event(db, 'uncertain', row['id'], {'reason': 'expired claim'})

    def claim(self, backend, worker, seconds=600, model=None):
        now = time.time()
        with self.db() as db:
            self.expire(db, now)
            row = db.execute("SELECT * FROM jobs WHERE backend=? AND (? IS NULL OR json_extract(spec,'$.model')=?) AND available<=? AND "
                             "(state='queued' OR (state='submitted' AND lease<?)) ORDER BY "
                             "CASE state WHEN 'submitted' THEN 0 ELSE 1 END,created LIMIT 1",
                             (backend, model, model, now, now)).fetchone()
            if not row:
                return None
            token = uuid.uuid4().hex
            attempt = row['attempt'] if row['state'] == 'submitted' else uuid.uuid4().hex
            if row['state'] != 'submitted':
                db.execute('INSERT INTO attempts(id,job,started) VALUES(?,?,?)', (attempt, row['id'], now))
            db.execute('UPDATE jobs SET state=?,token=?,lease=?,attempt=?,tries=tries+?,updated=? WHERE id=?',
                       ('submitted' if row['remote'] else 'active', token, now + seconds, attempt,
                        0 if row['state'] == 'submitted' else 1, now, row['id']))
            self.event(db, 'claimed', row['id'], {'worker': worker, 'attempt': attempt})
            return dict(db.execute('SELECT * FROM jobs WHERE id=?', (row['id'],)).fetchone())

    @staticmethod
    def owned(db, job, token, allow_uncertain=False):
        row = db.execute('SELECT * FROM jobs WHERE id=?', (job,)).fetchone()
        states = ('active', 'submitted', 'uncertain') if allow_uncertain else ('active', 'submitted')
        if not row or not token or row['token'] != token or row['state'] not in states:
            raise ValueError('This claim no longer owns the job')
        return row

    def beat(self, job, token, seconds=600):
        with self.db() as db:
            self.owned(db, job, token)
            db.execute('UPDATE jobs SET lease=? WHERE id=?', (time.time() + seconds, job))

    def submitted(self, job, token, receipt):
        if not receipt.get('id'):
            raise ValueError('Remote request ID is required')
        with self.db() as db:
            row = self.owned(db, job, token, True)
            if row['remote'] and json.loads(row['remote'])['id'] != receipt['id']:
                raise ValueError('Cannot replace a remote request ID')
            db.execute("UPDATE jobs SET remote=?,state='submitted',updated=?,lease=? WHERE id=?",
                       (canonical(receipt), time.time(), time.time() + 600, job))
            db.execute('UPDATE attempts SET remote=? WHERE id=?', (canonical(receipt), row['attempt']))
            cost = receipt.get('cost')
            if row['backend'] == 'bfl' and type(cost) in (int, float) and math.isfinite(cost) and cost >= 0:
                db.execute('UPDATE attempts SET cost=?,currency=? WHERE id=?', (cost, 'BFL credits', row['attempt']))
            self.event(db, 'submitted', job, {'id': receipt['id']})

    def cancel(self, job, reason):
        if not reason.strip():
            raise ValueError('Record why the queued request is being cancelled')
        with self.db() as db:
            row = db.execute('SELECT state FROM jobs WHERE id=?', (job,)).fetchone()
            if not row or row['state'] != 'queued':
                raise ValueError('Only a request that has not been claimed can be cancelled')
            db.execute("UPDATE jobs SET state='cancelled',note=?,updated=? WHERE id=?", (reason, time.time(), job))
            self.event(db, 'cancelled', job, {'reason': reason})

    def defer(self, job, token, note, seconds=5):
        with self.db() as db:
            self.owned(db, job, token)
            db.execute('UPDATE jobs SET lease=0,available=?,note=? WHERE id=?',
                       (time.time() + seconds, note, job))

    def fail(self, job, token, note, uncertain=False, safe_retry=False):
        with self.db() as db:
            row = self.owned(db, job, token, True)
            state = 'uncertain' if uncertain else 'failed'
            if safe_retry and row['tries'] < 3:
                state = 'queued'
            db.execute('UPDATE jobs SET state=?,note=?,updated=?,available=? WHERE id=?',
                       (state, note, time.time(), time.time() + min(60, 2 ** row['tries']), job))
            db.execute('UPDATE attempts SET finished=?,outcome=? WHERE id=?',
                       (time.time(), state, row['attempt']))
            self.event(db, state, job, {'note': note})

    def retry(self, job, reason):
        if not reason.strip():
            raise ValueError('Record why retry is appropriate, including reconciliation of uncertain work')
        with self.db() as db:
            row = db.execute('SELECT * FROM jobs WHERE id=?', (job,)).fetchone()
            if not row or row['state'] not in ('uncertain', 'failed', 'cancelled'):
                raise ValueError('Only stopped jobs can be retried; new artwork needs a new variant')
            if row['attempt']:
                db.execute('UPDATE attempts SET finished=COALESCE(finished,?),outcome=COALESCE(outcome,?) WHERE id=?',
                           (time.time(), 'reconciled', row['attempt']))
            db.execute("UPDATE jobs SET state='queued',token=NULL,remote=NULL,lease=NULL,available=0,note=?,updated=? WHERE id=?",
                       (reason, time.time(), job))
            self.event(db, 'retry-authorized', job, {'reason': reason})

    def complete(self, job, token, source, cost=None, currency=None, receipt=None):
        if cost is not None and (type(cost) not in (int, float) or not math.isfinite(cost) or cost < 0 or not currency):
            raise ValueError('A nonnegative finite cost requires its currency or credit unit')
        with self.db() as db:
            old = db.execute('SELECT id FROM versions WHERE job=?', (job,)).fetchone()
            if old:
                # A repeated receipt is safe only when its claim and source agree.
                row = db.execute('SELECT token FROM jobs WHERE id=?', (job,)).fetchone()
                version = db.execute('SELECT metadata FROM versions WHERE id=?', (old['id'],)).fetchone()
                if row['token'] != token or json.loads(version['metadata'])['files']['original']['sha256'] != digest(source):
                    raise ValueError('Conflicting completion receipt')
                return old['id']
            row = dict(self.owned(db, job, token, True))
        spec = json.loads(row['spec'])
        version = uuid.uuid4().hex
        directory = self.root / 'versions' / version
        metadata = process(source, directory, (spec['width'], spec['height']))
        metadata['spec'] = spec
        if receipt is not None:
            metadata['generationReceipt'] = receipt
        with self.db() as db:
            current = self.owned(db, job, token, True)
            db.execute('INSERT INTO versions VALUES(?,?,?,?,?,?,?)',
                       (version, row['scene'], job, time.time(), 'pending', canonical(metadata), str(directory)))
            db.execute("UPDATE jobs SET state='generated',updated=? WHERE id=?", (time.time(), job))
            db.execute('UPDATE attempts SET finished=?,outcome=?,cost=?,currency=? WHERE id=?',
                       (time.time(), 'generated', cost, currency, current['attempt']))
            self.event(db, 'generated', job, {'version': version})
        return version

    def review(self, version, decision, note, reviewer='operator', expected_selected=None):
        if decision not in ('accepted', 'rejected') or not note.strip():
            raise ValueError('Choose accepted or rejected and record a review note')
        with self.db() as db:
            row = db.execute('SELECT * FROM versions WHERE id=?', (version,)).fetchone()
            if not row:
                raise ValueError('Unknown version')
            selected = db.execute('SELECT selected FROM scenes WHERE id=?', (row['scene'],)).fetchone()['selected']
            if decision == 'rejected' and selected == version:
                raise ValueError('A selected version is protected; accept a replacement first')
            if decision == 'accepted':
                if selected != expected_selected:
                    raise ValueError('Selection changed or was not acknowledged; reload before replacing it')
                db.execute('UPDATE scenes SET selected=? WHERE id=?', (version, row['scene']))
            db.execute('UPDATE versions SET state=? WHERE id=?', (decision, version))
            self.event(db, 'review', version, {'decision': decision, 'note': note, 'reviewer': reviewer,
                                             'previous': selected})

    def import_atlas(self, manifest, repo):
        data = json.loads(Path(manifest).read_text())
        count = 0
        for position, scene in enumerate(data['scenes']):
            scene_id = identifier(scene['id'])
            with self.db() as db:
                if db.execute('SELECT 1 FROM scenes WHERE id=?', (scene_id,)).fetchone():
                    continue
            version = 'import-' + scene_id
            directory = self.root / 'versions' / version
            directory.mkdir(parents=True, exist_ok=True)
            files = {}
            for kind in ('full', 'small'):
                source = (Path(repo) / scene['assets'][kind]).resolve()
                if not source.is_relative_to(Path(repo).resolve()):
                    raise ValueError('Atlas asset escaped the repository')
                sha = digest(source)
                if sha != scene['assetSha256'][kind]:
                    raise ValueError(f'Atlas hash mismatch: {scene_id}/{kind}')
                dest = directory / (kind + '.webp')
                shutil.copyfile(source, dest)
                if digest(dest) != sha:
                    raise ValueError('Asset changed while importing')
                files[kind] = {'name': dest.name, 'sha256': sha, 'bytes': dest.stat().st_size}
            source = Path(scene.get('source', ''))
            if source.is_file():
                dest = directory / ('original' + source.suffix)
                shutil.copyfile(source, dest)
                files['original'] = {'name': dest.name, 'sha256': digest(dest), 'bytes': dest.stat().st_size}
            metadata = {'legacy': scene, 'files': files, 'dhash': fingerprint(directory / 'small.webp'),
                        'reviewBasis': 'Existing published artwork, imported without asserting new human review'}
            with self.db() as db:
                db.execute('INSERT INTO scenes VALUES(?,?,?,?,?)',
                           (scene_id, scene['name'], position, canonical(scene), version))
                db.execute('INSERT INTO versions VALUES(?,?,NULL,?,?,?,?)',
                           (version, scene_id, time.time(), 'accepted', canonical(metadata), str(directory)))
                self.event(db, 'imported-published', version, {'scene': scene_id})
            count += 1
        return count

    def snapshot(self):
        with self.db() as db:
            self.expire(db, time.time())
            scenes = [dict(r) for r in db.execute('SELECT id,name,position,selected FROM scenes ORDER BY position,id')]
            jobs = [dict(r) for r in db.execute('SELECT id,scene,backend,state,created,updated,tries,note,spec FROM jobs ORDER BY created DESC')]
            versions = [dict(r) for r in db.execute('SELECT id,scene,job,created,state,metadata FROM versions ORDER BY created DESC')]
            attempts = [dict(r) for r in db.execute('SELECT * FROM attempts')]
        for row in jobs:
            row['spec'] = json.loads(row['spec'])
        for row in versions:
            row['metadata'] = json.loads(row['metadata'])
        accepted = sum(v['state'] == 'accepted' and v['job'] is not None for v in versions)
        costs = {}
        for attempt in attempts:
            if attempt['cost'] is not None:
                unit = attempt['currency']
                costs[unit] = costs.get(unit, 0) + attempt['cost']
        attempt_seconds = sum(a['finished'] - a['started'] for a in attempts if a['finished'])
        by_model = {}
        for job in jobs:
            key = job['backend'] + ':' + job['spec']['model']
            group = by_model.setdefault(key, {'attempts': 0, 'acceptedVersions': 0, 'knownCost': {},
                                              'unknownCostAttempts': 0, 'attemptSeconds': 0})
            group['acceptedVersions'] += sum(v['job'] == job['id'] and v['state'] == 'accepted' for v in versions)
            for attempt in (a for a in attempts if a['job'] == job['id']):
                group['attempts'] += 1
                if attempt['finished']:
                    group['attemptSeconds'] += attempt['finished'] - attempt['started']
                if attempt['cost'] is None:
                    group['unknownCostAttempts'] += 1
                else:
                    unit = attempt['currency']
                    group['knownCost'][unit] = group['knownCost'].get(unit, 0) + attempt['cost']
        for group in by_model.values():
            n = group['acceptedVersions']
            group['attemptSecondsPerAcceptedVersion'] = group['attemptSeconds'] / n if n else None
            group['knownCostPerAcceptedVersion'] = {k: v / n for k, v in group['knownCost'].items()} if n else {}
        return {'scenes': scenes, 'jobs': jobs, 'versions': versions,
                'metrics': {'attempts': len(attempts), 'acceptedGeneratedVersions': accepted,
                            'knownCost': costs, 'unknownCostAttempts': sum(a['cost'] is None for a in attempts),
                            'knownCostPerAcceptedVersion': {k: v / accepted for k, v in costs.items()} if accepted else {},
                            'summedAttemptSeconds': attempt_seconds,
                            'attemptSecondsPerAcceptedVersion': attempt_seconds / accepted if accepted else None,
                            'byModel': by_model,
                            'note': 'Summed attempt duration is not wall-clock throughput. Costs exclude unknown amounts.'}}

    def asset(self, version, kind):
        if kind not in ('full', 'small', 'original'):
            raise ValueError('Unknown asset type')
        with self.db() as db:
            row = db.execute('SELECT directory,metadata FROM versions WHERE id=?', (version,)).fetchone()
        if not row or kind not in json.loads(row['metadata'])['files']:
            raise ValueError('Asset not found')
        path = Path(row['directory']) / json.loads(row['metadata'])['files'][kind]['name']
        if not path.resolve().is_relative_to(self.root / 'versions'):
            raise ValueError('Asset escaped the version store')
        return path

    def similar(self, version, limit=8):
        snapshot = self.snapshot()
        source = next((v for v in snapshot['versions'] if v['id'] == version), None)
        if not source:
            raise ValueError('Unknown version')
        h = int(source['metadata']['dhash'], 16)
        ranked = []
        for v in snapshot['versions']:
            if v['id'] == version:
                continue
            ranked.append({'id': v['id'], 'scene': v['scene'],
                           'distance': (h ^ int(v['metadata']['dhash'], 16)).bit_count(),
                           'identical': v['metadata']['files']['full']['sha256'] == source['metadata']['files']['full']['sha256']})
        return sorted(ranked, key=lambda x: (not x['identical'], x['distance']))[:limit]

    def export(self, name, pending=False):
        identifier(name)
        target = self.root / 'exports' / name
        if target.exists():
            raise ValueError('Export already exists; use a new batch name')
        snapshot = self.snapshot()
        versions = {v['id']: v for v in snapshot['versions']}
        picks = [(s, v) for s in snapshot['scenes'] for v in
                 ([v for v in versions.values() if v['scene'] == s['id'] and v['state'] == 'pending']
                  if pending else ([versions[s['selected']]] if s['selected'] else []))]
        target.parent.mkdir(exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix='.export-', dir=target.parent))
        entries = []
        for scene, version in picks:
            entry = {'scene': scene['id'], 'name': scene['name'], 'version': version['id'],
                     'review': version['state'], 'assets': {}}
            for kind in ('full', 'small'):
                source = self.asset(version['id'], kind)
                expected = version['metadata']['files'][kind]['sha256']
                dest = staging / f"{scene['id']}-{version['id']}-{kind}.webp"
                shutil.copyfile(source, dest)
                if digest(dest) != expected or dest.stat().st_size > 3_000_000:
                    raise ValueError('Export asset hash or size check did not pass')
                entry['assets'][kind] = {'path': dest.name, 'sha256': expected}
            entries.append(entry)
        (staging / 'manifest.json').write_text(json.dumps({'preview': pending, 'entries': entries}, indent=2) + '\n')
        # mkdir is the no-clobber reservation; only a complete batch is renamed into it.
        target.mkdir()
        try:
            staging.replace(target)
        except BaseException:
            target.rmdir()
            raise
        with self.db() as db:
            self.event(db, 'exported', name, {'preview': pending, 'count': len(entries)})
        return str(target)

    def backup(self, name):
        """Consistent local recovery copy. Restore to the recorded original root."""
        identifier(name)
        target = self.root / 'backups' / name
        target.mkdir(parents=True, exist_ok=False)
        # Hold the writer reservation while snapshotting records and immutable assets.
        # Generators may finish externally; their receipts will wait for this transaction.
        with self.db() as db:
            with sqlite3.connect(self.root / 'queue.sqlite3') as source:
                with sqlite3.connect(target / 'queue.sqlite3') as dest:
                    source.backup(dest)
            for folder in ('versions', 'references', 'handoffs', 'work'):
                if (self.root / folder).exists():
                    shutil.copytree(self.root / folder, target / folder)
            for row in db.execute('SELECT directory,metadata FROM versions'):
                for asset in json.loads(row['metadata'])['files'].values():
                    copied = target / Path(row['directory']).relative_to(self.root) / asset['name']
                    if digest(copied) != asset['sha256']:
                        raise ValueError('Backup asset verification did not pass')
            (target / 'backup.json').write_text(json.dumps({'complete': True, 'restoreRoot': str(self.root),
                                                          'at': time.time()}, indent=2) + '\n')
            self.event(db, 'backup', name, {'path': str(target)})
        return str(target)
