#!/usr/bin/env python3
"""Keep a bounded authorized scene queue supplied through the artwork factory."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import plistlib
import sqlite3
import subprocess
import sys
import time

ARTWORK = Path(__file__).resolve().parents[1]
REPO = ARTWORK.parents[1]
STATE = Path(os.environ.get('ARTWORK_FACTORY_STATE', str(ARTWORK / '.state')))
RUNTIME = STATE / 'generation-refill'
LABEL = 'giving.kinship.artwork-refill'
PROFILES = ('flux1-dev', 'flux2-dev-nf4')
TARGET = 3
INTERVAL = 5
ACTIVE = {'queued', 'active', 'submitted'}
sys.path.insert(0, str(ARTWORK))


def refill():
    from store import Store
    scenes = json.loads((REPO / 'docs/artwork/geographic-scenes.json').read_text())['scenes']
    RUNTIME.mkdir(parents=True, exist_ok=True)
    with (RUNTIME / 'refill.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        connection = sqlite3.connect(f'file:{STATE / "queue.sqlite3"}?mode=ro', uri=True)
        try:
            jobs = [(scene, json.loads(spec), state) for scene, spec, state in connection.execute(
                "SELECT scene,spec,state FROM jobs WHERE backend='command'")]
        finally:
            connection.close()
        store = Store(STATE)
        report = {'checkedAt': time.time(), 'targetOutstandingPerModel': TARGET, 'models': []}
        for profile in PROFILES:
            own = [(scene, spec, state) for scene, spec, state in jobs if spec.get('model') == profile]
            active = sum(state in ACTIVE for _, _, state in own)
            added = []
            for _ in range(max(0, TARGET - active)):
                # First finish scenes never requested for this model. Failed or
                # uncertain jobs remain recorded and are never retried here.
                seen = {scene for scene, _, _ in own}
                pending = [scene for scene in scenes if scene['id'] not in seen]
                study_pass = 1
                while not pending:
                    study_pass += 1
                    variant = f'continuous-study-pass-{study_pass:04d}'
                    seen = {scene for scene, spec, _ in own if spec.get('variant') == variant}
                    pending = [scene for scene in scenes if scene['id'] not in seen]
                scene = pending[0]
                request = {'scene': scene['id'], 'name': scene['name'], 'backend': 'command',
                           'model': profile, 'prompt': scene['prompt'], 'width': 512, 'height': 512,
                           'settings': {'seed': 42 + study_pass - 1, 'steps': 28, 'guidance_scale': 3.5,
                                        'max_sequence_length': 512},
                           'variant': f'continuous-study-pass-{study_pass:04d}'}
                result = store.enqueue(request)
                own.append((scene['id'], request, 'queued'))
                added.append({'scene': scene['id'], 'pass': study_pass, **result})
            report['models'].append({'profile': profile, 'outstandingBefore': active, 'added': added})
        temporary = RUNTIME / 'status.tmp'
        temporary.write_text(json.dumps(report, indent=2) + '\n')
        temporary.replace(RUNTIME / 'status.json')
        if any(model['added'] for model in report['models']):
            print(json.dumps(report), flush=True)
        return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['once', 'run', 'start', 'stop', 'status', 'check'])
    args = parser.parse_args()
    service = f'gui/{os.getuid()}/{LABEL}'
    if args.action == 'check':
        compile(Path(__file__).read_text(), str(Path(__file__)), 'exec')
        data = json.loads((REPO / 'docs/artwork/geographic-scenes.json').read_text())['scenes']
        assert len({row['id'] for row in data}) == len(data) and all(row.get('prompt') for row in data)
        print(f'Refill helper parses; {len(data)} unique original scene prompts; no work submitted.')
        return
    if args.action == 'once':
        print(json.dumps(refill(), indent=2))
        return
    if args.action == 'run':
        while True:
            try:
                refill()
            except Exception as problem:
                print(f'Refill needs attention: {type(problem).__name__}: {problem}', flush=True)
            time.sleep(INTERVAL)
    state = subprocess.run(['launchctl', 'print', service], capture_output=True, text=True)
    if args.action == 'status':
        print(json.dumps({'loaded': state.returncode == 0,
                          'snapshot': json.loads((RUNTIME / 'status.json').read_text())
                          if (RUNTIME / 'status.json').exists() else None}))
    elif args.action == 'stop':
        if state.returncode == 0:
            subprocess.run(['launchctl', 'bootout', service], check=True)
    elif state.returncode != 0:
        RUNTIME.mkdir(parents=True, exist_ok=True)
        config = {'Label': LABEL, 'ProgramArguments': [sys.executable, '-B', str(Path(__file__).resolve()), 'run'],
                  'WorkingDirectory': str(ARTWORK), 'RunAtLoad': True, 'KeepAlive': True,
                  'ThrottleInterval': 10, 'StandardOutPath': str(RUNTIME / 'refill.log'),
                  'StandardErrorPath': str(RUNTIME / 'refill.log'),
                  'EnvironmentVariables': {'ARTWORK_FACTORY_STATE': str(STATE)}}
        path = RUNTIME / f'{LABEL}.plist'
        with path.open('wb') as output:
            plistlib.dump(config, output)
        subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(path)], check=True)
        print('Bounded artwork refill loaded; existing model adapters dispatch its factory jobs.')
    else:
        print('Artwork refill already loaded.')


if __name__ == '__main__':
    main()
