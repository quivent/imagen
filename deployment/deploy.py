#!/usr/bin/env python3
"""Validate this source bundle or stage it on an idle replacement Vast host."""
import argparse
import ast
import configparser
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
TARGET = Path('/workspace/artwork')
FORBIDDEN = {'.state', '.runtime', '__pycache__', 'node_modules', '.venv', '.download-venv', 'hf', 'wheelhouse'}


def check(verify_manifest=True):
    files = [p for p in HERE.rglob('*') if p.is_file() and
             not any(part in FORBIDDEN for part in p.relative_to(HERE).parts)]
    for file in files:
        relative = file.relative_to(HERE)
        if file.is_symlink() or any(part in FORBIDDEN for part in relative.parts):
            raise ValueError('Runtime material in deployment bundle: ' + str(relative))
        if file.stat().st_size > 1_000_000 or file.suffix in {'.png', '.jpg', '.webp', '.safetensors', '.bin', '.sqlite3', '.log', '.whl'}:
            raise ValueError('Non-source deployment file: ' + str(relative))
        text = file.read_text()
        if re.search(r'hf_[A-Za-z0-9]{20,}|-----BEGIN (?:OPENSSH|RSA|EC) PRIVATE KEY-----|AKIA[A-Z0-9]{16}', text):
            raise ValueError('Possible private credential in ' + str(relative))
        if file.suffix == '.py':
            ast.parse(text, filename=str(file))
        elif file.suffix in {'.json', '.json.in'}:
            json.loads(text)
        elif file.name.endswith('.plist.in'):
            plistlib.loads(file.read_bytes())
        elif file.suffix == '.conf':
            parser = configparser.RawConfigParser()
            parser.read_string(text)
        elif file.suffix == '.sh':
            subprocess.run(['bash', '-n', str(file)], check=True)
    source = json.loads((HERE / 'worker/native/source.json').read_text())
    for name, expected in source['files'].items():
        actual = hashlib.sha256((HERE / 'worker/native/source' / name).read_bytes()).hexdigest()
        if actual != expected:
            raise ValueError('Original native source hash mismatch: ' + name)
    manifest = HERE / 'SOURCE-MANIFEST.json'
    if manifest.exists() and verify_manifest:
        for relative, expected in json.loads(manifest.read_text())['sha256'].items():
            if hashlib.sha256((HERE / relative).read_bytes()).hexdigest() != expected:
                raise ValueError('Deployment source hash mismatch: ' + relative)
    print(json.dumps({'ok': True, 'sourceFiles': len(files), 'nativeOriginalHashes': 'verified',
                      'changesApplied': False}))


def update_manifest():
    check(verify_manifest=False)
    hashes = {}
    for file in sorted(HERE.rglob('*')):
        relative = file.relative_to(HERE)
        if not file.is_file() or str(relative) == 'SOURCE-MANIFEST.json' or any(part in FORBIDDEN for part in relative.parts):
            continue
        hashes[relative.as_posix()] = hashlib.sha256(file.read_bytes()).hexdigest()
    manifest = {'schema': 1, 'scope': 'Source-only application redeployment closure',
                'nativeOriginalFilesUnchanged': True,
                'transformations': ['Temporary CUDA-wheel file URLs normalized to exact published versions.',
                                    'Historical coordinator identities removed from deployment templates.',
                                    'Factory state paths made configurable and retired SSH defaults removed.',
                                    'Private environment values and runtime data excluded.'],
                'excluded': ['weights', 'images', 'queues', 'journals', 'request ledgers', 'credentials',
                             'private SSH keys', 'binaries', 'logs', 'virtual environments', 'synthetic render scripts'],
                'sha256': hashes}
    (HERE / 'SOURCE-MANIFEST.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'manifestFiles': len(hashes)}))


def idle_host():
    if sys.platform != 'linux' or not Path('/etc/vast-agents-guide.md').exists():
        raise SystemExit('Install on the intended Linux Vast base image after reading its agent guide.')
    result = subprocess.run(['supervisorctl', 'status'], capture_output=True, text=True, check=False)
    active = [line.split()[0] for line in result.stdout.splitlines()
              if line.startswith('artwork-') and any(state in line for state in ('RUNNING', 'STARTING'))]
    if active:
        raise SystemExit('Existing artwork services were left untouched: ' + ', '.join(active))
    for executable in ('uv', 'supervisorctl', 'nvidia-smi'):
        if not shutil.which(executable):
            raise SystemExit('Required platform executable is missing: ' + executable)
    if not Path('/venv/main/bin/python').exists():
        raise SystemExit('Expected Vast Python base /venv/main/bin/python is missing.')


def install(public_key=None):
    check()
    idle_host()
    TARGET.mkdir(parents=True, exist_ok=True)
    shutil.copytree(HERE / 'worker', TARGET, dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '.venv', '.download-venv',
                                                 '.uv-cache', '.state', '.runtime', 'credentials.json',
                                                 'token', 'id_ed25519*'))
    for name in ('jobs', 'native/output', 'native/timings', 'control/requests', 'hf', 'models'):
        (TARGET / name).mkdir(parents=True, exist_ok=True)
    for source in (HERE / 'supervisor-scripts').glob('*.sh'):
        target = Path('/opt/supervisor-scripts') / source.name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        target.chmod(0o755)
    for source in (HERE / 'supervisor').glob('*.conf'):
        # Source snapshots retain observed autostart values. Fresh deployments
        # stage every program stopped until its dependencies and private state exist.
        text = re.sub(r'^autostart=.*$', 'autostart=false', source.read_text(), flags=re.M)
        target = Path('/etc/supervisor/conf.d') / source.name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
    if public_key:
        key = Path(public_key).read_text().strip()
        if not re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/=]+(?: [^\r\n]+)?', key):
            raise ValueError('Use an Ed25519 PUBLIC key, never a private key.')
        directory = Path('/root/.ssh')
        directory.mkdir(mode=0o700, exist_ok=True)
        target = directory / 'authorized_keys'
        previous = target.read_text() if target.exists() else ''
        blob = key.split()[1]
        if not any(blob in line for line in previous.splitlines()):
            with target.open('a') as output:
                output.write(('\n' if previous and not previous.endswith('\n') else '') +
                             'restrict,command="/usr/bin/python3 -I /workspace/artwork/control/bridge.py" ' + key + '\n')
            target.chmod(0o600)
    subprocess.run(['supervisorctl', 'reread'], check=True)
    subprocess.run(['supervisorctl', 'update'], check=True)
    print('Source and services staged stopped. Provision private files, dependencies, and model downloads next.')


def dependencies(judges=False):
    idle_host()
    if not (TARGET / 'requirements.txt').exists():
        raise SystemExit('Stage source with install first.')
    env = {**os.environ, 'UV_CACHE_DIR': str(TARGET / '.uv-cache'),
           'UV_HTTP_TIMEOUT': '600', 'UV_HTTP_RETRIES': '10'}
    env.pop('UV_NO_CACHE', None)

    def run(arguments):
        subprocess.run(arguments, env=env, check=True)

    environments = [('.venv', 'runtime-environment.lock.txt'),
                    ('.download-venv', 'download-environment.lock.txt'),
                    ('r2/.venv', 'r2/environment.lock.txt')]
    if judges:
        environments.append(('judges/.venv', 'judges/runtime.lock.txt'))
    for name, lock in environments:
        directory = TARGET / name
        if not (directory / 'bin/python').exists():
            run(['uv', 'venv', '--python', '/usr/bin/python3' if name.startswith('judges') else '/venv/main/bin/python', str(directory)])
        arguments = ['uv', 'pip', 'install', '--python', str(directory / 'bin/python'),
                     '-r', str(TARGET / lock)]
        if name == '.venv':
            arguments.extend(['--extra-index-url', 'https://download.pytorch.org/whl/cu130',
                              '--index-strategy', 'unsafe-best-match'])
        run(arguments)
    run([str(TARGET / '.venv/bin/python'), '-c',
         "import torch,torchvision,diffusers,transformers,bitsandbytes; assert torch.cuda.is_available(); print(torch.__version__)"])
    (TARGET / 'runtime-ready').touch()
    if judges:
        (TARGET / 'judges/runtime-ready').touch()
    print('Pinned Python environments installed. No generation or model service started.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    commands.add_parser('check')
    commands.add_parser('manifest')
    install_parser = commands.add_parser('install')
    install_parser.add_argument('--control-public-key')
    dependency_parser = commands.add_parser('dependencies')
    dependency_parser.add_argument('--judges', action='store_true')
    args = parser.parse_args()
    if args.action == 'check':
        check()
    elif args.action == 'manifest':
        update_manifest()
    elif args.action == 'install':
        install(args.control_public_key)
    else:
        dependencies(args.judges)


if __name__ == '__main__':
    main()
