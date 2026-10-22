#!/bin/bash
set -euo pipefail
ROOT=/workspace/artwork/judges
export UV_CACHE_DIR="$ROOT/.uv-cache"
export UV_LINK_MODE=copy
uv venv --python /usr/bin/python3 "$ROOT/.venv"
uv pip install --python "$ROOT/.venv/bin/python" 'vllm==0.31.0' 'Pillow>=11' > "$ROOT/install.log" 2>&1
"$ROOT/.venv/bin/python" -c 'import torch, vllm; x=torch.ones(1,device="cuda"); assert x.item()==1; print(torch.__version__,torch.version.cuda,vllm.__version__,torch.cuda.get_device_name(0))' > "$ROOT/runtime-check.txt" 2>&1
"$ROOT/.venv/bin/python" -m pip freeze > "$ROOT/runtime.lock.txt" 2>/dev/null || uv pip freeze --python "$ROOT/.venv/bin/python" > "$ROOT/runtime.lock.txt"
touch "$ROOT/runtime-ready"
