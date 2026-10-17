"""Use Jay's original resident FLUX worker through its existing Unix protocol."""
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import socket
import time


def request(path, payload):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(30)
        client.connect(str(path))
        client.sendall((json.dumps(payload) + '\n').encode())
        stream = client.makefile('rb')
        result = json.loads(stream.readline(10_000_001))
    if not result.get('ok', False):
        raise RuntimeError('Native FLUX request failed: ' + str(result.get('error', 'unknown'))[:300])
    return result


def model_manifest(root):
    path = root / 'models' / 'manifest.json'
    if path.exists():
        return json.loads(path.read_text())
    completion_path = root / 'models' / 'flux1' / '.download-complete.json'
    completion = json.loads(completion_path.read_text())
    return {'schema': 1, 'complete': False,
            'completion_source': str(completion_path),
            'models': {'flux1': {**completion['model'],
                                'path': str(root / 'models' / 'flux1'),
                                'completed_at': completion['completed_at']}}}


class Native:
    def __init__(self, root):
        self.root = root
        self.socket = root / 'native' / 'flux1.sock'
        start = time.monotonic()
        while True:
            try:
                self.status = request(self.socket, {'op': 'ping'})
                break
            except (FileNotFoundError, ConnectionRefusedError):
                if time.monotonic() - start > 120:
                    raise
                time.sleep(1)
        self.load_seconds = time.monotonic() - start

    def generate(self, record, directory, persist):
        spec = record['spec']; settings = spec.get('settings', {})
        if settings.get('max_sequence_length', 512) != 512:
            raise ValueError('The original FLUX worker uses max_sequence_length=512')
        filename = 'factory/' + record['id'] + '.png'
        # Filename is stable across reconnects. Query before submitting, so an
        # accepted upstream job can be found even if its response was lost.
        matches = [j for j in request(self.socket, {'op': 'jobs'}).get('jobs', []) if j.get('filename') == filename]
        if matches:
            job = matches[0]
            expected = {'prompt': spec['prompt'], 'width': spec['width'], 'height': spec['height'],
                        'steps': settings.get('steps', 28), 'guidance': settings.get('guidance_scale', 3.5)}
            if any(job.get(key) != value for key, value in expected.items()) or str(job.get('seed')) != str(settings.get('seed', 42)):
                raise ValueError('Native job filename belongs to a different request')
        else:
            job = request(self.socket, {'op': 'submit', 'backend': 'cuda',
                'prompt': spec['prompt'], 'width': spec['width'], 'height': spec['height'],
                'steps': settings.get('steps', 28), 'guidance': settings.get('guidance_scale', 3.5),
                'seed': str(settings.get('seed', 42)), 'filename': filename})['job']
        record['native_request_id'] = job['id']
        persist(directory / 'job.json', record)
        while job['status'] not in ('done', 'error', 'cancelled', 'interrupted'):
            time.sleep(.2)
            job = next(j for j in request(self.socket, {'op': 'jobs'})['jobs'] if j['id'] == record['native_request_id'])
        if job['status'] != 'done':
            raise RuntimeError('Native render stopped: ' + str(job.get('error', job['status']))[:300])
        source = self.root / 'native' / 'output' / filename
        if Path(job['output']).resolve() != source.resolve():
            raise ValueError('Native output did not match the assigned path')
        temporary = directory / 'result.tmp'
        with source.open('rb') as incoming, temporary.open('wb') as outgoing:
            shutil.copyfileobj(incoming, outgoing)
            outgoing.flush(); os.fsync(outgoing.fileno())
        output = directory / 'result.png'; temporary.replace(output)
        timings_path = self.root / 'native' / 'timings' / (job['id'] + '.json')
        # Upstream marks done only after the instrumented render returns.
        measurements = json.loads(timings_path.read_text()) if timings_path.exists() else {}
        provenance = json.loads((self.root / 'native' / 'source.json').read_text())
        receipt = {'id': record['id'], 'profile': 'flux1-dev', 'engine': 'jay-flux-worker',
            'native_request_id': job['id'], 'native_source': provenance,
            'source': str(output), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
            'prompt': spec['prompt'], 'width': spec['width'], 'height': spec['height'],
            'seed': settings.get('seed', 42), 'generator_device': 'cpu',
            'parameters': {'width': spec['width'], 'height': spec['height'],
                'num_inference_steps': settings.get('steps', 28),
                'guidance_scale': settings.get('guidance_scale', 3.5), 'max_sequence_length': 512},
            'generation_seconds': measurements.get('render_seconds', job.get('seconds')),
            'native_job_seconds': job.get('seconds'), 'load_seconds': self.load_seconds,
            'timings': measurements.get('timings', {}), 'precision': measurements.get('precision', {}),
            'profiling': measurements.get('profiling', {'enabled': False}),
            'blas': measurements.get('blas'),
            'attention_processors': measurements.get('attention_processors', []),
            'peak_allocated_bytes': measurements.get('peak_allocated_bytes'),
            'peak_reserved_bytes': measurements.get('peak_reserved_bytes'),
            'packages': {p: importlib.metadata.version(p) for p in ('torch','diffusers','transformers')},
            'model_manifest': model_manifest(self.root),
            'created': time.time()}
        persist(directory / 'receipt.json', receipt)
        return receipt
