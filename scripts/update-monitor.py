#!/usr/bin/env python3
"""Write a public, dated agent observation from validated JSON on stdin."""
import datetime
import json
import os
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    payload = json.loads(sys.stdin.read(20001))
    if not isinstance(payload, dict) or set(payload) != {'observedAt', 'capacity', 'coordinator', 'agents'}:
        raise ValueError('Expected observedAt, capacity, coordinator and agents only')
    observed = datetime.datetime.fromisoformat(payload['observedAt'].replace('Z', '+00:00'))
    now = datetime.datetime.now(datetime.timezone.utc)
    if observed.tzinfo is None or (observed - now).total_seconds() > 30:
        raise ValueError('Observation must be dated, with timezone, and not in the future')
    if payload['capacity'] != 3 or payload['coordinator'] not in {'running', 'idle', 'unknown'}:
        raise ValueError('Expected three worker slots and a coordinator state')
    if not isinstance(payload['agents'], list) or len(payload['agents']) > 3:
        raise ValueError('At most three worker observations')
    ids = set()
    for agent in payload['agents']:
        if not isinstance(agent, dict) or set(agent) != {'id', 'task', 'status'}:
            raise ValueError('Agent fields must be id, task and status')
        if agent['status'] not in {'running', 'idle', 'waiting', 'done', 'failed', 'interrupted', 'unknown'}:
            raise ValueError('Unsupported agent status')
        for key, limit in [('id', 100), ('task', 300)]:
            value = agent[key]
            if not isinstance(value, str) or not value.strip() or len(value) > limit or any(ord(c) < 32 for c in value):
                raise ValueError('Agent text must be short plain public text')
        if agent['id'] in ids:
            raise ValueError('Duplicate agent')
        ids.add(agent['id'])
    result = {'schemaVersion': 1, 'source': 'collaboration.list_agents observation', **payload}
    descriptor, name = tempfile.mkstemp(prefix='.monitor-', dir=ROOT)
    try:
        with os.fdopen(descriptor, 'w') as output:
            output.write(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
        os.replace(name, ROOT / 'monitor-state.json')
    finally:
        if os.path.exists(name):
            os.unlink(name)
    print('Public monitor observation updated')


if __name__ == '__main__':
    main()
