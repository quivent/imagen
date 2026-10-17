#!/bin/bash
set -euo pipefail
export HF_HOME=/workspace/artwork/hf
export PYTHONUNBUFFERED=1
export TOKENIZERS_PARALLELISM=false
export CUDA_VISIBLE_DEVICES=0
export HF_HUB_OFFLINE=1
export ARTWORK_NATIVE_FLUX1=1
cd /workspace/artwork
exec /workspace/artwork/.venv/bin/python -u worker.py --profile flux1-dev
