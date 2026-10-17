#!/usr/bin/env python3
"""Publish fresh matched ordinary factory pairs without replacing historical images."""
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
# The server launches this with isolated Python (-I); do not depend on sys.path.
_module = importlib.util.spec_from_file_location('imagen_import_pair', ROOT / 'scripts/import_pair.py')
import_pair = importlib.util.module_from_spec(_module)
_module.loader.exec_module(import_pair)
PROFILES = ('flux1-dev', 'flux2-dev-nf4')
NON_ARTWORK = re.compile(r'(?:^|[^a-z0-9])(?:proof|benchmark|migration|synthetic|smoke[-_ ]?test|test)(?:$|[^a-z0-9])', re.I)


def latest_pairs(db, excluded):
    groups = {}
    rows = db.execute('SELECT j.id,j.scene,j.spec,v.created,s.name FROM jobs j '
                      'JOIN versions v ON v.job=j.id LEFT JOIN scenes s ON s.id=j.scene '
                      "WHERE j.state='generated' AND v.state!='rejected' ORDER BY v.created DESC,j.id")
    for row in rows:
        spec = json.loads(row['spec'])
        profile = spec.get('model')
        if profile not in PROFILES or row['id'] in excluded or NON_ARTWORK.search(' '.join(
                str(value or '') for value in [row['id'], row['scene'], row['name'], spec.get('name')])):
            continue
        # Equal scene alone is insufficient: both outputs must share the actual
        # prompt, dimensions, settings/seed and reference inputs of the request.
        signature = json.dumps({key: spec.get(key) for key in (
            'prompt', 'width', 'height', 'settings', 'references')}, sort_keys=True, separators=(',', ':'))
        group = groups.setdefault((row['scene'], signature), {})
        group.setdefault(profile, dict(row))
    latest = {}
    for (scene, _signature), pair in groups.items():
        if not all(profile in pair for profile in PROFILES):
            continue
        completed = max(pair[profile]['created'] for profile in PROFILES)
        if scene not in latest or completed > latest[scene][0]:
            latest[scene] = (completed, pair)
    return sorted(latest.values(), key=lambda item: (item[0], item[1][PROFILES[0]]['scene']))


def synchronize(factory):
    data = ROOT / 'data'
    data.mkdir(exist_ok=True)
    with (data / '.import.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        path = data / 'comparisons.json'
        collection = json.loads(path.read_text()) if path.exists() else {'schemaVersion': 1, 'comparisons': []}
        if collection.get('schemaVersion') != 1 or not isinstance(collection.get('comparisons'), list):
            raise ValueError('Unknown comparison record format')
        exclusions_path = ROOT / 'exclusions.json'
        exclusions = json.loads(exclusions_path.read_text()) if exclusions_path.exists() else {'exclusions': []}
        excluded = {job for row in exclusions['exclusions'] if row.get('enabled') is True for job in row.get('jobIds', [])}
        existing = {(row.get('left', {}).get('jobId'), row.get('right', {}).get('jobId')) for row in collection['comparisons']}
        existing_ids = {row['id'] for row in collection['comparisons']}
        added = skipped = 0
        with sqlite3.connect((factory / 'queue.sqlite3').as_uri() + '?mode=ro', uri=True, timeout=3) as db:
            db.row_factory = sqlite3.Row
            for completed, pair in latest_pairs(db, excluded):
                jobs = tuple(pair[profile]['id'] for profile in PROFILES)
                if jobs in existing:
                    continue
                scene = pair[PROFILES[0]]['scene']
                suffix = hashlib.sha256(('\0'.join(jobs)).encode()).hexdigest()[:20]
                ident = f'{scene}-pair-{suffix}'
                if ident in existing_ids:
                    raise ValueError('Comparison identity collision')
                try:
                    left, right = [import_pair.side(db, factory, data, job) for job in jobs]
                    if any(side.get('seconds') is None or not side.get('image') for side in [left, right]):
                        skipped += 1
                        continue
                except (ValueError, OSError, KeyError, TypeError):
                    skipped += 1
                    continue
                title = pair[PROFILES[0]]['name'] or json.loads(pair[PROFILES[0]]['spec']).get('name') or scene
                collection['comparisons'].append({'id': ident, 'title': title, 'prompt': left['prompt'],
                    'createdAt': datetime.fromtimestamp(completed, timezone.utc).isoformat(),
                    'left': left, 'right': right})
                existing.add(jobs)
                existing_ids.add(ident)
                added += 1
        if added:
            collection['updatedAt'] = datetime.now(timezone.utc).isoformat()
            import_pair.atomic_json(path, collection)
        return {'changed': bool(added), 'added': added, 'comparisons': len(collection['comparisons']), 'skipped': skipped}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    portable = ROOT / 'deployment/controller/tools/artwork/.state'
    legacy = ROOT.parent / 'kinship-of-cancer/tools/artwork/.state'
    default = portable if (portable / 'queue.sqlite3').is_file() else legacy
    parser.add_argument('--state', type=Path, default=Path(os.environ.get('ARTWORK_FACTORY_STATE', default)))
    args = parser.parse_args()
    print(json.dumps(synchronize(args.state.expanduser().resolve())))


if __name__ == '__main__':
    main()
