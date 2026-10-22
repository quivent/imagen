#!/bin/bash
set -euo pipefail
unset UV_NO_CACHE
export UV_CACHE_DIR=/workspace/artwork/.uv-cache
export UV_HTTP_TIMEOUT=600
export UV_HTTP_RETRIES=10
test -x /workspace/artwork/.venv/bin/python || uv venv --python /venv/main/bin/python /workspace/artwork/.venv
uv pip install --python /workspace/artwork/.venv/bin/python --no-deps /workspace/artwork/wheelhouse/*.whl
uv pip install --python /workspace/artwork/.venv/bin/python torch==2.14.1 torchvision==0.29.1 --index-url https://download.pytorch.org/whl/cu130
uv pip install --python /workspace/artwork/.venv/bin/python -r /workspace/artwork/requirements.txt
/workspace/artwork/.venv/bin/python -c "import torch,torchvision,diffusers,transformers,bitsandbytes; print(torch.__version__); print(torch.cuda.get_device_name(0)); print(torch.cuda.get_device_name(1)); print((torch.ones(1,device='cuda')+1).item())"
touch /workspace/artwork/runtime-ready
