#!/usr/bin/env python3
"""Publish bounded Seers metadata, or an explicitly named captured image."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.request

ROOT = Path('/workspace/artwork/judges/seers')
MODELS = [('pixtral', 8002), ('dinov2', 8003), ('gemma', 8004)]


def model_snapshot(choice):
    model, port = choice
    ready = False
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=1) as response:
            ready = response.status == 200
    except Exception:
        pass
    value = {'id': model, 'ready': ready, 'current': None, 'last': None, 'pending': 0}
    try:
        source = json.loads((ROOT / model / 'state.json').read_text())
        alive = True
        try:
            os.kill(int(source['pid']), 0)
        except (OSError, ValueError, KeyError):
            alive = False
        active = source.get('active', []) if alive and ready else []
        value.update({'current': min(active, key=lambda x: x['startedAt']) if active else None,
                      'last': source.get('last'), 'pending': max(0, len(active) - 1)})
    except (OSError, ValueError):
        pass
    return value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--watch', action='store_true')
    parser.add_argument('--image')
    args = parser.parse_args()
    if args.image:
        if not re.fullmatch(r'[0-9a-f]{64}\.(png|jpg|webp)', args.image):
            raise ValueError('Invalid image identity')
        path = ROOT / 'images' / args.image
        if path.stat().st_size > 24 * 1024 * 1024:
            raise ValueError('Image too large')
        sys.stdout.buffer.write(path.read_bytes())
        return
    with ThreadPoolExecutor(max_workers=3) as pool:
        while True:
            models = list(pool.map(model_snapshot, MODELS))
            print(json.dumps({'ok': True, 'observedAt': time.time(), 'models': models}, separators=(',', ':')), flush=True)
            if not args.watch:
                return
            time.sleep(1)


if __name__ == '__main__':
    main()
