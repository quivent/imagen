#!/bin/bash
set -euo pipefail
export HF_HOME=/workspace/artwork/hf
export PYTHONUNBUFFERED=1
export TOKENIZERS_PARALLELISM=false
export CUDA_VISIBLE_DEVICES=1
export HF_HUB_OFFLINE=1
export ARTWORK_NATIVE_FLUX1=1
cd /workspace/artwork-flux1-gpu1
exec /workspace/artwork-flux1-gpu1/.venv/bin/python -u /workspace/artwork-flux1-gpu1/native_launch.py --socket /workspace/artwork-flux1-gpu1/native/flux1.sock --state /workspace/artwork-flux1-gpu1/native/jobs.jsonl --profile /workspace/artwork-flux1-gpu1/native/profile.json --model-dir /workspace/artwork-flux1-gpu1/models/flux1 --out-dir /workspace/artwork-flux1-gpu1/native/output --backend cuda --preload
