"""Private, persistent single-GPU FLUX worker. All generation is journaled."""
import argparse
from collections import deque
import fcntl
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import threading
import time

PROFILES = {'flux1-dev': ('flux1', 18761), 'flux2-dev-nf4': ('flux2', 18762)}


def atomic_json(path, value):
    temporary = path.with_suffix('.tmp')
    with temporary.open('w') as stream:
        json.dump(value, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)
    descriptor = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


class Engine:
    def __init__(self, root, profile):
        self.root, self.profile = root, profile
        self.directory = root / 'jobs' / profile
        self.directory.mkdir(parents=True, exist_ok=True)
        self.lock_file = (self.directory / '.lock').open('w')
        fcntl.flock(self.lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.condition = threading.Condition()
        self.pending = deque()
        self.jobs = {}
        self.phase, self.problem = 'loading', None
        self.pipe = None
        self.control_path = self.directory / 'control.json'
        self.paused = json.loads(self.control_path.read_text()).get('paused', False) if self.control_path.exists() else False
        self.current = None
        self.stage_events = {}
        for path in sorted(self.directory.glob('*/job.json')):
            record = json.loads(path.read_text())
            if record['status'] == 'running':
                receipt_path = path.parent / 'receipt.json'
                receipt = json.loads(receipt_path.read_text()) if receipt_path.exists() else None
                image = path.parent / 'result.png'
                if receipt and image.exists() and receipt['sha256'] == sha256(image):
                    record.update(status='done', receipt=receipt)
                else:
                    record.update(status='uncertain', problem='Worker restarted during generation; reconcile before a new job.')
                atomic_json(path, record)
            self.jobs[record['id']] = record
            if record['status'] == 'queued':
                self.pending.append(record['id'])
        threading.Thread(target=self.run, daemon=True).start()

    def submit(self, value):
        if self.phase == 'failed':
            raise ValueError('Model failed to load; inspect worker health before submitting')
        ident, spec = value['id'], value['spec']
        if not isinstance(ident, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', ident):
            raise ValueError('Invalid job ID')
        if spec.get('model') != self.profile or spec.get('references'):
            raise ValueError('This profile accepts text-to-image only; model must match the worker')
        if not isinstance(spec.get('prompt'), str) or not 1 <= len(spec['prompt']) <= 20000:
            raise ValueError('Prompt must contain 1–20000 characters')
        for key in ('width', 'height'):
            value = spec.get(key)
            if type(value) is not int or not 256 <= value <= 1536 or value % 32:
                raise ValueError('Dimensions must be multiples of 32 between 256 and 1536')
        settings = spec.get('settings', {})
        if set(settings) - {'seed', 'steps', 'guidance_scale', 'max_sequence_length'}:
            raise ValueError('Unsupported generation settings')
        for key, default, low, high in [('seed', 42, 0, 2**32-1), ('steps', 28, 1, 60), ('max_sequence_length', 512, 32, 512)]:
            v = settings.get(key, default)
            if type(v) is not int or not low <= v <= high:
                raise ValueError('Invalid ' + key)
        guidance = settings.get('guidance_scale', 3.5 if self.profile == 'flux1-dev' else 4.0)
        if not isinstance(guidance, (int, float)) or not 1 <= guidance <= 10:
            raise ValueError('Invalid guidance scale')
        fingerprint = hashlib.sha256(json.dumps(spec, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        with self.condition:
            if ident in self.jobs:
                if self.jobs[ident]['fingerprint'] != fingerprint:
                    raise ValueError('Job ID already belongs to another request')
                return self.jobs[ident]
            directory = self.directory / ident
            directory.mkdir(exist_ok=True)
            if any((directory / name).exists() for name in ('result.png', 'receipt.json', 'job.json')):
                raise ValueError('Orphaned job artifacts retained; reconcile before submitting')
            record = {'id': ident, 'profile': self.profile, 'fingerprint': fingerprint,
                      'spec': spec, 'status': 'queued', 'created': time.time()}
            atomic_json(directory / 'job.json', record)
            self.jobs[ident] = record
            self.pending.append(ident)
            self.condition.notify_all()
            return record

    def run(self):
        try:
            if self.profile == 'flux1-dev' and os.environ.get('ARTWORK_NATIVE_FLUX1') == '1':
                from native import Native
                self.native = Native(self.root)
                self.load_seconds = self.native.load_seconds
                self.phase = 'ready'
            else:
                import torch
                from diffusers import FluxPipeline, Flux2Pipeline
                torch.set_num_threads(8)
                start = time.monotonic()
                path = self.root / 'models' / PROFILES[self.profile][0]
                if self.profile == 'flux1-dev':
                    self.pipe = FluxPipeline.from_pretrained(path, torch_dtype=torch.bfloat16, local_files_only=True).to('cuda')
                else:
                    from transformers import Mistral3ForConditionalGeneration
                    encoder = Mistral3ForConditionalGeneration.from_pretrained(
                        self.root / 'models' / 'flux2-nf4', subfolder='text_encoder',
                        torch_dtype=torch.bfloat16, device_map={'': 'cuda:0'}, local_files_only=True)
                    self.pipe = Flux2Pipeline.from_pretrained(path, text_encoder=encoder,
                        torch_dtype=torch.bfloat16, local_files_only=True).to('cuda')
                self.precision = {'transformer_dtype': str(self.pipe.transformer.dtype),
                                  'text_encoder_4bit': bool(getattr(self.pipe.text_encoder, 'is_loaded_in_4bit', False))}
                if self.profile == 'flux2-dev-nf4':
                    quant = self.pipe.text_encoder.config.quantization_config
                    quant = quant.to_dict() if hasattr(quant, 'to_dict') else quant
                    self.precision['text_encoder_quantization'] = quant
                    assert self.precision['text_encoder_4bit'] and quant['bnb_4bit_quant_type'] == 'nf4'
                assert self.pipe.transformer.dtype == torch.bfloat16
                self.pipe.vae.enable_tiling()
                self.instrument('prompt_encoding', self.pipe, 'encode_prompt')
                self.instrument('transformer', self.pipe.transformer, 'forward')
                self.instrument('vae_decode', self.pipe.vae, 'decode')
                self.load_seconds = time.monotonic() - start
                self.phase = 'ready'
                print(json.dumps({'event': 'ready', 'profile': self.profile, 'load_seconds': self.load_seconds}), flush=True)
        except Exception as exc:
            self.phase = 'failed'
            self.problem = type(exc).__name__ + ': ' + str(exc)[:600]
            with self.condition:
                for ident in self.pending:
                    self.jobs[ident].update(status='failed', problem='Model load failed before generation')
                    atomic_json(self.directory / ident / 'job.json', self.jobs[ident])
                self.pending.clear()
            print(json.dumps({'event': 'load_failed', 'problem': self.problem}), flush=True)
            return
        while True:
            with self.condition:
                while not self.pending or self.paused:
                    self.condition.wait()
                ident = self.pending.popleft()
                self.current = ident
                record = self.jobs[ident]
                record.update(status='running', started=time.time())
                atomic_json(self.directory / ident / 'job.json', record)
            try:
                receipt = self.generate(record)
                with self.condition:
                    record.update(status='done', receipt=receipt, finished=time.time())
            except Exception as exc:
                # Never retry generation automatically after any execution failure.
                with self.condition:
                    record.update(status='failed', problem=type(exc).__name__ + ': ' + str(exc)[:600], finished=time.time())
                print(json.dumps({'event': 'generation_failed', 'id': ident, 'problem': record['problem']}), flush=True)
            with self.condition:
                atomic_json(self.directory / ident / 'job.json', record)
                self.current = None

    def instrument(self, stage, owner, method):
        """CUDA events measure stages without synchronizing after every step."""
        import torch
        original = getattr(owner, method)

        def measured(*args, **kwargs):
            start = torch.cuda.Event(enable_timing=True)
            end = torch.cuda.Event(enable_timing=True)
            start.record()
            before = time.monotonic()
            result = original(*args, **kwargs)
            dispatched = time.monotonic() - before
            end.record()
            self.stage_events.setdefault(stage, []).append((start, end, dispatched))
            return result

        setattr(owner, method, measured)

    def generate(self, record):
        if hasattr(self, 'native'):
            return self.native.generate(record, self.directory / record['id'], atomic_json)
        import torch
        import importlib.metadata
        spec, settings = record['spec'], record['spec'].get('settings', {})
        parameters = {'width': spec['width'], 'height': spec['height'],
                      'num_inference_steps': settings.get('steps', 28),
                      'guidance_scale': settings.get('guidance_scale', 3.5 if self.profile == 'flux1-dev' else 4.0),
                      'max_sequence_length': settings.get('max_sequence_length', 512)}
        seed = settings.get('seed', 42)
        manifest = json.loads((self.root / 'models' / 'manifest.json').read_text())
        packages = {p: importlib.metadata.version(p) for p in ['torch', 'diffusers', 'transformers', 'bitsandbytes']}
        torch.cuda.synchronize()
        torch.cuda.reset_peak_memory_stats()
        self.stage_events = {}
        start = time.monotonic()
        with torch.inference_mode():
            image = self.pipe(prompt=spec['prompt'], generator=torch.Generator('cuda').manual_seed(seed), **parameters).images[0]
        torch.cuda.synchronize()
        seconds = time.monotonic() - start
        timings = {name: {'gpu_stream_seconds': sum(a.elapsed_time(b) for a, b, _ in events) / 1000,
                          'cpu_dispatch_seconds': sum(t for _, _, t in events), 'calls': len(events)}
                   for name, events in self.stage_events.items()}
        directory = self.directory / record['id']
        output = directory / 'result.png'
        with (directory / 'result.tmp').open('wb') as stream:
            image.save(stream, format='PNG')
            stream.flush()
            os.fsync(stream.fileno())
        (directory / 'result.tmp').replace(output)
        receipt = {'id': record['id'], 'profile': self.profile, 'source': str(output),
                   'sha256': sha256(output), 'prompt': spec['prompt'], 'parameters': parameters,
                   'seed': seed, 'generation_seconds': seconds, 'load_seconds': self.load_seconds,
                   'peak_allocated_bytes': torch.cuda.max_memory_allocated(),
                   'peak_reserved_bytes': torch.cuda.max_memory_reserved(),
                   'gpu': torch.cuda.get_device_name(), 'cuda': torch.version.cuda,
                   'packages': packages, 'precision': self.precision, 'timings': timings,
                   'attention_processors': sorted({type(p).__name__ for p in self.pipe.transformer.attn_processors.values()}),
                   'torch_threads': torch.get_num_threads(),
                   'model_manifest': manifest, 'created': time.time(), 'width': image.width, 'height': image.height}
        atomic_json(directory / 'receipt.json', receipt)
        print(json.dumps({'event': 'generated', 'id': record['id'], 'seconds': seconds}), flush=True)
        return receipt


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path('/workspace/artwork'))
    parser.add_argument('--profile', choices=PROFILES, required=True)
    args = parser.parse_args()
    engine = Engine(args.root.resolve(), args.profile)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def respond(self, code, body):
            encoded = json.dumps(body).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def do_GET(self):
            with engine.condition:
                if self.path == '/health':
                    self.respond(200, {'profile': args.profile, 'phase': engine.phase,
                                      'problem': engine.problem, 'queued': len(engine.pending),
                                      'paused': engine.paused, 'current': engine.current,
                                      'running': int(engine.current is not None)})
                elif self.path == '/jobs':
                    self.respond(200, {'jobs': list(engine.jobs.values())[-500:]})
                elif self.path.startswith('/jobs/') and self.path[6:] in engine.jobs:
                    self.respond(200, engine.jobs[self.path[6:]])
                else:
                    self.respond(404, {'problem': 'Unknown path or job'})

        def do_POST(self):
            if self.path not in ('/jobs', '/control'):
                return self.respond(404, {'problem': 'Unknown path'})
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 100000:
                    raise ValueError('Invalid request size')
                value = json.loads(self.rfile.read(length))
                if self.path == '/control':
                    if type(value.get('paused')) is not bool:
                        raise ValueError('paused must be a boolean')
                    with engine.condition:
                        engine.paused = value['paused']
                        atomic_json(engine.control_path, {'paused': engine.paused})
                        engine.condition.notify_all()
                    return self.respond(200, {'profile': args.profile, 'paused': engine.paused})
                result = engine.submit(value)
                self.respond(200, result)
            except (ValueError, KeyError, TypeError) as exc:
                self.respond(400, {'problem': str(exc)[:300]})

    server = ThreadingHTTPServer(('127.0.0.1', PROFILES[args.profile][1]), Handler)
    server.serve_forever()


if __name__ == '__main__':
    main()
