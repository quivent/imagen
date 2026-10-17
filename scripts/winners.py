#!/usr/bin/env python3
"""Keep comparison choices separately from factory artwork acceptance."""
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import uuid

STUDIO = Path(__file__).resolve().parents[1]
LEGACY_STATE = Path.home() / 'kinship-of-cancer/tools/artwork/.state'
FACTORY_STATE = Path(os.environ.get('ARTWORK_FACTORY_STATE', str(LEGACY_STATE if LEGACY_STATE.exists() else STUDIO / 'deployment/controller/tools/artwork/.state')))
STATE = FACTORY_STATE / 'winners'
PUBLIC = STUDIO / 'winners.json'


def publish(record):
    descriptor, temporary = tempfile.mkstemp(prefix='.winners-', dir=STUDIO)
    try:
        with os.fdopen(descriptor, 'w') as output:
            json.dump(record, output, ensure_ascii=False, indent=2)
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, 0o644)
        os.replace(temporary, PUBLIC)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def choose(data):
    if set(data) != {'requestId', 'comparisonId', 'side', 'expectedRevision'}:
        raise ValueError('Unsupported choice fields')
    uuid.UUID(data['requestId'])
    if data['side'] not in ('left', 'right', None) or type(data['expectedRevision']) is not int or data['expectedRevision'] < 0:
        raise ValueError('Unsupported choice')
    manifest = json.loads((STUDIO / 'data' / 'comparisons.json').read_text())
    row = next((row for row in manifest['comparisons'] if row['id'] == data['comparisonId']), None)
    if row is None:
        raise ValueError('Unknown comparison')
    selection = None
    if data['side'] is not None:
        side = row.get(data['side'])
        if not isinstance(side, dict) or not side.get('image'):
            raise ValueError('This image is not present yet')
        relative = Path(side['image'])
        if relative.parts[0] != 'data' or any(part.startswith('.') for part in relative.parts):
            raise ValueError('Unsafe artwork path')
        file = STUDIO / relative
        if file.resolve(strict=True) != file or not file.is_file():
            raise ValueError('Artwork must be an original regular file')
        digest = hashlib.sha256(file.read_bytes()).hexdigest()
        if side.get('imageSha256') and digest != side['imageSha256']:
            raise ValueError('Artwork provenance does not match')
        keys = ['model', 'image', 'jobId', 'versionId', 'width', 'height', 'seconds', 'precision', 'seed', 'steps']
        selection = {key: side[key] for key in keys if key in side}
        selection['imageSha256'] = digest
    STATE.mkdir(parents=True, exist_ok=True)
    canonical = json.dumps(data, sort_keys=True, separators=(',', ':'))
    with (STATE / 'write.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        database = STATE / 'choices.sqlite3'
        with sqlite3.connect(database, timeout=5) as db:
            database.chmod(0o600)
            db.execute('PRAGMA synchronous=FULL')
            db.execute('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), record TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, body TEXT NOT NULL)')
            db.execute('BEGIN IMMEDIATE')
            saved = db.execute('SELECT record FROM state WHERE id=1').fetchone()
            record = json.loads(saved[0]) if saved else json.loads(PUBLIC.read_text())
            if record.get('schemaVersion') != 1 or not isinstance(record.get('revisions'), dict):
                raise ValueError('Unsupported choice record')
            previous = db.execute('SELECT body FROM requests WHERE id=?', (data['requestId'],)).fetchone()
            if previous:
                if previous[0] != canonical:
                    return {'ok': False, 'status': 409, 'record': record}
                db.commit()
                publish(record)
                return {'ok': True, 'idempotent': True, 'record': record}
            current_revision = record['revisions'].get(data['comparisonId'], 0)
            if current_revision != data['expectedRevision']:
                return {'ok': False, 'status': 409, 'record': record}
            winners = record['winners']
            old = next((entry for entry in winners if entry['comparisonId'] == data['comparisonId']), None)
            changed = (old is not None) if selection is None else old is None or old['side'] != data['side'] or old['selection'] != selection
            if changed:
                record['revision'] += 1
                record['updatedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')
                record['revisions'][data['comparisonId']] = current_revision + 1
                record['winners'] = [entry for entry in winners if entry['comparisonId'] != data['comparisonId']]
                if selection is not None:
                    record['winners'].append({'comparisonId': data['comparisonId'], 'title': row['title'], 'side': data['side'], 'revision': current_revision + 1, 'selectedAt': record['updatedAt'], 'selection': selection})
            db.execute('INSERT OR REPLACE INTO state VALUES(1,?)', (json.dumps(record),))
            db.execute('INSERT INTO requests VALUES(?,?)', (data['requestId'], canonical))
            db.commit()
            publish(record)
            return {'ok': True, 'record': record}


if __name__ == '__main__':
    try:
        text = sys.stdin.read(2049)
        if len(text) > 2048:
            raise ValueError('Choice is too large')
        print(json.dumps(choose(json.loads(text))))
    except (ValueError, KeyError, TypeError, OSError):
        print(json.dumps({'ok': False, 'status': 400, 'detail': 'The choice could not be kept. Check the current comparison and try again.'}))
