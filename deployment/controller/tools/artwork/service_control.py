#!/usr/bin/env python3
"""Install/start or stop the loopback review desk with macOS launchd."""
import argparse
import os
from pathlib import Path
import plistlib
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'stop', 'status'])
    parser.add_argument('--state', default=str(Path(__file__).parent / '.state'))
    parser.add_argument('--port', type=int, default=48620)
    args = parser.parse_args()
    root = Path(args.state).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    label = 'giving.kinship.artwork-desk'
    domain = f'gui/{os.getuid()}'
    target = domain + '/' + label
    plist = root / 'service.plist'
    if args.action == 'start':
        config = {'Label': label, 'ProgramArguments': [sys.executable, str(Path(__file__).with_name('artwork.py').resolve()),
                  '--state', str(root), 'serve', '--port', str(args.port)],
                  'WorkingDirectory': str(Path(__file__).resolve().parents[2]),
                  'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 10,
                  'StandardOutPath': str(root / 'service.log'), 'StandardErrorPath': str(root / 'service.stderr.log')}
        plist.write_bytes(plistlib.dumps(config)); plist.chmod(0o600)
        existing = subprocess.run(['launchctl', 'print', target], capture_output=True)
        if existing.returncode == 0:
            print(f'Service already loaded: {target}'); return
        subprocess.run(['launchctl', 'bootstrap', domain, str(plist)], check=True)
        print(f'Artwork desk started: http://127.0.0.1:{args.port}')
    elif args.action == 'stop':
        subprocess.run(['launchctl', 'bootout', target], check=True)
    else:
        result = subprocess.run(['launchctl', 'print', target], capture_output=True, text=True)
        print('Loaded' if result.returncode == 0 else 'Not loaded')
        for line in result.stdout.splitlines():
            if line.strip().startswith(('state =', 'pid =', 'last exit code =')):
                print(line.strip())


if __name__ == '__main__':
    main()
