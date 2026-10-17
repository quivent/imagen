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
import re
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
MONITOR = REPO / '.runtime' / 'monitor' / 'status.json'


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
        CREATE TABLE IF NOT EXISTS enforcement_observations (
          id TEXT PRIMARY KEY, observed_at REAL NOT NULL, violated INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS enforcement_penalties (
          observation_id TEXT PRIMARY KEY, seconds INTEGER NOT NULL,
          recorded_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS enforcement_state (
          key TEXT PRIMARY KEY, value TEXT NOT NULL
        );
    ''')
    with transaction(db):
        columns = {row['name'] for row in db.execute('PRAGMA table_info(inbox)')}
        for column in ('requested_priority', 'requested_assignee'):
            if column not in columns:
                db.execute(f'ALTER TABLE inbox ADD COLUMN {column} TEXT')
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


def add(db, text, dedupe_key=None, priority=None, assignee=None):
    text = text.strip()
    if not text or len(text.encode()) > 65536:
        raise ValueError('request must contain 1–65536 UTF-8 bytes')
    key = dedupe_key or hashlib.sha256(text.encode()).hexdigest()
    if not key or len(key) > 256:
        raise ValueError('dedupe key must contain 1–256 characters')
    if any(value is not None and (not value.strip() or len(value) > 100) for value in (priority, assignee)):
        raise ValueError('explicit priority/assignee must contain 1–100 characters')
    with transaction(db):
        old = db.execute('SELECT id,body,requested_priority,requested_assignee FROM inbox WHERE dedupe_key=?', (key,)).fetchone()
        if old:
            if old['body'] != text or old['requested_priority'] != priority or old['requested_assignee'] != assignee:
                raise ValueError('dedupe key already belongs to different content')
            return old['id'], False
        ident = str(uuid.uuid4())
        timestamp = now()
        db.execute('INSERT INTO inbox(id,dedupe_key,body,created_at,updated_at,requested_priority,requested_assignee) VALUES(?,?,?,?,?,?,?)',
                   (ident, key, text, timestamp, timestamp, priority, assignee))
    return ident, True


def metadata(db, include_acked=False):
    columns = 'id,created_at,state,updated_at,task_id,attempts,outcome,requested_priority,requested_assignee'
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


def enforcement_tick(db, monitor_path=MONITOR, tasks_path=REPO / 'tasks.json',
                     output=None, run_id=None, current_time=None):
    """Charge only between distinct, fresh idle observations in this daemon run.

    Explicit readiness is required, so old queued/wrapup records cannot cause
    dispatch or penalties. Unknown sources, restart gaps and stale intervals
    break continuity and never accrue inferred penalties.
    """
    wall = time.time() if current_time is None else current_time
    run_id = run_id or 'manual'
    fresh, observed, running, ready, source_id = False, None, None, [], None
    dispatchable, assigned, available_ids = [], [], []
    try:
        source = json.loads(Path(monitor_path).read_text())
        agents = source['agents']
        observed = datetime.fromisoformat(agents['observedAt'].replace('Z', '+00:00')).timestamp()
        rows = agents['agents']
        fresh = agents.get('ok') is True and agents.get('live') is True and -1 <= wall - observed <= 12
        if not isinstance(rows, list) or any(not isinstance(a, dict) or a.get('status') not in
            ('running', 'working', 'idle', 'available', 'waiting', 'done', 'failed', 'interrupted', 'assigned', 'unknown') for a in rows):
            fresh = False
        # An unknown child status cannot prove that every worker is idle.
        if any(a.get('status') == 'unknown' for a in rows):
            fresh = False
        running = sum(a.get('status') in ('running', 'working') for a in rows)
        available_ids = [a.get('id') for a in rows if a.get('status') in ('idle', 'available', 'done') and isinstance(a.get('id'), str)]
        if agents.get('coordinator') in ('idle', 'available', 'done'):
            available_ids.append('/root')
        aliases = {'root': '/root', 'coordinator': '/root', 'task keeper': '/root/task_list',
                   'frontend': '/root/repo_organization', 'site setup': '/root/vast_site',
                   'model downloads': '/root/model_downloads', 'short tasks': '/root/short_tasks',
                   'performance': '/root/performance', 'protocol': '/root/protocol'}
        def canonical(owner):
            owner = str(owner)
            return aliases.get(owner.lower(), owner if owner.startswith('/root') else '/root/' + owner)
        tasks = json.loads(Path(tasks_path).read_text())['tasks']
        for task in tasks:
            readiness = task.get('readiness', {})
            ident = task.get('id', '')
            if (task.get('status') in ('working', 'next') and readiness.get('ready') is True
                and readiness.get('authorized') is True and readiness.get('scope') == 'local'
                and readiness.get('blocked') is False and not str(task.get('owner', '')).startswith('peer')
                and isinstance(ident, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,100}', ident)):
                ready.append(ident)
                owner = canonical(task.get('requestedAssignee') or task.get('owner', 'root'))
                active_owner = any(a.get('id') == owner and a.get('status') in ('running', 'working')
                                   and a.get('currentTaskId') == ident for a in rows)
                active_coordinator = owner == '/root' and agents.get('coordinator') in ('running', 'working') and agents.get('coordinatorCurrentTaskId') == ident
                if active_owner or active_coordinator:
                    assigned.append(ident)
                    continue
                explicit = task.get('requestedAssignee')
                eligible = readiness.get('eligibleAssignees')
                if explicit:
                    eligible = [explicit]
                elif not isinstance(eligible, list):
                    # A named local owner is the default suitable worker.
                    # Coordinator-owned dispatch work can use any available
                    # worker unless an explicit assignee narrows it.
                    eligible = [owner] if owner != '/root' else available_ids
                suitable = {canonical(value) for value in eligible if isinstance(value, str)}
                if suitable.intersection(available_ids):
                    dispatchable.append(ident)
        ready.sort()
        source_id = hashlib.sha256(json.dumps([agents['observedAt'], [(a.get('id'), a.get('status')) for a in rows]], sort_keys=True).encode()).hexdigest()
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        fresh = False
    violated = fresh and bool(dispatchable)
    with transaction(db):
        row = db.execute("SELECT value FROM enforcement_state WHERE key='continuity'").fetchone()
        prior = json.loads(row['value']) if row else {}
        if (fresh and prior.get('run') == run_id and prior.get('observed') is not None
            and observed < prior['observed']):
            fresh, violated = False, False
        score_before = db.execute('SELECT COALESCE(sum(seconds),0) FROM enforcement_penalties').fetchone()[0]
        continuity = (fresh and prior.get('run') == run_id and prior.get('fresh') is True
                      and prior.get('violated') is True and violated
                      and observed is not None and prior.get('observed') is not None
                      and 0 < observed - prior['observed'] <= 12
                      and 0 <= wall - prior.get('processed', 0) <= 12)
        if fresh and source_id:
            inserted = db.execute('INSERT OR IGNORE INTO enforcement_observations VALUES(?,?,?)',
                                  (source_id, observed, int(violated))).rowcount == 1
        else:
            inserted = False
        carry = prior.get('carry', 0) if prior.get('run') == run_id and violated else 0
        if inserted and continuity:
            elapsed = observed - prior['observed'] + carry
            seconds = int(elapsed)
            carry = elapsed - seconds
            if seconds:
                db.execute('INSERT OR IGNORE INTO enforcement_penalties VALUES(?,?,?)', (source_id, seconds, now()))
        elif inserted or not fresh or prior.get('run') != run_id:
            carry = 0
        # Do not move the time anchor on duplicate snapshots. Doing so would
        # repeatedly charge or reset the fractional-second carry.
        changed = prior.get('violated') != violated
        if inserted or not fresh or prior.get('run') != run_id or changed:
            new_run = prior.get('run') != run_id
            prior = {'run': run_id, 'fresh': fresh, 'violated': violated,
                     'observed': max(observed, wall) if fresh and (new_run or changed) else observed if fresh else None,
                     'processed': wall, 'carry': carry}
        episode_row = db.execute("SELECT value FROM enforcement_state WHERE key='episode'").fetchone()
        episode = json.loads(episode_row['value']) if episode_row else None
        new_wake = None
        if violated and episode is None:
            episode = {'id': str(uuid.uuid4()), 'startedAt': now(), 'taskIds': dispatchable}
            new_wake = episode
        elif fresh and not violated:
            episode = None
        for key, value in [('continuity', prior), ('episode', episode)]:
            db.execute('INSERT OR REPLACE INTO enforcement_state VALUES(?,?)', (key, json.dumps(value)))
        total = db.execute('SELECT COALESCE(sum(seconds),0) FROM enforcement_penalties').fetchone()[0]
    if episode and not db.execute('SELECT 1 FROM inbox WHERE dedupe_key=?', ('enforcement:' + episode['id'],)).fetchone():
        # A separate durable inbox row is the single wake for this episode.
        # Subsequent ticks, failures and restarts do not blindly enqueue again.
        add(db, json.dumps({'kind': 'ready_work_unassigned', 'taskIds': episode['taskIds']}),
            'enforcement:' + episode['id'])
    wake = None
    if episode:
        wake_row = db.execute('SELECT id,state,outcome FROM inbox WHERE dedupe_key=?',
                              ('enforcement:' + episode['id'],)).fetchone()
        wake = dict(wake_row) if wake_row else {'state': 'pending'}
    snapshot = {'schemaVersion': 1, 'rule': 'ready-work-must-have-active-assignment',
                'observedAt': datetime.fromtimestamp(wall, timezone.utc).isoformat().replace('+00:00', 'Z'),
                'sourceObservedAt': datetime.fromtimestamp(observed, timezone.utc).isoformat().replace('+00:00', 'Z') if observed is not None else None,
                'sourceFresh': fresh, 'state': 'violation' if violated else 'satisfied' if fresh else 'unknown',
                'agentsRunning': running if fresh else None, 'readyTaskIds': ready,
                'unassignedReadyTaskIds': dispatchable, 'assignedReadyTaskIds': assigned,
                'availableAgentIds': available_ids if fresh else [],
                'score': -total, 'penalizedSeconds': total, 'penaltyThisObservation': -(total - score_before),
                'penaltyRatePerSecond': 1, 'wake': wake,
                'accounting': 'Only fresh observed intervals with ready unassigned work and a suitable available worker; no inferred downtime or stale-state charges.'}
    if output:
        output = Path(output)
        temporary = output.with_suffix('.tmp')
        with temporary.open('w') as handle:
            json.dump(snapshot, handle, indent=2)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, output)
    return snapshot


def dispatch_once(db, db_path, thread, codex, timeout=30, enforcement_only=False):
    """One attempt per batch; any ambiguous failure requires explicit reconciliation."""
    with transaction(db):
        clause = " AND dedupe_key LIKE 'enforcement:%'" if enforcement_only else " AND dedupe_key NOT LIKE 'enforcement:%'"
        rows = db.execute("SELECT id,dedupe_key,body FROM inbox WHERE state='pending'" + clause + " ORDER BY created_at,id LIMIT 10").fetchall()
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
    for row in rows:
        if row['dedupe_key'].startswith('enforcement:'):
            try:
                task_ids = json.loads(row['body'])['taskIds']
                task_ids = [ident for ident in task_ids if isinstance(ident, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,100}', ident)]
                message += ' Assign ready authorized task IDs: ' + ', '.join(task_ids) + '.'
            except (ValueError, KeyError, TypeError):
                pass
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
        db.execute("UPDATE inbox SET state='uncertain',outcome='interrupted_delivery_requires_reconciliation',updated_at=? WHERE state='sending' AND dedupe_key NOT LIKE 'enforcement:%'", (now(),))
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
    label = getattr(args, 'label', LABEL)
    script = getattr(args, 'script', Path(__file__).resolve())
    log_stem = getattr(args, 'log_stem', 'daemon')
    target = Path.home() / 'Library' / 'LaunchAgents' / (label + '.plist')
    target.parent.mkdir(parents=True, exist_ok=True)
    program = [sys.executable, str(script), '--db', str(args.db),
               'daemon', '--thread', args.thread, '--codex', str(executable)]
    spec = {'Label': label, 'ProgramArguments': program, 'WorkingDirectory': str(REPO),
            'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 10,
            'Umask': 0o077, 'StandardOutPath': str(runtime / (log_stem + '.log')),
            'StandardErrorPath': str(runtime / (log_stem + '-error.log')),
            'EnvironmentVariables': {'PATH': f'{executable.parent}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'}}
    with target.open('wb') as f:
        plistlib.dump(spec, f)
    os.chmod(target, 0o600)
    domain = f'gui/{os.getuid()}'
    # Replacement is explicit; bootstrap errors stay visible to the caller.
    subprocess.run(['launchctl', 'bootout', f'{domain}/{label}'],
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
    return {'label': label, 'plist': str(target), 'thread': args.thread}


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, default=DEFAULT_DB)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('add', help='read request from stdin or private file; output metadata only')
    p.add_argument('--text-file', type=Path)
    p.add_argument('--dedupe-key', help='use source message ID; content hash is fallback')
    p.add_argument('--priority', help='explicit user priority only; preserve exact label')
    p.add_argument('--assignee', help='explicit user assignee only; do not infer')
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
            ident, created = add(db, body, args.dedupe_key, args.priority, args.assignee)
            print(json.dumps({'id': ident, 'created': created}))
        elif args.command == 'list':
            print(json.dumps(metadata(db, args.all), indent=2))
        elif args.command == 'read':
            row = db.execute('SELECT id,body,state,task_id,requested_priority,requested_assignee FROM inbox WHERE id=?', (args.id,)).fetchone()
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
