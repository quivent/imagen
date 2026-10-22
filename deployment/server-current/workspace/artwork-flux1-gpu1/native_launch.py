"""Launch the unchanged ~/FLUX source with timing instrumentation around its calls."""
import importlib.util
import contextlib
import json
from pathlib import Path
import sys
import time

import torch
# Initialize the installed torchvision before the upstream compatibility shim.
import torchvision

ROOT = Path('/workspace/artwork-flux1-gpu1/native')
sys.path.insert(0, str(ROOT / 'source'))
spec = importlib.util.spec_from_file_location('jay_flux_worker', ROOT / 'source/worker.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
original_load = module.Worker._load_pipe
original_render = module.Worker._render_torch


def load(self, *args, **kwargs):
    original_load(self, *args, **kwargs)
    if getattr(self.pipe, '_artwork_timing', False):
        return
    self.pipe._artwork_timing = True
    self._artwork_events = {}
    for stage, owner, name in [('prompt_encoding', self.pipe, 'encode_prompt'),
                                ('transformer', self.pipe.transformer, 'forward'),
                                ('vae_decode', self.pipe.vae, 'decode')]:
        original = getattr(owner, name)
        def measured(*a, _original=original, _stage=stage, **kw):
            start = torch.cuda.Event(enable_timing=True); end = torch.cuda.Event(enable_timing=True)
            start.record(); before = time.monotonic()
            value = _original(*a, **kw)
            dispatched = time.monotonic() - before; end.record()
            self._artwork_events.setdefault(_stage, []).append((start, end, dispatched))
            return value
        setattr(owner, name, measured)


def render(self, job, backend):
    self._artwork_events = {}
    torch.cuda.synchronize(); torch.cuda.reset_peak_memory_stats()
    start = time.monotonic()
    marker = ROOT / 'profile-next.json'
    profiling = marker.exists()
    if profiling:
        marker.unlink()  # One requested image only; never profile the ongoing queue.
    capture = (torch.profiler.profile(activities=[torch.profiler.ProfilerActivity.CPU,
                torch.profiler.ProfilerActivity.CUDA], record_shapes=False, with_stack=False)
               if profiling else contextlib.nullcontext())
    experiments = ROOT / 'blas-experiments.json'
    preference = (json.loads(experiments.read_text()).get(job.get('filename'))
                  if experiments.exists() else None)
    previous_blas = torch.backends.cuda.preferred_blas_library()
    if preference not in (None, 'cublas', 'cublaslt'):
        raise ValueError('Unknown bounded BLAS experiment')
    try:
        if preference:
            torch.backends.cuda.preferred_blas_library(preference)
        actual_blas = str(torch.backends.cuda.preferred_blas_library())
        with capture as profiler:
            output = original_render(self, job, backend)
    finally:
        torch.backends.cuda.preferred_blas_library(previous_blas)
    torch.cuda.synchronize()
    record = {'render_seconds': time.monotonic()-start,
        'timings': {name: {'gpu_stream_seconds':sum(a.elapsed_time(b) for a,b,_ in events)/1000,
                          'cpu_dispatch_seconds':sum(t for _,_,t in events), 'calls':len(events)}
                   for name,events in self._artwork_events.items()},
        'precision': {'transformer_dtype':str(self.pipe.transformer.dtype), 'text_encoder_4bit':False},
        'attention_processors':sorted({type(p).__name__ for p in self.pipe.transformer.attn_processors.values()}),
        'peak_allocated_bytes':torch.cuda.max_memory_allocated(),
        'peak_reserved_bytes':torch.cuda.max_memory_reserved(),
        'blas': {'requested':preference, 'actual':actual_blas,
                 'restored':str(torch.backends.cuda.preferred_blas_library())}}
    if profiling:
        directory = ROOT / 'profiles'; directory.mkdir(exist_ok=True)
        rows = [{'name':e.key, 'calls':e.count,
                 'self_gpu_ms':getattr(e, 'self_device_time_total', 0)/1000,
                 'self_cpu_ms':e.self_cpu_time_total/1000} for e in profiler.key_averages()]
        rows.sort(key=lambda item:item['self_gpu_ms'], reverse=True)
        report = directory / (job['id'] + '.json')
        report.write_text(json.dumps({'nativeJobId':job['id'], 'profiled':True,
            'warning':'Profiler overhead; not a baseline timing',
            'operators':rows[:60]}, indent=2)+'\n')
        record['profiling'] = {'enabled':True, 'report':str(report),
                               'timing_includes_profiler_overhead':True}
    directory=ROOT/'timings'; directory.mkdir(exist_ok=True)
    (directory/(job['id']+'.json')).write_text(json.dumps(record,indent=2)+'\n')
    return output


module.Worker._load_pipe = load
module.Worker._render_torch = render
module.main()
