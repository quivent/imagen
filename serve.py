#!/usr/bin/env python3
"""Run the loopback Vite studio; supervise with user launchd."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import subprocess
import shutil
import sys
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
RUNTIME = ROOT / '.runtime'
LABEL = 'giving.kinship.artwork-comparison'
PORT = 48624


def health():
    try:
        with urlopen(f'http://127.0.0.1:{PORT}/', timeout=3) as response:
            return response.status == 200 and b'Artwork Studio' in response.read(4096)
    except OSError:
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['run', 'start', 'stop', 'status'])
    args = parser.parse_args()
    if args.action == 'run':
        os.chdir(ROOT)
        environment_file = RUNTIME / 'service-env.json'
        if environment_file.exists():
            values = json.loads(environment_file.read_text())
            for key in ('ARTWORK_SSH_HOST', 'ARTWORK_SSH_PORT', 'ARTWORK_MONITOR_ROOT_THREAD', 'ARTWORK_API_ORIGIN',
                        'ARTWORK_FACTORY_ROOT', 'ARTWORK_FACTORY_STATE', 'ARTWORK_CONTROL_TOKEN_FILE',
                        'ARTWORK_PYTHON'):
                if isinstance(values.get(key), str):
                    os.environ[key] = values[key]
        npm = shutil.which('npm')
        if not npm:
            raise RuntimeError('npm is required; install Node 22.12 or newer')
        os.execv(npm, [npm, 'run', 'dev', '--', '--host', '127.0.0.1', '--port', str(PORT), '--strictPort'])
        return
    service = f'gui/{os.getuid()}/{LABEL}'
    if args.action == 'status':
        print(json.dumps({'url': f'http://127.0.0.1:{PORT}', 'responding': health()}))
    elif args.action == 'stop':
        subprocess.run(['launchctl', 'bootout', service], check=False)
    else:
        RUNTIME.mkdir(exist_ok=True)
        loaded = subprocess.run(['launchctl', 'print', service], capture_output=True).returncode == 0
        if not loaded:
            config = {
                'Label': LABEL,
                'ProgramArguments': [sys.executable, '-B', str(Path(__file__).resolve()), 'run'],
                'WorkingDirectory': str(ROOT),
                'EnvironmentVariables': {'PATH': os.environ.get('PATH', os.defpath)},
                'RunAtLoad': True,
                'KeepAlive': True,
                'ThrottleInterval': 10,
                'StandardOutPath': str(RUNTIME / 'server.log'),
                'StandardErrorPath': str(RUNTIME / 'server.log'),
            }
            path = RUNTIME / f'{LABEL}.plist'
            with path.open('wb') as output:
                plistlib.dump(config, output)
            subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(path)], check=True)
        else:
            subprocess.run(['launchctl', 'kickstart', service], check=True)
        print(f'http://127.0.0.1:{PORT}')


if __name__ == '__main__':
    main()
