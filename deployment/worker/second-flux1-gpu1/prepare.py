#!/usr/bin/env python3
"""Prepare an isolated GPU1 FLUX.1 lane using existing volume weights.

Does not stop services, download models, or submit images. Stop an idle GPU1
model service explicitly before starting the two included supervisor services.
"""
from pathlib import Path

BASE=Path('/workspace/artwork')
ROOT=Path('/workspace/artwork-flux1-gpu1')

def main():
    if not (BASE/'models/flux1/model_index.json').is_file():raise ValueError('Existing volume FLUX.1 weights are required')
    if (ROOT/'native/flux1.sock').exists():raise ValueError('Do not rewrite a running native lane')
    (ROOT/'native').mkdir(parents=True,exist_ok=True)
    for name in ('models','.venv','hf'):
        path=ROOT/name
        if not path.exists():path.symlink_to(BASE/name,target_is_directory=True)
    source=ROOT/'native/source'
    if not source.exists():source.symlink_to(BASE/'native/source',target_is_directory=True)
    (ROOT/'native/source.json').write_bytes((BASE/'native/source.json').read_bytes())
    profile=ROOT/'native/profile.json'
    if not profile.exists():profile.write_text('{"backends":{},"version":1}\n')
    (ROOT/'native.py').write_bytes((BASE/'native.py').read_bytes())
    launch=(BASE/'native_launch.py').read_text()
    old="Path('/workspace/artwork/native')"
    if launch.count(old)!=1:raise ValueError('Unexpected native launcher; reconcile the source before adapting')
    (ROOT/'native_launch.py').write_text(launch.replace(old,"Path('/workspace/artwork-flux1-gpu1/native')"))
    worker=(BASE/'worker.py').read_text()
    old="('flux1', 18761)"
    if worker.count(old)!=1:raise ValueError('Unexpected worker port declaration')
    (ROOT/'worker.py').write_text(worker.replace(old,"('flux1', 18763)"))
    print('Prepared GPU1 root; native socket and HTTP18763 are isolated. No generation requested.')

if __name__=='__main__':main()
