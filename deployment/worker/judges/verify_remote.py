#!/usr/bin/env python3
"""Exercise resident judges on an immutable FLUX1 output and retain proof."""
import base64
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import time
import urllib.error
import urllib.request

ROOT = Path('/workspace/artwork/judges')


def request(port, path, body=None, timeout=90):
    raw = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(f'http://127.0.0.1:{port}{path}', data=raw,
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as reply:
        return json.load(reply)


def main():
    # Completed result files are atomically published by the generation workers.
    images = list(Path('/workspace/artwork/jobs/flux1-dev').glob('*/result.png'))
    if not images:
        raise RuntimeError('No FLUX1 result image is available for verification')
    source = max(images, key=lambda p: p.stat().st_mtime)
    raw = source.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    image = 'data:image/png;base64,' + base64.b64encode(raw).decode()
    proof = {'observed_at': datetime.now(timezone.utc).isoformat(),
             'image': {'path': str(source), 'sha256': digest},
             'dino_health': request(8003, '/health'),
             'pixtral_models': request(8002, '/v1/models'),
             'flux_before': {str(p): request(p, '/health') for p in (18761, 18762)}}
    started = time.monotonic()
    embedded = request(8003, '/v1/embeddings', {'model': 'dinov2-giant', 'input': image})
    vector = embedded['data'][0]['embedding']
    assert len(vector) == proof['dino_health']['dimensions']
    norm = math.sqrt(sum(v*v for v in vector))
    assert all(math.isfinite(v) for v in vector) and abs(norm - 1) < 0.001
    same = request(8003, '/v1/compare', {'image_a': image, 'image_b': image})
    assert same['cosine_similarity'] > 0.999
    try:
        request(8003, '/v1/embeddings', {'input': 'http://127.0.0.1/private'})
        raise AssertionError('DINO accepted a network image URL')
    except urllib.error.HTTPError as exc:
        assert exc.code == 422
    proof['dino'] = {'seconds': time.monotonic() - started, 'dimensions': len(vector),
                     'norm': norm, 'self_comparison': same, 'network_url_rejected': True}
    started = time.monotonic()
    answer = request(8002, '/v1/chat/completions', {
        'model': 'pixtral-critic', 'temperature': 0.1, 'max_tokens': 180,
        'messages': [{'role': 'user', 'content': [
            {'type': 'text', 'text': 'Describe the visible scene in this artwork in one sentence. '
             'Then offer one specific visual change to strengthen its composition or lighting. '
             'Ground your feedback in what is actually visible.'},
            {'type': 'image_url', 'image_url': {'url': image}},
        ]}],
    })
    content = answer['choices'][0]['message']['content']
    assert isinstance(content, str) and len(content.strip()) > 30
    proof['pixtral'] = {'seconds': time.monotonic() - started, 'response': answer}
    proof['flux_after'] = {str(p): request(p, '/health') for p in (18761, 18762)}
    assert hashlib.sha256(source.read_bytes()).hexdigest() == digest
    proof['ok'] = True
    dest = ROOT / 'setup-proof.json'
    temp = dest.with_suffix('.tmp')
    temp.write_text(json.dumps(proof, indent=2) + '\n')
    temp.replace(dest)
    print(json.dumps({'ok': True, 'proof': str(dest), 'image_sha256': digest,
                      'dino_dimensions': len(vector), 'critique': content}, indent=2))


if __name__ == '__main__':
    main()
