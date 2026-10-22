"""Download the pinned Transformers FP8 encoder and verify upstream hashes."""
import hashlib
import json
from pathlib import Path
import struct

from huggingface_hub import snapshot_download

root = Path('/workspace/artwork')
pin = json.loads((root / 'models/flux2-fp8.pins.json').read_text())
destination = root / 'models/flux2-fp8'
token_path = root / 'hf/token'
snapshot_download(pin['repo'], revision=pin['revision'], local_dir=destination,
                  allow_patterns=[item['path'] for item in pin['files']], max_workers=4,
                  token=token_path.read_text().strip() if token_path.exists() else None)
for item in pin['files']:
    file = destination / item['path']
    if file.stat().st_size != item['bytes']:
        raise ValueError('Encoder file size mismatch: ' + item['path'])
    if item.get('sha256'):
        digest = hashlib.sha256()
        with file.open('rb') as stream:
            for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b''):
                digest.update(chunk)
        if digest.hexdigest() != item['sha256']:
            raise ValueError('Encoder hash mismatch: ' + item['path'])
    if file.suffix == '.safetensors':
        with file.open('rb') as stream:
            length = struct.unpack('<Q', stream.read(8))[0]
            if length > 64 * 1024 * 1024:
                raise ValueError('Oversized safetensors header')
            json.loads(stream.read(length))
    print(json.dumps({'verified': item['path'], 'bytes': item['bytes']}), flush=True)
(destination / '.download-complete.json').write_text(json.dumps(pin, indent=2) + '\n')
print(json.dumps({'complete': True, 'repo': pin['repo'], 'revision': pin['revision']}), flush=True)
