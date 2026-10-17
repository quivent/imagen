#!/usr/bin/env python3
"""Configure the existing Vercel API from a private env file without logging values."""
import argparse
import os
from pathlib import Path
import re
import stat
import subprocess

NAMES = ('ARTWORK_CONTROL_TOKEN', 'ARTWORK_SSH_KEY_B64', 'ARTWORK_SSH_HOST',
         'ARTWORK_SSH_PORT', 'ARTWORK_SSH_HOST_SHA256', 'ARTWORK_R2_ENDPOINT',
         'ARTWORK_R2_BUCKET', 'ARTWORK_R2_ACCESS_KEY_ID', 'ARTWORK_R2_SECRET_ACCESS_KEY')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('private_env_file', type=Path)
    parser.add_argument('--project', default='artwork-comparison')
    parser.add_argument('--scope', default='jbenjaminkr-8469s-projects')
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--deploy', action='store_true')
    args = parser.parse_args()
    info = args.private_env_file.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_size > 65536:
        raise SystemExit('Use a regular, mode-0600 private environment file outside Git.')
    values = {}
    for line in args.private_env_file.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        name, separator, value = line.partition('=')
        if separator and name in NAMES:
            values[name] = value.strip()
    if any(not values.get(name) or values[name].startswith('@') for name in NAMES):
        raise SystemExit('Every documented API variable must have a private value.')
    if not re.fullmatch(r'[a-f0-9]{64}', values['ARTWORK_SSH_HOST_SHA256']):
        raise SystemExit('SSH host pin must be the hexadecimal SHA-256 of the decoded public key blob.')
    if not re.fullmatch(r'[A-Za-z0-9.-]+', values['ARTWORK_SSH_HOST']):
        raise SystemExit('API SSH host is a hostname without root@.')
    if not values['ARTWORK_SSH_PORT'].isdigit() or not 1 <= int(values['ARTWORK_SSH_PORT']) <= 65535:
        raise SystemExit('Invalid API SSH port.')
    if args.check:
        print('Private API settings parse; no values printed or deployment changed.')
        return
    for name in NAMES:
        result = subprocess.run(['vercel', 'env', 'add', name, 'production', '--project', args.project,
                                 '--scope', args.scope, '--sensitive', '--yes', '--force'],
                                input=values[name], text=True, capture_output=True)
        if result.returncode:
            raise SystemExit('Vercel did not accept ' + name)
        print('Configured ' + name, flush=True)
    if args.deploy:
        subprocess.run(['vercel', 'deploy', '--cwd', str(Path(__file__).resolve().parent / 'api'),
                        '--project', args.project, '--scope', args.scope, '--prod', '--yes'], check=True)
    else:
        print('Redeploy the API before expecting the new production settings to take effect.')


if __name__ == '__main__':
    main()
