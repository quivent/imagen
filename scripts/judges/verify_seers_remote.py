#!/usr/bin/env python3
"""Verify real review capture for all Seers without displaying an image."""
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import time
import urllib.request

ROOT = Path('/workspace/artwork/judges')


def main():
    source = max(Path('/workspace/artwork/jobs/flux1-dev').glob('*/result.png'), key=lambda p: p.stat().st_mtime)
    raw = source.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    image = 'data:image/png;base64,' + base64.b64encode(raw).decode()
    started = time.time()

    def call(choice):
        model, port = choice
        if model == 'dinov2':
            path = '/v1/embeddings'
            body = {'model': 'dinov2-giant', 'input': image}
        else:
            path = '/v1/chat/completions'
            body = {'model': 'pixtral-critic' if model == 'pixtral' else 'gemma4-12b-artist',
                    'temperature': 0.1, 'max_tokens': 160, 'stream': model == 'pixtral',
                    'messages': [{'role': 'user', 'content': [
                        {'type': 'image_url', 'image_url': {'url': image}},
                        {'type': 'text', 'text': 'Review this artwork for the Seers panel. '
                         'Describe its visible composition and palette, then suggest one concrete visual refinement.'},
                    ]}]}
            if model == 'gemma':
                body['chat_template_kwargs'] = {'enable_thinking': False}
        request = urllib.request.Request(f'http://127.0.0.1:{port}{path}',
                    data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=120) as response:
            response.read()
        # Response delivery and the observer's finally block can finish in adjacent loop turns.
        for _ in range(20):
            record = json.loads((ROOT / 'seers' / model / 'state.json').read_text())
            last = record.get('last') or {}
            if last.get('startedAt', 0) >= started and last.get('state') == 'complete':
                break
            time.sleep(0.1)
        assert not record['active'], model
        assert last['images'][0]['sha256'] == digest, model
        assert last['feedback']['text'], model
        return {'id': model, 'reviewId': last['id'], 'sha256': last['images'][0]['sha256'],
                'kind': last['feedback']['kind'], 'finishedAt': last['finishedAt']}

    with ThreadPoolExecutor(max_workers=3) as pool:
        models = list(pool.map(call, [('pixtral', 8002), ('dinov2', 8003), ('gemma', 8004)]))
    proof = {'ok': True, 'observedAt': time.time(), 'source': str(source), 'sha256': digest, 'models': models}
    (ROOT / 'seers-proof.json').write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps(proof, indent=2))


if __name__ == '__main__':
    main()
