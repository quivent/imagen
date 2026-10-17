#!/usr/bin/env python3
"""Verify Gemma vision and MTP using model outputs; never display images."""
import base64
from datetime import datetime, timezone
import hashlib
from io import BytesIO
import json
from pathlib import Path
import subprocess
import time
import urllib.request

from PIL import Image, ImageDraw

ROOT = Path('/workspace/artwork/judges')


def request(port, path, body=None):
    raw = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(f'http://127.0.0.1:{port}{path}', data=raw,
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as reply:
        return json.load(reply)


def metrics():
    with urllib.request.urlopen('http://127.0.0.1:8004/metrics', timeout=10) as reply:
        text = reply.read().decode()
    return {line.split('{')[0]: float(line.rsplit(' ', 1)[1])
            for line in text.splitlines()
            if line.startswith('vllm:spec_decode_') and '_total{' in line}


def chat(raw, prompt, max_tokens=180):
    image = 'data:image/png;base64,' + base64.b64encode(raw).decode()
    return request(8004, '/v1/chat/completions', {
        'model': 'gemma4-12b-artist', 'temperature': 0.1, 'max_tokens': max_tokens,
        'chat_template_kwargs': {'enable_thinking': False},
        'messages': [{'role': 'user', 'content': [
            {'type': 'image_url', 'image_url': {'url': image}},
            {'type': 'text', 'text': prompt},
        ]}],
    })


def generator_health():
    state = {str(p): request(p, '/health') for p in (18761, 18762)}
    assert all(s['phase'] == 'ready' and not s.get('problem') for s in state.values())
    return state


def main():
    proof = {'observed_at': datetime.now(timezone.utc).isoformat(),
             'models': request(8004, '/v1/models'), 'flux_before': generator_health(),
             'pixtral': request(8002, '/v1/models'), 'dino': request(8003, '/health'),
             'speculative_before': metrics()}
    # Known geometry provides an objective vision check without human/agent viewing.
    fixture = Image.new('RGB', (448, 448), 'blue')
    ImageDraw.Draw(fixture).ellipse((100, 100, 348, 348), fill='yellow')
    stream = BytesIO()
    fixture.save(stream, format='PNG')
    answer = chat(stream.getvalue(),
                  'Name the background color and the foreground shape and its color. '
                  'Answer in one short sentence.', max_tokens=60)
    content = answer['choices'][0]['message']['content']
    assert all(word in content.lower() for word in ('blue', 'yellow', 'circle')), content
    proof['vision_fixture'] = {'expected': 'yellow circle on blue background', 'response': answer}
    images = list(Path('/workspace/artwork/jobs/flux1-dev').glob('*/result.png'))
    if not images:
        raise RuntimeError('A real FLUX1 output is required')
    source = max(images, key=lambda p: p.stat().st_mtime)
    raw = source.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    started = time.monotonic()
    response = chat(raw, 'Give brief artist feedback on the visible image. '
                    'Describe its composition and palette, then suggest one concrete visual refinement.')
    assert len((response['choices'][0]['message']['content'] or '').strip()) > 30
    proof['artwork_feedback'] = {'source': str(source), 'sha256': digest,
                                'seconds': time.monotonic() - started, 'response': response}
    proof['speculative_after'] = metrics()
    drafted = proof['speculative_after'].get('vllm:spec_decode_num_draft_tokens_total', 0)
    accepted = proof['speculative_after'].get('vllm:spec_decode_num_accepted_tokens_total', 0)
    assert drafted > proof['speculative_before'].get('vllm:spec_decode_num_draft_tokens_total', 0)
    assert accepted > proof['speculative_before'].get('vllm:spec_decode_num_accepted_tokens_total', 0)
    proof['flux_after'] = generator_health()
    proof['gpu_processes'] = subprocess.check_output([
        'nvidia-smi', '--query-compute-apps=gpu_uuid,pid,process_name,used_memory', '--format=csv'
    ], text=True)
    proof['gpu_memory'] = subprocess.check_output([
        'nvidia-smi', '--query-gpu=index,memory.total,memory.used,memory.free', '--format=csv'
    ], text=True)
    assert hashlib.sha256(source.read_bytes()).hexdigest() == digest
    proof['ok'] = True
    path = ROOT / 'gemma-setup-proof.json'
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(proof, indent=2) + '\n')
    temp.replace(path)
    print(json.dumps({'ok': True, 'proof': str(path), 'fixture_response': content,
                      'drafted_tokens': drafted, 'accepted_tokens': accepted,
                      'gpu_memory': proof['gpu_memory']}, indent=2))


if __name__ == '__main__':
    main()
