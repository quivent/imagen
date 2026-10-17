#!/usr/bin/env python3
"""Persist fixed studio correction requests and hand them to the existing team."""
import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

from studio_monitor import daemon_alive, ROOT_THREAD, agents, generation, tasks

REPO = Path(__file__).resolve().parents[1]
ARTWORK = Path(os.environ.get('ARTWORK_FACTORY_ROOT', str(REPO / 'deployment/controller/tools/artwork')))
LEGACY_STATE = Path.home() / 'kinship-of-cancer/tools/artwork/.state'
FACTORY_STATE = Path(os.environ.get('ARTWORK_FACTORY_STATE', str(LEGACY_STATE if LEGACY_STATE.exists() else ARTWORK / '.state')))
DIRECTORY = FACTORY_STATE / 'corrections'
RULES = {'generation', 'agents', 'tasks'}


def public(record):
    return {key: record.get(key) for key in
            ['requestId', 'rule', 'status', 'createdAt', 'handoff', 'serviceRecovery', 'detail',
             'verifiedAt', 'outcome', 'evidence']}


def run_known(script):
    try:
        result = subprocess.run([sys.executable, '-B', str(ARTWORK / 'remote' / script), 'start'],
                                cwd=REPO, env={**os.environ, 'ARTWORK_FACTORY_STATE': str(FACTORY_STATE), 'ARTWORK_STATE': str(FACTORY_STATE)},
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
        return 'started-or-already-loaded' if result.returncode == 0 else 'needs-attention'
    except Exception:
        return 'unconfirmed'


def request(rule, request_id):
    if rule not in RULES or str(uuid.UUID(request_id)) != request_id:
        raise ValueError('Invalid correction request')
    DIRECTORY.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (DIRECTORY / 'requests.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        destination = DIRECTORY / (request_id + '.json')
        if destination.exists():
            previous = json.loads(destination.read_text())
            if previous['rule'] != rule:
                raise ValueError('Request identity belongs to another rule')
            return public(previous)
        record = {'requestId': request_id, 'rule': rule, 'status': 'pending',
                  'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  'handoff': 'not-attempted', 'serviceRecovery': {},
                  'detail': 'Correction requested. Current compliance remains determined by live observations.'}
        def save():
            temporary = destination.with_suffix('.tmp')
            temporary.write_text(json.dumps(record, indent=2) + '\n')
            temporary.chmod(0o600)
            temporary.replace(destination)
        # Durable before either service recovery or a potentially ambiguous handoff.
        save()
        if rule == 'generation':
            record['serviceRecovery'] = {name: run_known(script) for name, script in
                                         [('refiller', 'refill.py'), ('adapters', 'factory_worker.py')]}
            save()
        if daemon_alive():
            message = (
                'A studio Monitor correction was explicitly requested by the operator. '
                f"Read {DIRECTORY / (request_id + '.json')}. "
                f'Rule: {rule}. Inspect current actual health, then correct the cause within existing authorization. '
                'WRAP-UP MODE: for agent or task work, inspect actual fresh active artwork claims and '
                'help those existing in-progress tasks or finish their handoff documentation only. '
                'Coordinate with the current claim owner, preserve claim write scopes, and assign the '
                'existing known three children only when idle. Do not pick up queued work, start a '
                'new feature, or revive a removed task or target. If no existing work can benefit '
                'from help, report that honestly and keep available capacity idle. '
                'Do not create busywork, interrupt active agents, create a new daemon, or report a queued request as corrected. '
                'Do not change GPU power, precision, steps, selected artwork, or automatically override explicitly paused lanes. '
                'Update this durable correction record with evidence only after actual verification.'
            )
            try:
                result = subprocess.run([str(Path.home() / '.local/bin/codex'), 'queue',
                                         '--thread', ROOT_THREAD, '--message', message],
                                        cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
                record['handoff'] = 'accepted' if result.returncode == 0 else 'unconfirmed'
            except Exception:
                record['handoff'] = 'unconfirmed'
        else:
            record['handoff'] = 'coordinator-unavailable'
        record['detail'] = ('Correction is recorded and queued for the existing coordinator. Live observations confirm the outcome.'
                            if record['handoff'] == 'accepted' else
                            'Correction is recorded. Coordinator delivery could not be confirmed; the request remains pending.')
        save()
        return public(record)


def verify(request_id):
    """Record actual healthy observation, without attributing it to the request."""
    if str(uuid.UUID(request_id)) != request_id:
        raise ValueError('Invalid request identity')
    with (DIRECTORY / 'requests.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        destination = DIRECTORY / (request_id + '.json')
        record = json.loads(destination.read_text())
        rule = record['rule']
        observation = {'agents': agents, 'generation': generation, 'tasks': tasks}[rule]()
        healthy = False
        if observation.get('ok') and rule == 'agents':
            workers = observation.get('agents', [])
            healthy = observation.get('coordinator') == 'running' and len(workers) == 3 and all(worker['status'] == 'running' for worker in workers)
        elif observation.get('ok') and rule == 'generation':
            workers = observation.get('workers', [])
            healthy = len(workers) == 2 and all(worker.get('running') and not worker.get('paused') for worker in workers)
        elif observation.get('ok') and rule == 'tasks':
            healthy = bool(observation.get('working'))
        if healthy:
            record.update(status='verified', verifiedAt=observation.get('observedAt'),
                          outcome='Healthy at observation; the queued request is not evidence that recovery caused activity.',
                          evidence=observation,
                          detail='The live source verifies this rule at the recorded observation. Future status remains live.')
            temporary = destination.with_suffix('.tmp')
            temporary.write_text(json.dumps(record, indent=2) + '\n')
            temporary.chmod(0o600)
            temporary.replace(destination)
        return public(record)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['check', 'request', 'status', 'verify'])
    parser.add_argument('--rule', choices=sorted(RULES))
    parser.add_argument('--request-id')
    args = parser.parse_args()
    if args.action == 'check':
        compile(Path(__file__).read_text(), str(Path(__file__)), 'exec')
        assert all((ARTWORK / 'remote' / script).is_file() for script in ['refill.py', 'factory_worker.py'])
        print('Correction helper parses; fixed service targets exist. No correction submitted.')
    elif args.action == 'request':
        print(json.dumps({'ok': True, **request(args.rule, args.request_id)}))
    elif args.action == 'verify':
        print(json.dumps({'ok': True, **verify(args.request_id)}))
    else:
        if str(uuid.UUID(args.request_id)) != args.request_id:
            raise ValueError('Invalid request identity')
        file = DIRECTORY / (args.request_id + '.json')
        print(json.dumps({'ok': True, **public(json.loads(file.read_text()))}))


if __name__ == '__main__':
    main()
