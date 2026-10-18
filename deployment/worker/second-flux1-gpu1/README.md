# Second FLUX.1 GPU lane

This deployment reuses `/workspace/artwork/models/flux1`, the original native worker source, and the existing Python environment. It creates no model copies or downloads. CUDA visibility is GPU1; HTTP is loopback18763 and the native socket is `/workspace/artwork-flux1-gpu1/native/flux1.sock`. Job storage is isolated under `/workspace/artwork-flux1-gpu1/jobs/flux1-dev` to avoid the GPU0 engine lock.

Run `prepare.py` on the worker before starting this lane. Install the included `.sh` files into `/opt/supervisor-scripts/` and `.conf` files into `/etc/supervisor/conf.d/`, then run `supervisorctl reread` and `supervisorctl update`. Verify the persistent volume is attached first. Do not rerun preparation over a live socket.

A different model occupying GPU1 must first be confirmed idle and paused, then explicitly stopped. In the initial deployment only `artwork-flux2` was stopped; its two queued jobs and model weights were retained. GPU0 and its worker were not restarted.

The existing `artwork-r2` service remains the only archive/index writer. Its repository source `../r2/stream.py` discovers both job roots and publishes both lanes under the normal `flux1-dev` archive profile. Do not launch a second uploader. This lane requires the separately managed production-parity GPU1 daemon to submit work; starting its model services does not itself schedule generation.
