#!/bin/bash
set -euo pipefail
export HF_HOME=/workspace/artwork/hf
export PYTHONUNBUFFERED=1
export TOKENIZERS_PARALLELISM=REDACTED_PRIVATE_VALUE
export CUDA_VISIBLE_DEVICES=1
export HF_HUB_OFFLINE=1
export ARTWORK_FLUX2_ENCODER=fp8
cd /workspace/artwork
exec /workspace/artwork/.venv/bin/python -u worker.py --profile flux2-dev-nf4
