#!/bin/bash
set -euo pipefail
export HF_HOME=/workspace/artwork/hf
export PYTHONUNBUFFERED=1
export TOKENIZERS_PARALLELISM=REDACTED_PRIVATE_VALUE
export CUDA_VISIBLE_DEVICES=0
export HF_HUB_OFFLINE=1
cd /workspace/artwork
exec /workspace/artwork/.venv/bin/python -u native_launch.py --socket /workspace/artwork/native/flux1.sock --state /workspace/artwork/native/jobs.jsonl --profile /workspace/artwork/native/profile.json --model-dir /workspace/artwork/models/flux1 --out-dir /workspace/artwork/native/output --backend cuda --preload
