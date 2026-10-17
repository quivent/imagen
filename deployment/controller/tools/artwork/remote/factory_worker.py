#!/usr/bin/env python3
"""Keep the existing factory command adapter running independently of a conversation."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
FACTORY_STATE = Path(os.environ.get('ARTWORK_FACTORY_STATE', str(ROOT / '.state')))
LABEL = 'giving.kinship.artwork-flux'
DOMAIN = 'gui/' + str(os.getuid())
PROFILES = ('flux1-dev', 'flux2-dev-nf4')
SLOTS = ('primary', 'pipeline')


def services():
    return [(profile, slot, LABEL + '.' + profile + ('.pipeline' if slot == 'pipeline' else ''))
            for profile in PROFILES for slot in SLOTS]


def loaded(label):
    return subprocess.run(['launchctl', 'print', DOMAIN + '/' + label],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'stop', 'status'])
    args = parser.parse_args()
    if args.action == 'status':
        for profile, slot, label in services():
            result = subprocess.run(['launchctl', 'print', DOMAIN + '/' + label], capture_output=True, text=True)
            print(profile + ' ' + slot + ': ' + ('loaded' if result.returncode == 0 else 'not loaded'))
            for line in result.stdout.splitlines():
                if line.strip().startswith(('state =', 'pid =', 'last exit code =')):
                    print(line.strip())
        return
    if args.action == 'stop':
        for label in [LABEL, *[label for _, _, label in services()]]:
            if loaded(label):
                subprocess.run(['launchctl', 'bootout', DOMAIN + '/' + label], check=True)
        return
    if not os.environ.get('ARTWORK_SSH_HOST') or not os.environ.get('ARTWORK_SSH_PORT'):
        raise SystemExit('Set explicit ARTWORK_SSH_HOST and ARTWORK_SSH_PORT before starting adapters.')
    if loaded(LABEL):
        # Retire the old shared pool only while idle. A model-specific claim
        # prevents two FLUX.2 requests occupying both slots and idling GPU 0.
        import sqlite3
        with sqlite3.connect(FACTORY_STATE / 'queue.sqlite3') as db:
            active = db.execute("SELECT count(*) FROM jobs WHERE backend='command' AND state IN ('active','submitted')").fetchone()[0]
        if active:
            raise SystemExit('The previous shared worker is finishing active requests; rerun start when they finish.')
        subprocess.run(['launchctl', 'bootout', DOMAIN + '/' + LABEL], check=True)
    state = FACTORY_STATE / 'flux-comparison'
    state.mkdir(parents=True, exist_ok=True)
    argv = state / 'argv.json'
    argv.write_text(json.dumps([sys.executable, str(Path(__file__).with_name('adapter.py'))]) + '\n')
    for profile, slot, label in services():
        if loaded(label):
            print(profile + ' ' + slot + ' adapter already running')
            continue
        config = {'Label': label, 'ProgramArguments': [sys.executable, '-B', str(ROOT / 'artwork.py'), '--state', str(FACTORY_STATE),
                  'worker', '--backend', 'command', '--model', profile, '--concurrency', '1', '--argv', str(argv)],
                  'WorkingDirectory': str(ROOT), 'RunAtLoad': True, 'KeepAlive': True,
                  'ThrottleInterval': 10, 'ExitTimeOut': 950,
                  'StandardOutPath': str(state / ('worker-' + profile + '-' + slot + '.log')),
                  'StandardErrorPath': str(state / ('worker-' + profile + '-' + slot + '-error.log')),
                  'EnvironmentVariables': {'PATH': '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
                     'ARTWORK_SSH_HOST': os.environ['ARTWORK_SSH_HOST'],
                     'ARTWORK_SSH_PORT': os.environ['ARTWORK_SSH_PORT'],
                     'ARTWORK_FACTORY_STATE': str(FACTORY_STATE), 'ARTWORK_STATE': str(FACTORY_STATE)}}
        plist = Path.home() / 'Library' / 'LaunchAgents' / (label + '.plist')
        plist.parent.mkdir(parents=True, exist_ok=True)
        with plist.open('wb') as stream:
            plistlib.dump(config, stream)
        subprocess.run(['launchctl', 'bootstrap', DOMAIN, str(plist)], check=True)
        print(profile + ' ' + slot + ' adapter started; remote generation remains serialized')


if __name__ == '__main__':
    main()
