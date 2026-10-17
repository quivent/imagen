#!/usr/bin/env python3
"""Watch ready work and real agents; persist penalties and escalate once.

The Enforcer never fabricates activity or assigns/spawns agents directly. It
queues ID-only notices to the full coordinator, which owns tool assignment.
Only explicitly authorized, locally ready tasks are eligible.
"""
import argparse
import contextlib
import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import sys
import time
import uuid

from task_inbox import DEFAULT_DB, MONITOR, REPO, connect, dispatch_once, enforcement_tick, install, now

LABEL = 'vision.influx.artwork.enforcer'


def run(args):
    with contextlib.closing(connect(args.db)) as db, Path(str(args.db) + '.enforcer.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('Enforcer is already running')
        # Never replay an interrupted queue attempt: acceptance may have
        # happened before the process died. The coordinator reconciles it.
        db.execute("UPDATE inbox SET state='uncertain',outcome='interrupted_delivery_requires_reconciliation',updated_at=? WHERE state='sending' AND dedupe_key LIKE 'enforcement:%'", (now(),))
        stop = False

        def stopping(*_):
            nonlocal stop
            stop = True

        signal.signal(signal.SIGTERM, stopping)
        signal.signal(signal.SIGINT, stopping)
        run_id = str(uuid.uuid4())
        while not stop:
            try:
                enforcement_tick(db, args.monitor, args.tasks,
                                 Path(args.db).parent / 'enforcement.json', run_id)
                outcome = dispatch_once(db, args.db, args.thread, args.codex, enforcement_only=True)
                if outcome:
                    print(json.dumps(outcome), flush=True)
                db.execute('INSERT OR REPLACE INTO daemon_state VALUES(?,?)', ('enforcer_heartbeat', now()))
            except (OSError, ValueError) as exc:
                # Payload-free logs: never include raw snapshots or errors.
                print(json.dumps({'event': 'enforcement_observation_failed', 'type': type(exc).__name__}), flush=True)
            time.sleep(args.interval)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, default=DEFAULT_DB)
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ('daemon', 'install'):
        p = sub.add_parser(name)
        p.add_argument('--thread', required=True, help='full coordinator session; child session input is prohibited')
        p.add_argument('--codex', default=shutil.which('codex') or 'codex')
        if name == 'daemon':
            p.add_argument('--monitor', type=Path, default=MONITOR)
            p.add_argument('--tasks', type=Path, default=REPO / 'tasks.json')
            p.add_argument('--interval', type=float, default=2)
    sub.add_parser('status')
    args = parser.parse_args()
    args.db = args.db.expanduser().resolve()
    if args.command == 'install':
        args.label, args.script, args.log_stem = LABEL, Path(__file__).resolve(), 'enforcer'
        print(json.dumps(install(args)))
    elif args.command == 'status':
        path = args.db.parent / 'enforcement.json'
        print(path.read_text() if path.exists() else json.dumps({'state': 'unknown', 'score': 0}))
    else:
        if args.interval < 1:
            raise ValueError('interval must be at least one second')
        run(args)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as exc:
        print(f'Enforcer error: {type(exc).__name__}', file=sys.stderr)
        sys.exit(1)
