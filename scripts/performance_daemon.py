#!/usr/bin/env python3
"""Watch the Performance engineer lifecycle and queue durable coordinator wakes.

No model calls, image requests, child-session delivery, or direct agent spawning.
"""
import argparse
import contextlib
from datetime import datetime
import fcntl
import json
import os
from pathlib import Path
import plistlib
import selectors
import shutil
import signal
import subprocess
import sys
import time

from task_inbox import DEFAULT_DB, REPO, add, connect, now

LABEL = 'vision.influx.artwork.performance'
RUNTIME = REPO / '.runtime' / 'performance'


def timestamp(value):
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
    except (ValueError, TypeError, AttributeError):
        return None


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, separators=(',', ':')))
    temporary.chmod(0o600)
    temporary.replace(path)


def lifecycle(source, wall):
    section = source.get('agents', {})
    observed = timestamp(section.get('observedAt'))
    if section.get('ok') is not True or section.get('live') is not True or observed is None or not -1 <= wall - observed <= 12:
        return {'status': 'unknown'}
    row = next((row for row in section.get('agents', []) if row.get('id') == '/root/performance'), {})
    return {'status': row.get('status', 'unknown'), 'transition': row.get('lastTransitionAt')}


def tick(state, sample, canonical, db, wall=None):
    wall = time.time() if wall is None else wall
    agent = lifecycle(canonical, wall)
    state['agentState'] = agent['status']
    if sample:
        state['lastActivityAt'] = sample['observedAt']
        state['activityCount'] = state.get('activityCount', 0) + 1
    events = state.setdefault('events', [])
    transition = timestamp(agent.get('transition'))
    process_start = timestamp(state['startedAt'])
    if state.get('mandateActive') is True and agent['status'] in ('done', 'available', 'idle') and transition and transition >= process_start and agent['transition'] != state.get('lastWakeTransition'):
        key = 'performance-review:' + agent['transition']
        ident, _ = add(db, 'The always-on Performance engineer mandate is active and a fresh canonical observation shows /root/performance became idle. Reactivate that existing persistent agent with followup_task for the next bounded review. The daemon watches the engineer only; it does not probe the site or perform network performance measurements. Coordinator performs actual activation. No inference or image viewing/generation.', key, assignee='performance')
        state['lastWakeTransition'] = agent['transition']
        state['lastWakeRequest'] = ident
        events.append({'at': now(), 'event': 'coordinator_wake_queued'})
    wake = db.execute('SELECT state FROM inbox WHERE id=?', (state.get('lastWakeRequest'),)).fetchone()
    state['wakeState'] = wake['state'] if wake else None
    state['events'] = events[-100:]
    state['state'] = 'watching' if agent['status'] in ('running', 'done', 'available', 'idle') else 'unknown'
    last_sample = timestamp(state.get('lastActivityAt'))
    if wall - process_start >= 20 and (last_sample is None or wall - last_sample > 20):
        state['state'] = 'blocked'
    state['heartbeatAt'] = now()
    state['observedAt'] = state['heartbeatAt']
    return state


def run(args):
    args.runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (args.runtime / 'daemon.lock').open('a') as lock, contextlib.closing(connect(args.db)) as db:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('Performance daemon already running')
        try:
            state = json.loads((args.runtime / 'status.json').read_text())
        except (OSError, ValueError):
            state = {}
        started = now()
        state.update(pid=os.getpid(), startedAt=started, mandateStartedAt=state.get('mandateStartedAt', started), mandateActive=True, lastActivityAt=None)
        for retired in ('endpoints', 'issues', 'incidents'):
            state.pop(retired, None)
        state['events'] = [event for event in state.get('events', []) if event.get('event') in ('coordinator_wake_queued', 'collector_exited')]
        stop = False
        def stopping(*_):
            nonlocal stop
            stop = True
        signal.signal(signal.SIGTERM, stopping)
        signal.signal(signal.SIGINT, stopping)
        child = None
        restart_at = 0
        restart_delay = 5
        selector = selectors.DefaultSelector()
        buffered = b''
        last_write = 0
        canonical = {}
        try:
            while not stop:
                wall = time.time()
                if child is None and wall >= restart_at:
                    child = subprocess.Popen([args.node, str(REPO / 'scripts' / 'performance_lifecycle.mjs')], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, cwd=REPO)
                    os.set_blocking(child.stdout.fileno(), False)
                    selector.register(child.stdout, selectors.EVENT_READ)
                    state['collectorPid'] = child.pid
                sample = None
                for key, _ in selector.select(timeout=1):
                    chunk = os.read(key.fd, 65536)
                    if chunk:
                        buffered += chunk
                        if len(buffered) > 256 * 1024:
                            child.terminate(); buffered = b''
                        while b'\n' in buffered:
                            line, buffered = buffered.split(b'\n', 1)
                            try:
                                value = json.loads(line)
                                if value.get('type') == 'sample':
                                    sample = value
                                    restart_delay = 5
                            except (ValueError, TypeError):
                                pass
                    else:
                        selector.unregister(key.fileobj)
                if child is not None and child.poll() is not None:
                    state['lastCollectorExitCode'] = child.returncode
                    state['collectorRestarts'] = state.get('collectorRestarts', 0) + 1
                    state.setdefault('events', []).append({'at': now(), 'event': 'collector_exited'})
                    try: selector.unregister(child.stdout)
                    except KeyError: pass
                    child.stdout.close(); child = None; buffered = b''
                    state['collectorPid'] = None
                    restart_at = wall + restart_delay
                    restart_delay = min(60, restart_delay * 2)
                if sample or wall - last_write >= 5:
                    if sample:
                        canonical = sample.get('lifecycle', {})
                    tick(state, sample, canonical, db, wall)
                    atomic_json(args.runtime / 'status.json', state)
                    last_write = wall
        finally:
            if child:
                child.terminate()
                try: child.wait(timeout=5)
                except subprocess.TimeoutExpired: child.kill(); child.wait()
            selector.close()


def install(args):
    if sys.platform != 'darwin':
        raise ValueError('launchd requires macOS')
    args.runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = Path.home() / 'Library' / 'LaunchAgents' / (LABEL + '.plist')
    target.parent.mkdir(parents=True, exist_ok=True)
    spec = {'Label': LABEL, 'ProgramArguments': [sys.executable, '-B', str(Path(__file__).resolve()), '--db', str(args.db), '--runtime', str(args.runtime), 'daemon', '--node', args.node],
            'WorkingDirectory': str(REPO), 'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 30, 'Umask': 0o077,
            'StandardOutPath': str(args.runtime / 'daemon.log'), 'StandardErrorPath': str(args.runtime / 'daemon-error.log'),
            'EnvironmentVariables': {'PATH': str(Path(args.node).parent) + ':/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'}}
    with target.open('wb') as output:
        plistlib.dump(spec, output)
    target.chmod(0o600)
    domain = f'gui/{os.getuid()}'
    subprocess.run(['launchctl', 'bootout', domain + '/' + LABEL], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(['launchctl', 'bootstrap', domain, str(target)], check=True)
    return {'label': LABEL, 'plist': str(target)}


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, default=DEFAULT_DB)
    parser.add_argument('--runtime', type=Path, default=RUNTIME)
    sub = parser.add_subparsers(dest='command', required=True)
    for command in ('daemon', 'install'):
        command_parser = sub.add_parser(command)
        command_parser.add_argument('--node', default=shutil.which('node'))
    sub.add_parser('status')
    args = parser.parse_args()
    if args.command == 'status':
        print((args.runtime / 'status.json').read_text())
    elif not args.node or not Path(args.node).is_file():
        raise ValueError('Node executable required')
    elif args.command == 'install':
        print(json.dumps(install(args)))
    else:
        run(args)


if __name__ == '__main__':
    main()
