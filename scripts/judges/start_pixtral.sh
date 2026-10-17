#!/bin/bash
set -euo pipefail
. /opt/supervisor-scripts/utils/logging.sh /workspace/artwork/judges/pixtral.log
export CUDA_VISIBLE_DEVICES=0
export HF_HOME=/workspace/artwork/hf
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
export VLLM_NO_USAGE_STATS=1
export OMP_NUM_THREADS=4
export VLLM_LOGGING_LEVEL=INFO
export SEER_MODEL_ID=pixtral
export PYTHONPATH=/workspace/artwork/judges${PYTHONPATH:+:$PYTHONPATH}
cd /workspace/artwork/judges
test -f runtime-ready
exec .venv/bin/vllm serve /workspace/artwork/judges/models/pixtral \
  --served-model-name pixtral-critic --host 127.0.0.1 --port 8002 \
  --dtype half --gpu-memory-utilization 0.20 \
  --max-model-len 8192 --max-num-seqs 1 \
  --limit-mm-per-prompt '{"image":1}' --enforce-eager \
  --middleware seer_observer.SeerObserver
