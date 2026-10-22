#!/usr/bin/env python3
"""Download and verify the existing beauty judges. Never imports a GPU framework."""
import argparse
import fcntl
import hashlib
import json
import logging
import os
from pathlib import Path
import shutil
import sys
import time

MODELS = {
    'gemma4-12b-it-nvfp4': {
        'repo': 'unsloth/gemma-4-12b-it-NVFP4',
        'revision': 'b1f649734b34aa5575b03d186abd1b9be3d0d5c4',
    },
    'gemma4-12b-it-assistant': {
        'repo': 'google/gemma-4-12B-it-assistant',
        'revision': '46d4c6f13f0ac0ad827b915669b8df9b81c64c51',
    },
}


def save(path, data):
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(data, indent=2) + '\n')
    temp.replace(path)


def log(root, message):
    line = f'{time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())} {message}'
    print(line, flush=True)
    with (root / 'download.log').open('a') as stream:
        stream.write(line + '\n')


def run(root):
    os.environ['HF_HOME'] = '/workspace/artwork/hf'
    os.environ['HF_HUB_DISABLE_PROGRESS_BARS'] = '1'
    logging.getLogger('huggingface_hub').setLevel(logging.CRITICAL)
    from huggingface_hub import HfApi, snapshot_download
    api = HfApi()
    models = {}
    for name in ('gemma4-12b-it-nvfp4', 'gemma4-12b-it-assistant'):
        choice = MODELS[name]
        info = api.model_info(choice['repo'], revision=choice['revision'], files_metadata=True)
        assert info.sha == choice['revision']
        files = {
            f.rfilename: {'bytes': f.size, 'sha256': f.lfs.sha256 if f.lfs else None}
            for f in info.siblings
            if f.rfilename != '.gitattributes' and not f.rfilename.endswith('.bin')
        }
        models[name] = {**choice, 'files': files, 'bytes': sum(f['bytes'] for f in files.values())}
    save(root / 'models.manifest.json', {'schema': 1, 'models': models})
    required = sum(m['bytes'] for m in models.values())
    if shutil.disk_usage(root).free < required + 5_000_000_000:
        raise RuntimeError('Insufficient free space')
    receipt = {'schema': 1, 'complete': False, 'models': {}}
    for name, model in models.items():
        destination = root.parent / 'models' / name
        log(root, f"{name}: downloading pinned snapshot ({model['bytes']} bytes)")
        save(root / 'status.json', {'phase': 'downloading', 'model': name, 'bytes': model['bytes'], 'updated_at': time.time()})
        snapshot_download(repo_id=model['repo'], revision=model['revision'],
                          allow_patterns=list(model['files']), local_dir=destination, max_workers=4)
        save(root / 'status.json', {'phase': 'verifying', 'model': name, 'updated_at': time.time()})
        verified = {}
        for relative, expected in model['files'].items():
            path = destination / relative
            if path.stat().st_size != expected['bytes']:
                raise ValueError('File size mismatch')
            digest = hashlib.sha256()
            with path.open('rb') as stream:
                for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b''):
                    digest.update(chunk)
            sha = digest.hexdigest()
            if expected['sha256'] and sha != expected['sha256']:
                raise ValueError('File hash mismatch')
            if path.suffix == '.json':
                json.loads(path.read_text())
            if path.suffix == '.safetensors':
                with path.open('rb') as stream:
                    header_size = int.from_bytes(stream.read(8), 'little')
                    if not 0 < header_size < 100_000_000:
                        raise ValueError('Invalid safetensors header')
                    header = json.loads(stream.read(header_size))
                    payload = path.stat().st_size - 8 - header_size
                    for key, value in header.items():
                        if key != '__metadata__':
                            begin, end = value['data_offsets']
                            if not 0 <= begin <= end <= payload:
                                raise ValueError('Invalid tensor offsets')
            verified[relative] = {'bytes': expected['bytes'], 'sha256': sha,
                                  'upstream_sha256_checked': bool(expected['sha256'])}
        index = destination / 'model.safetensors.index.json'
        if index.exists():
            for shard in set(json.loads(index.read_text())['weight_map'].values()):
                if shard not in verified:
                    raise ValueError('Missing indexed weight shard')
        receipt['models'][name] = {k: model[k] for k in ('repo', 'revision', 'bytes')}
        receipt['models'][name].update({'path': str(destination), 'files': verified, 'verified_at': time.time()})
        save(root / 'download-receipt.json', receipt)
        log(root, f"{name}: all {len(verified)} files verified; {model['bytes']} bytes")
    receipt.update({'complete': True, 'completed_at': time.time()})
    save(root / 'download-receipt.json', receipt)
    save(root / 'status.json', {'phase': 'complete', 'updated_at': time.time()})
    log(root, 'Gemma 4 NVFP4 target and assistant drafter verified. No inference process started.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path('/workspace/artwork/judges/gemma4-download'))
    root = parser.parse_args().root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    with (root / '.download.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            run(root)
        except Exception as exc:
            status = getattr(getattr(exc, 'response', None), 'status_code', None)
            detail = f' HTTP {status}' if isinstance(status, int) else ''
            # Do not log exception messages: upstream errors may carry signed URLs.
            log(root, f'Download paused: {type(exc).__name__}{detail}; retained files resume on restart')
            save(root / 'status.json', {'phase': 'retrying', 'problem': type(exc).__name__, 'updated_at': time.time()})
            time.sleep(30)
            sys.exit(1)
