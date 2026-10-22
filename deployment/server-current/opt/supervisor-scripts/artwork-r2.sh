#!/bin/bash
set -euo pipefail
cd /workspace/artwork/r2
exec /workspace/artwork/r2/.venv/bin/python -B -u stream.py
