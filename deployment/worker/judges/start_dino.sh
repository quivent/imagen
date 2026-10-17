#!/bin/bash
set -euo pipefail
. /opt/supervisor-scripts/utils/logging.sh /workspace/artwork/judges/dino.log
export CUDA_VISIBLE_DEVICES=0
export HF_HOME=/workspace/artwork/hf
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
export OMP_NUM_THREADS=4
cd /workspace/artwork/judges
test -f runtime-ready
exec .venv/bin/uvicorn dino_server:app --host 127.0.0.1 --port 8003 --workers 1 --no-access-log
