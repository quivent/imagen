#!/usr/bin/env python3
"""Supervise the artwork Mac-to-gateway reverse tunnel with user launchd."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent
RUNTIME = ROOT / '.runtime'
LABEL = 'giving.kinship.artwork-ingress'
GATEWAY = 'oscillihue@88.216.68.234'
FORWARD = '127.0.0.1:48630:127.0.0.1:48624'


def command():
    return [shutil.which('ssh') or '/usr/bin/ssh', '-NT',
            '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
            '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15',
            '-o', 'ServerAliveCountMax=3', '-o', 'ConnectTimeout=10',
            '-R', FORWARD, GATEWAY]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'stop', 'status', 'check'])
    args = parser.parse_args()
    service = f'gui/{os.getuid()}/{LABEL}'
    if args.action == 'check':
        compile(Path(__file__).read_text(), str(Path(__file__)), 'exec')
        plistlib.loads(plistlib.dumps({'Label': LABEL, 'ProgramArguments': command()}))
        print('Artwork ingress helper parses; SSH and launchd configuration valid.')
        return
    status = subprocess.run(['launchctl', 'print', service], capture_output=True, text=True)
    if args.action == 'status':
        pid = next((line.strip().split(' = ', 1)[1] for line in status.stdout.splitlines()
                    if line.strip().startswith('pid = ')), None)
        print(json.dumps({'loaded': status.returncode == 0, 'pid': int(pid) if pid else None,
                          'gateway': GATEWAY, 'forward': FORWARD,
                          'note': 'Process status only; verify the public HTTPS route separately.'}))
    elif args.action == 'stop':
        if status.returncode == 0:
            subprocess.run(['launchctl', 'bootout', service], check=True)
    elif status.returncode == 0:
        print('Artwork ingress is already loaded. Use status to inspect it.')
    else:
        RUNTIME.mkdir(exist_ok=True)
        path = RUNTIME / f'{LABEL}.plist'
        config = {'Label': LABEL, 'ProgramArguments': command(), 'WorkingDirectory': str(ROOT),
                  'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 10,
                  'StandardOutPath': str(RUNTIME / 'tunnel.log'),
                  'StandardErrorPath': str(RUNTIME / 'tunnel.log')}
        with path.open('wb') as output:
            plistlib.dump(config, output)
        subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(path)], check=True)
        print('Artwork ingress loaded. Verify the public HTTPS route before marking it ready.')


if __name__ == '__main__':
    main()
