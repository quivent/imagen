#!/bin/bash
set -euo pipefail
. /opt/supervisor-scripts/utils/logging.sh /workspace/artwork/judges/qwen.log
export CUDA_VISIBLE_DEVICES=0,1
export HF_HOME=/workspace/artwork/hf
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
export VLLM_NO_USAGE_STATS=1
export OMP_NUM_THREADS=4
cd /workspace/artwork/judges
exec .venv/bin/vllm serve /workspace/artwork/judges/models/qwen3.8-27b-nvfp4 \
  --served-model-name qwen-precision --host 127.0.0.1 --port 8005 \
  --dtype bfloat16 --tensor-parallel-size 2 --gpu-memory-utilization 0.16 \
  --kv-cache-memory-bytes 805306368 \
  --max-model-len 4096 --max-num-batched-tokens 512 --max-num-seqs 1 --language-model-only \
  --speculative-config '{"method":"mtp","num_speculative_tokens":3}' \
  --kernel-config '{"enable_flashinfer_autotune":false}' \
  --enforce-eager
