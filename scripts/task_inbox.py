#!/usr/bin/env python3
"""Durable private prompt inbox; notify an existing session without repeating work.

Intake is explicit: the coordinator must add each incoming request. This script
does not intercept chat messages. Queue acceptance is not acknowledgement.
"""
import argparse
import contextlib
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import signal
import sqlite3
import subprocess
import sys
import time
import uuid

REPO = Path(__file__).resolve().parents[1]
DEFAULT_DB = REPO / '.runtime' / 'task-inbox' / 'inbox.sqlite3'
LABEL = 'vision.influx.artwork.task-inbox'


def now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def connect(path):
    path = Path(path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    db = sqlite3.connect(path, timeout=10, isolation_level=None)
    os.chmod(path, 0o600)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('PRAGMA synchronous=FULL')
    db.executescript('''
        CREATE TABLE IF NOT EXISTS inbox (
          id TEXT PRIMARY KEY, dedupe_key TEXT UNIQUE NOT NULL,
          body TEXT NOT NULL, created_at TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'pending'
            CHECK(state IN ('pending','sending','notified','uncertain','acked')),
          batch TEXT, updated_at TEXT NOT NULL, task_id TEXT,
          attempts INTEGER NOT NULL DEFAULT 0, outcome TEXT
        );
        CREATE TABLE IF NOT EXISTS daemon_state (
          key TEXT PRIMARY KEY, value TEXT NOT NULL
        );
    ''')
    return db


@contextlib.contextmanager
def transaction(db):
    db.execute('BEGIN IMMEDIATE')
    try:
        yield
    except BaseException:
        db.execute('ROLLBACK')
        raise
    else:
        db.execute('COMMIT')


def add(db, text, dedupe_key=None):
    text = text.strip()
    if not text or len(text.encode()) > 65536:
        raise ValueError('request must contain 1–65536 UTF-8 bytes')
    key = dedupe_key or hashlib.sha256(text.encode()).hexdigest()
    if not key or len(key) > 256:
        raise ValueError('dedupe key must contain 1–256 characters')
    with transaction(db):
        old = db.execute('SELECT id, body FROM inbox WHERE dedupe_key=?', (key,)).fetchone()
        if old:
            if old['body'] != text:
                raise ValueError('dedupe key already belongs to different content')
            return old['id'], False
        ident = str(uuid.uuid4())
        timestamp = now()
        db.execute('INSERT INTO inbox(id,dedupe_key,body,created_at,updated_at) VALUES(?,?,?,?,?)',
                   (ident, key, text, timestamp, timestamp))
    return ident, True


def metadata(db, include_acked=False):
    columns = 'id,created_at,state,updated_at,task_id,attempts,outcome'
    where = '' if include_acked else "WHERE state != 'acked'"
    return [dict(r) for r in db.execute(f'SELECT {columns} FROM inbox {where} ORDER BY created_at,id')]


def acknowledge(db, ids, task_id):
    with transaction(db):
        for ident in ids:
            row = db.execute('SELECT state,task_id FROM inbox WHERE id=?', (ident,)).fetchone()
            if row is None:
                raise ValueError('unknown inbox ID')
            if row['state'] == 'acked' and row['task_id'] != task_id:
                raise ValueError('acknowledged ID already linked to another task')
            db.execute("UPDATE inbox SET state='acked',task_id=?,updated_at=? WHERE id=?",
                       (task_id, now(), ident))


def dispatch_once(db, db_path, thread, codex, timeout=30):
    """One attempt per batch; any ambiguous failure requires explicit reconciliation."""
    with transaction(db):
        rows = db.execute("SELECT id FROM inbox WHERE state='pending' ORDER BY created_at,id LIMIT 10").fetchall()
        if not rows:
            return None
        ids = [r['id'] for r in rows]
        batch = str(uuid.uuid4())
        for ident in ids:
            db.execute("UPDATE inbox SET state='sending',batch=?,attempts=attempts+1,updated_at=? WHERE id=?",
                       (batch, now(), ident))
    # Never send user payload or subprocess output to queue/logs. Only IDs and
    # the local read command leave the private database.
    message = (f'Task inbox batch {batch}: new durable request IDs {", ".join(ids)}. '
               f'Use Task Keeper to read them with scripts/task_inbox.py --db {db_path} read ID, '
               'record/update tasks.json, then ack each ID with --task-id TASK_ID. '
               'This is one notification, not a request to start another watcher or agent. '
               'Acknowledge only after recording the user request; do not requeue this notice.')
    state, outcome = 'uncertain', 'queue_result_unknown'
    try:
        result = subprocess.run([codex, 'queue', '--thread', thread, '--message', message],
                                cwd=REPO, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, timeout=timeout)
        if result.returncode == 0:
            state, outcome = 'notified', 'queue_accepted_not_read'
        else:
            outcome = 'queue_nonzero_requires_reconciliation'
    except FileNotFoundError:
        outcome = 'queue_executable_missing'
    except subprocess.TimeoutExpired:
        outcome = 'queue_timeout_requires_reconciliation'
    except OSError:
        outcome = 'queue_oserror_requires_reconciliation'
    with transaction(db):
        db.execute("UPDATE inbox SET state=?,outcome=?,updated_at=? WHERE batch=? AND state='sending'",
                   (state, outcome, now(), batch))
    return {'batch': batch, 'ids': ids, 'state': state, 'outcome': outcome}


def run_daemon(db, args):
    lock_path = Path(str(args.db) + '.lock')
    with lock_path.open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('task inbox daemon is already running')
        # A process may die after queue acceptance but before recording it.
        # Preserve those batches for manual reconciliation, never resend them.
        db.execute("UPDATE inbox SET state='uncertain',outcome='interrupted_delivery_requires_reconciliation',updated_at=? WHERE state='sending'", (now(),))
        stopping = False

        def stop(*_):
            nonlocal stopping
            stopping = True

        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        while not stopping:
            result = dispatch_once(db, args.db, args.thread, args.codex)
            if result:
                print(json.dumps(result), flush=True)
            db.execute('INSERT OR REPLACE INTO daemon_state(key,value) VALUES(?,?)', ('heartbeat', now()))
            time.sleep(args.interval)


def install(args):
    if sys.platform != 'darwin':
        raise ValueError('launchd installation requires macOS')
    # Keep the stable launcher path so ordinary CLI upgrades do not strand us
    # on an old versioned executable.
    executable = Path(args.codex).expanduser().absolute()
    if not executable.is_file() or not os.access(executable, os.X_OK):
        raise ValueError('Codex executable must be an existing executable file')
    runtime = Path(args.db).parent
    runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = Path.home() / 'Library' / 'LaunchAgents' / (LABEL + '.plist')
    target.parent.mkdir(parents=True, exist_ok=True)
    program = [sys.executable, str(Path(__file__).resolve()), '--db', str(args.db),
               'daemon', '--thread', args.thread, '--codex', str(executable)]
    spec = {'Label': LABEL, 'ProgramArguments': program, 'WorkingDirectory': str(REPO),
            'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 10,
            'Umask': 0o077, 'StandardOutPath': str(runtime / 'daemon.log'),
            'StandardErrorPath': str(runtime / 'daemon-error.log'),
            'EnvironmentVariables': {'PATH': f'{executable.parent}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'}}
    with target.open('wb') as f:
        plistlib.dump(spec, f)
    os.chmod(target, 0o600)
    domain = f'gui/{os.getuid()}'
    # Replacement is explicit; bootstrap errors stay visible to the caller.
    subprocess.run(['launchctl', 'bootout', f'{domain}/{LABEL}'],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for attempt in range(6):
        result = subprocess.run(['launchctl', 'bootstrap', domain, str(target)],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if result.returncode == 0:
            break
        if attempt == 5:
            raise ValueError('launchd bootstrap failed')
        # bootout may return before the old service has fully unregistered.
        time.sleep(0.5 * (attempt + 1))
    return {'label': LABEL, 'plist': str(target), 'thread': args.thread}


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, default=DEFAULT_DB)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('add', help='read request from stdin or private file; output metadata only')
    p.add_argument('--text-file', type=Path)
    p.add_argument('--dedupe-key', help='use source message ID; content hash is fallback')
    p = sub.add_parser('list', help='list metadata only, never request text')
    p.add_argument('--all', action='store_true')
    p = sub.add_parser('read', help='explicitly retrieve private request content')
    p.add_argument('id')
    p = sub.add_parser('ack', help='mark request recorded in the task list')
    p.add_argument('ids', nargs='+')
    p.add_argument('--task-id', required=True)
    p = sub.add_parser('retry', help='explicitly retry only after confirming prior delivery did not occur')
    p.add_argument('id')
    p.add_argument('--confirmed-not-delivered', action='store_true', required=True)
    for name in ('daemon', 'install'):
        p = sub.add_parser(name)
        p.add_argument('--thread', required=True)
        p.add_argument('--codex', default=shutil.which('codex') or 'codex')
        if name == 'daemon':
            p.add_argument('--interval', type=float, default=2.0)
    sub.add_parser('status', help='counts and last daemon heartbeat without private content')
    args = parser.parse_args()
    args.db = args.db.expanduser().resolve()
    with contextlib.closing(connect(args.db)) as db:
        if args.command == 'add':
            body = args.text_file.read_text() if args.text_file else sys.stdin.read(65537)
            ident, created = add(db, body, args.dedupe_key)
            print(json.dumps({'id': ident, 'created': created}))
        elif args.command == 'list':
            print(json.dumps(metadata(db, args.all), indent=2))
        elif args.command == 'read':
            row = db.execute('SELECT id,body,state,task_id FROM inbox WHERE id=?', (args.id,)).fetchone()
            if row is None:
                raise ValueError('unknown inbox ID')
            print(json.dumps(dict(row), ensure_ascii=False))
        elif args.command == 'ack':
            acknowledge(db, args.ids, args.task_id)
            print(json.dumps({'acked': args.ids, 'task_id': args.task_id}))
        elif args.command == 'retry':
            with transaction(db):
                result = db.execute("UPDATE inbox SET state='pending',batch=NULL,updated_at=?,outcome='operator_confirmed_not_delivered' WHERE id=? AND state='uncertain' AND attempts<3", (now(), args.id))
                if result.rowcount != 1:
                    raise ValueError('ID must be uncertain with fewer than three attempts')
            print(json.dumps({'pending': args.id}))
        elif args.command == 'status':
            counts = {r['state']: r['n'] for r in db.execute('SELECT state,count(*) AS n FROM inbox GROUP BY state')}
            heartbeat = db.execute("SELECT value FROM daemon_state WHERE key='heartbeat'").fetchone()
            print(json.dumps({'counts': counts, 'heartbeat': heartbeat['value'] if heartbeat else None}))
        elif args.command == 'daemon':
            if args.interval < 1:
                raise ValueError('daemon interval must be at least one second')
            run_daemon(db, args)
        elif args.command == 'install':
            print(json.dumps(install(args)))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, sqlite3.Error, OSError, subprocess.CalledProcessError) as exc:
        # Do not echo user payloads, credentials or external command output.
        print(f'task inbox error: {type(exc).__name__}', file=sys.stderr)
        sys.exit(1)
