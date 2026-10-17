#!/usr/bin/env python3
"""Observe this artwork team's real lifecycle and wake only its coordinator."""
import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import plistlib
import re
import signal
import subprocess
import sys
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parent
ARTWORK = ROOT.parent
REPO = ARTWORK.parents[1]
RUNTIME = ROOT / '.runtime'
STATE = RUNTIME / 'status.json'
LABEL = 'giving.kinship.artwork-agent-watch'
POLL = 10
COOLDOWN = 60
TEAM = {'/root/vite_conversion', '/root/vite_verify', '/root/vite_workflow'}
PINNED_ROOT = os.environ.get('ARTWORK_MONITOR_ROOT_THREAD', '')
sys.path.insert(0, str(ARTWORK / 'control'))
import studio_monitor


def stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def seconds(value):
    try:
        return datetime.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
    except Exception:
        return 0


def load():
    try:
        return json.loads(STATE.read_text())
    except Exception:
        return {'pendingWake': None, 'lastWakeAt': 0, 'failures': 0, 'suppressedSignature': None}


def save(state):
    temporary = STATE.with_suffix('.tmp')
    temporary.write_text(json.dumps(state, indent=2) + '\n')
    temporary.chmod(0o600)
    temporary.replace(STATE)


class Lock:
    def __enter__(self):
        RUNTIME.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.file = (RUNTIME / 'observer.lock').open('a')
        fcntl.flock(self.file, fcntl.LOCK_EX)
    def __exit__(self, *_):
        self.file.close()


def existing_work():
    """Wrap-up uses fresh actual claims, never queued or merely open features."""
    config = json.loads((ROOT / 'config.json').read_text())
    if config.get('mode') != 'wrap-up':
        raise ValueError('Only the current authorized wrap-up mode is supported')
    excluded = set(config.get('excludedWorkIds', [])) | {'KOC-413', 'KOC-376', 'KOC-415'}
    tracker = json.loads((REPO / '.tracker/status.json').read_text())
    items = {item['id']: item for group in tracker['groups'] for item in group.get('items', [])}
    claims = json.loads((REPO / '.tracker/runtime/claims.json').read_text()).get('claims', {})
    result = []
    for ident, claim in claims.items():
        item = items.get(ident, {})
        age = time.time() - seconds(claim.get('beat') or claim.get('at'))
        if (ident not in excluded and re.fullmatch(r'KOC-\d+', ident)
                and item.get('lane') == 'artwork' and item.get('state') != 'done'
                and 0 <= age <= 2700):
            result.append(ident)
    return sorted(result)


def observation():
    # Separate offset cache avoids contention with the web collector. No content
    # or session text is copied: the existing reader emits lifecycle metadata only.
    studio_monitor.CACHE = RUNTIME / 'lifecycle.json'
    studio_monitor.ROOT_THREAD = PINNED_ROOT
    data = studio_monitor.agents()
    workers = data.get('agents', [])
    valid = (data.get('ok') and data.get('live') and data.get('capacity') == 3
             and len(workers) == 3 and {row.get('id') for row in workers} == TEAM
             and data.get('coordinator') in {'running', 'idle'}
             and all(row.get('status') in {'running', 'done', 'idle'} for row in workers))
    return data, bool(valid)


def queue_wake(state, signature, available, ready, controlled=False):
    ident = str(uuid.uuid4())
    pending = {'id': ident, 'createdAt': stamp(), 'createdSeconds': time.time(),
               'signature': signature, 'availableAgents': available, 'existingArtworkTasks': ready,
               'workMode': 'wrap-up',
               'handoff': 'unconfirmed', 'controlledVerification': controlled}
    state['pendingWake'] = pending
    state['lastWakeAt'] = pending['createdSeconds']
    save(state)  # Durable before any ambiguous command outcome.
    message = (
        'The operator requested the persistent artwork agent-capacity observer. '
        f'Watcher wake ID {ident}. '
        + ('This is its explicitly authorized one-time queue acceptance verification. ' if controlled else '')
        + 'Read tools/artwork/agent-watch/.runtime/status.json and inspect actual current team status. '
        'WRAP-UP MODE: only the existing coordinator assigns work. Inspect the listed fresh active artwork claims. '
        'Available agents must help those existing in-progress tasks, review or finish their handoff documentation. '
        'Do not pick up queued work or start a new feature. Coordinate with the current claim owner and preserve its write scope; assign only currently idle '
        'known children /root/vite_conversion, /root/vite_verify, /root/vite_workflow. '
        'Do not interrupt active agents, create agents or a Codex daemon, invent busywork, or change GPU settings. '
        "Do not delegate the coordinator's personal render-latency investigation. If no existing work can benefit from help, leave capacity honestly available. "
        f'Acknowledge this wake with python3 -B tools/artwork/agent-watch/manage.py ack --wake-id {ident}. '
        'For deliberate idle use its hold --seconds command; status remains an observation, not a claim of work.'
    )
    if not studio_monitor.daemon_alive():
        pending['handoff'] = 'coordinator-unavailable'
    else:
        try:
            result = subprocess.run([str(Path.home() / '.local/bin/codex'), 'queue',
                                     '--thread', PINNED_ROOT, '--message', message],
                                    cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
            pending['handoff'] = 'accepted' if result.returncode == 0 else 'unconfirmed'
        except Exception:
            pending['handoff'] = 'unconfirmed'
    state['mode'] = 'wake-pending' if pending['handoff'] == 'accepted' else 'handoff-unconfirmed'
    state['failures'] = 0 if pending['handoff'] == 'accepted' else state.get('failures', 0) + 1
    # Ambiguous handoffs are never replayed on a timer. Root acknowledgment or a
    # fresh capacity/work transition is necessary, plus the backoff interval.
    state['retryAfter'] = time.time() + min(900, COOLDOWN * 2 ** min(state['failures'], 4))
    save(state)
    print(json.dumps({'event': 'coordinator-wake', 'id': ident, 'handoff': pending['handoff']}), flush=True)


def tick(controlled=False):
    with Lock():
        state = load()
        data, valid = observation()
        workers = data.get('agents', [])
        available = sorted(row['id'] for row in workers if row.get('status') in {'done', 'idle'})
        state.update(checkedAt=stamp(), sourceObservedAt=data.get('observedAt'),
                     workerCapacity=3, runningWorkers=sum(row.get('status') == 'running' for row in workers),
                     availableWorkers=len(available), availableAgents=available,
                     coordinator=data.get('coordinator', 'unknown'), sourceAvailable=valid)
        if not valid:
            state['mode'] = 'source-unavailable'; save(state); return state
        try:
            ready = existing_work()
        except Exception:
            state['mode'] = 'tracker-unavailable'; save(state); return state
        state.pop('readyArtworkTasks', None)
        state['existingArtworkTasks'] = ready
        state['workMode'] = 'wrap-up'
        signature = json.dumps([available, ready])
        pending = state.get('pendingWake')
        if pending and (not available or seconds(data.get('coordinatorLastTransitionAt')) > pending['createdSeconds']):
            state['lastAcknowledgment'] = {'id': pending['id'], 'at': stamp(), 'source': 'all-workers-running' if not available else 'coordinator-lifecycle-transition'}
            state['suppressedSignature'] = pending['signature']
            state['pendingWake'] = None
            pending = None
        if controlled:
            if pending:
                raise ValueError('An existing wake must be acknowledged first')
            queue_wake(state, signature, available, ready, controlled=True)
        elif time.time() < state.get('holdUntil', 0):
            state['mode'] = 'intentional-idle'
        elif pending:
            state['mode'] = 'wake-pending' if pending['handoff'] == 'accepted' else 'handoff-unconfirmed'
        elif not available:
            state['mode'] = 'all-workers-running'; state['suppressedSignature'] = None
        elif not ready:
            state['mode'] = 'no-in-progress-artwork-to-help'
        elif signature == state.get('suppressedSignature'):
            state['mode'] = 'awaiting-capacity-or-work-change'
        elif time.time() < max(state.get('lastWakeAt', 0) + COOLDOWN, state.get('retryAfter', 0)):
            state['mode'] = 'cooldown'
        elif data['coordinator'] == 'running' and time.time() - seconds(data.get('coordinatorLastTransitionAt')) < 30:
            state['mode'] = 'coordinator-responding'
        else:
            queue_wake(state, signature, available, ready)
        save(state)
        return state


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['check', 'once', 'run', 'start', 'stop', 'status', 'ack', 'hold', 'clear-hold', 'verify-queue'])
    parser.add_argument('--wake-id')
    parser.add_argument('--seconds', type=int, default=900)
    args = parser.parse_args()
    service = f'gui/{os.getuid()}/{LABEL}'
    if args.action == 'check':
        compile(Path(__file__).read_text(), str(Path(__file__)), 'exec')
        assert studio_monitor.ROOT_THREAD == PINNED_ROOT and len(TEAM) == 3
        print('Agent watcher parses; pinned existing team only. No wake submitted.'); return
    if args.action in {'once', 'verify-queue'}:
        print(json.dumps(tick(controlled=args.action == 'verify-queue'), indent=2)); return
    if args.action in {'ack', 'hold', 'clear-hold'}:
        with Lock():
            state = load()
            if args.action == 'ack':
                pending = state.get('pendingWake')
                if not pending and state.get('lastAcknowledgment', {}).get('id') == args.wake_id:
                    print('Watcher wake was already acknowledged.'); return
                if not pending or pending['id'] != args.wake_id:
                    raise ValueError('No matching pending wake')
                state['lastAcknowledgment'] = {'id': pending['id'], 'at': stamp(), 'source': 'explicit-coordinator-ack'}
                state['suppressedSignature'] = pending['signature']; state['pendingWake'] = None
            else:
                if not 1 <= args.seconds <= 86400:
                    raise ValueError('Idle hold must be 1–86400 seconds')
                state['holdUntil'] = time.time() + args.seconds if args.action == 'hold' else 0
            save(state)
        print('Watcher control recorded.'); return
    if args.action == 'run':
        stop = threading.Event()
        for sig in [signal.SIGINT, signal.SIGTERM]:
            signal.signal(sig, lambda *_: stop.set())
        while not stop.is_set():
            try:
                tick()
            except Exception as problem:
                print('Agent watch observation unavailable: ' + type(problem).__name__, flush=True)
            stop.wait(POLL)
        return
    status = subprocess.run(['launchctl', 'print', service], capture_output=True, text=True)
    if args.action == 'status':
        print(json.dumps({'loaded': status.returncode == 0, 'processRunning': 'state = running' in status.stdout, 'observation': load()}, indent=2))
    elif args.action == 'stop':
        if status.returncode == 0:
            subprocess.run(['launchctl', 'bootout', service], check=True)
    elif status.returncode != 0:
        RUNTIME.mkdir(parents=True, exist_ok=True, mode=0o700)
        config = {'Label': LABEL, 'ProgramArguments': [sys.executable, '-B', str(Path(__file__).resolve()), 'run'],
                  'WorkingDirectory': str(REPO), 'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 15,
                  'ExitTimeOut': 40, 'StandardOutPath': str(RUNTIME / 'watch.log'), 'StandardErrorPath': str(RUNTIME / 'watch.log')}
        file = RUNTIME / (LABEL + '.plist')
        with file.open('wb') as output:
            plistlib.dump(config, output)
        subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(file)], check=True)
        print('Owned agent-capacity observer loaded.')
    else:
        print('Agent-capacity observer already loaded.')


if __name__ == '__main__':
    main()
