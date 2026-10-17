#!/usr/bin/env python3
"""Update the local assignment snapshot served by the studio."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import tempfile

PATH = Path(__file__).resolve().parents[1] / 'agent-status.json'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('worker', choices=['controls', 'runtime', 'models', 'judges'])
    parser.add_argument('--status', choices=['assigned', 'working', 'done', 'idle'], required=True)
    parser.add_argument('--task')
    args = parser.parse_args()
    data = json.loads(PATH.read_text())
    worker = next(row for row in data['workers'] if row['id'] == args.worker)
    worker['status'] = args.status
    if args.task:
        worker['task'] = args.task
    data['updatedAt'] = datetime.now(timezone.utc).isoformat()
    handle, name = tempfile.mkstemp(dir=PATH.parent, prefix='.agents-', suffix='.tmp')
    try:
        with os.fdopen(handle, 'w') as stream:
            json.dump(data, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
        os.replace(name, PATH)
    finally:
        if os.path.exists(name):
            os.unlink(name)
    print(f"Snapshot updated: {args.worker} {args.status}.")

if __name__ == '__main__':
    main()
