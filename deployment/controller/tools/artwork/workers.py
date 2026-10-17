"""External adapters. A remote receipt is persisted before any polling begins."""
import base64
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import subprocess
import threading
import time
from urllib.error import HTTPError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen
from images import digest


class Rejected(Exception):
    def __init__(self, status):
        self.status = status


def request_json(url, data=None, headers=None):
    request = Request(url, data=None if data is None else json.dumps(data).encode(),
                      headers={'Content-Type': 'application/json', **(headers or {})})
    try:
        with urlopen(request, timeout=60) as response:
            body = response.read(2_000_001)
            if len(body) > 2_000_000:
                raise ValueError('Provider response too large')
            return json.loads(body)
    except HTTPError as exc:
        # Never log response bodies: they can contain credentials or signed URLs.
        raise Rejected(exc.code) from None


class BFL:
    def __init__(self, key=None):
        self.key = key or os.environ.get('BFL_API_KEY')
        if not self.key:
            raise ValueError('Set BFL_API_KEY in the worker environment before starting it')

    def submit(self, spec):
        if spec['model'] not in ('flux-2-pro', 'flux-2-max', 'flux-2-klein-4b', 'flux-2-klein-9b'):
            raise ValueError('Unsupported BFL model; choose a documented FLUX.2 endpoint')
        allowed = {'seed', 'disable_pup'}
        if set(spec['settings']) - allowed:
            raise ValueError('BFL settings support seed and disable_pup')
        body = {'prompt': spec['prompt'], 'width': spec['width'], 'height': spec['height'],
                'output_format': 'png', **spec['settings']}
        if spec['references']:
            body['prompt'] += '\nInputs: ' + '; '.join(f"Image {i + 1}: {r['role']}" for i, r in enumerate(spec['references']))
        if spec['model'].startswith('flux-2-klein') and len(spec['references']) > 4:
            raise ValueError('Klein accepts at most four references')
        for i, reference in enumerate(spec['references']):
            body['input_image' + (f'_{i + 1}' if i else '')] = base64.b64encode(Path(reference['path']).read_bytes()).decode()
        return request_json('https://api.bfl.ai/v1/' + spec['model'], body, {'x-key': self.key})

    def poll(self, receipt):
        # Use a fixed trusted API origin; do not forward credentials to response URLs.
        return request_json('https://api.bfl.ai/v1/get_result?' + urlencode({'id': receipt['id']}),
                            headers={'x-key': self.key})

    def download(self, url, destination):
        parsed = urlparse(url)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError('Provider asset must use HTTPS')
        with urlopen(url, timeout=120) as response, open(destination, 'wb') as target:
            total = 0
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                if total > 50_000_000:
                    raise ValueError('Provider image exceeds 50 MB')
                target.write(chunk)


def builtin_packet(row):
    spec = json.loads(row['spec'])
    args = {'prompt': spec['prompt'] + f"\nOutput dimensions: {spec['width']}×{spec['height']}.",
            'transparent_background': bool(spec['settings'].get('transparent_background', False))}
    if spec['references']:
        args['referenced_image_paths'] = [r['path'] for r in spec['references']]
        args['prompt'] += '\nInputs: ' + '; '.join(f"Image {i + 1}: {r['role']}" for i, r in enumerate(spec['references']))
    return {'job': row['id'], 'token': row['token'], 'leaseUntil': row['lease'],
            'tool': 'image_gen.imagegen', 'arguments': args,
            'beforeCall': 'For local references, use view_image before editing. This packet does not invoke the tool.',
            'afterCall': 'Persist the returned local source path with artwork.py complete JOB TOKEN SOURCE immediately. Do not print base64.',
            'heartbeat': 'Use artwork.py beat JOB TOKEN during long requests.',
            'uncertain': 'If the session interrupts, reconcile the source receipt. Do not issue another generation automatically.'}


def step(store, backend, adapter=None, argv=None, model=None):
    if backend == 'bfl':
        adapter = adapter or BFL()  # Validate credentials before taking work.
    if backend == 'command' and (not argv or not all(isinstance(x, str) for x in argv)):
        raise ValueError('A command adapter needs a nonempty JSON argv list')
    row = store.claim(backend, f'{backend}-{os.getpid()}', model=model)
    if not row:
        return False
    job, token = row['id'], row['token']
    stop = threading.Event()

    def heartbeat():
        while not stop.wait(30):
            try:
                store.beat(job, token)
            except ValueError:
                return

    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()
    try:
        spec = json.loads(row['spec'])
        if any(digest(r['path']) != r['sha256'] for r in spec['references']):
            store.fail(job, token, 'Reference content changed; no request was sent')
            return True
        if backend == 'command':
            work = store.root / 'work' / row['attempt']
            work.mkdir(parents=True, exist_ok=True)
            packet = {'job': job, 'attempt': row['attempt'], 'spec': spec, 'outputDirectory': str(work)}
            result = subprocess.run(argv, input=json.dumps(packet), text=True,
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=900)
            if result.returncode:
                store.fail(job, token, 'Command stopped without a successful receipt', uncertain=True)
                return True
            receipt = json.loads(result.stdout)
            source = Path(receipt['source']).resolve()
            if not source.is_relative_to(work):
                raise ValueError('Command output must be inside its assigned outputDirectory')
            # Persist the external command receipt before processing the image.
            (work / 'receipt.json').write_text(json.dumps(receipt))
            store.complete(job, token, source, receipt.get('cost'), receipt.get('currency'))
            return True
        receipt = json.loads(row['remote']) if row['remote'] else None
        if receipt is None:
            try:
                receipt = adapter.submit(spec)
            except Rejected as exc:
                store.fail(job, token, f'Provider returned HTTP {exc.status}',
                           uncertain=exc.status >= 500, safe_retry=exc.status == 429)
                return True
            store.submitted(job, token, receipt)
        try:
            result = adapter.poll(receipt)
        except Exception:
            store.defer(job, token, 'Polling paused; the same remote request will be checked again', 15)
            return True
        status = result.get('status')
        if status in ('Pending', 'Reasoning', 'Generating'):
            store.defer(job, token, 'Remote generation is still running', 5)
        elif status == 'Ready':
            work = store.root / 'work' / row['attempt']
            work.mkdir(parents=True, exist_ok=True)
            source = work / 'result.png'
            try:
                if not source.exists():
                    partial = work / 'result.partial'
                    adapter.download(result['result']['sample'], partial)
                    partial.replace(source)
                store.complete(job, token, source, result.get('cost', receipt.get('cost')),
                               'BFL credits' if result.get('cost', receipt.get('cost')) is not None else None)
            except Exception:
                # Retain remote ID and downloaded source for recovery; never regenerate.
                store.fail(job, token, 'Remote result needs local reconciliation', uncertain=True)
        else:
            store.fail(job, token, 'Remote request stopped: ' + str(status)[:100])
    except Exception as exc:
        # No automatic replay after an ambiguous submission or command execution.
        store.fail(job, token, 'Worker needs reconciliation: ' + type(exc).__name__, uncertain=True)
    finally:
        stop.set()
        thread.join(timeout=1)
    return True


def run_workers(store, backend, concurrency=6, once=False, argv=None, stop=None, model=None):
    if not 1 <= concurrency <= 16:
        raise ValueError('Concurrency must be between 1 and 16')
    stop = stop or threading.Event()
    adapter = BFL() if backend == 'bfl' else None

    def worker():
        while not stop.is_set():
            worked = step(store, backend, adapter=adapter, argv=argv, model=model)
            if once:
                return
            if not worked:
                stop.wait(2)

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(worker) for _ in range(concurrency)]
        for future in futures:
            future.result()
