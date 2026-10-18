#!/bin/bash
set -euo pipefail
venv=/workspace/artwork/.download-venv
if [ ! -x "$venv/bin/python" ]; then
    uv venv --python /venv/main/bin/python "$venv"
fi
if ! "$venv/bin/python" -c "import huggingface_hub" >/dev/null 2>&1; then
    uv pip install --python "$venv/bin/python" huggingface_hub
fi
for attempt in {1..10}; do
    if "$venv/bin/python" -u /workspace/artwork/download.py; then
        exit 0
    fi
    echo "Model download attempt $attempt failed; resume in 15 seconds"
    sleep 15
done
exit 1
