#!/bin/bash
set -euo pipefail
. /opt/supervisor-scripts/utils/logging.sh /workspace/artwork/judges/gemma.log
export CUDA_VISIBLE_DEVICES=0
export HF_HOME=/workspace/artwork/hf
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
export VLLM_NO_USAGE_STATS=1
export OMP_NUM_THREADS=4
export SEER_MODEL_ID=gemma
export PYTHONPATH=/workspace/artwork/judges${PYTHONPATH:+:$PYTHONPATH}
cd /workspace/artwork/judges
test -f runtime-ready
exec .venv/bin/vllm serve /workspace/artwork/judges/models/gemma4-12b-it-nvfp4 \
  --served-model-name gemma4-12b-artist --host 127.0.0.1 --port 8004 \
  --dtype bfloat16 --gpu-memory-utilization 0.20 \
  --max-model-len 8192 --max-num-seqs 1 \
  --limit-mm-per-prompt '{"image":1,"audio":0,"video":0}' \
  --speculative-config '{"method":"mtp","model":"/workspace/artwork/judges/models/gemma4-12b-it-assistant","num_speculative_tokens":3}' \
  --reasoning-parser gemma4 --enforce-eager \
  --middleware seer_observer.SeerObserver
