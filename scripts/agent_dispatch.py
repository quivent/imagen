#!/usr/bin/env python3
"""Dispatch explicit ready work to observed available existing child sessions.

SQLite claims precede every queue attempt. Queued and uncertain deliveries reserve
both task and worker until observed lifecycle evidence or explicit reconciliation.
The runtime prohibits direct child app-server input (-32600); only that explicit
rejection permits a durable exact-action request to the root tool adapter. The
adapter has no assignment selection, spawning or approval discretion.
"""
from datetime import datetime
from contextlib import closing
import fcntl
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import time
import uuid

from task_inbox import REPO, now, transaction

AVAILABLE = {'done', 'available', 'idle'}
ACTIVE = {'running', 'working'}


def initialize(db):
    db.executescript('''
      CREATE TABLE IF NOT EXISTS agent_dispatch (
        id TEXT PRIMARY KEY, root_thread TEXT NOT NULL, task_id TEXT NOT NULL,
        revision TEXT NOT NULL, agent_path TEXT NOT NULL, child_thread TEXT NOT NULL,
        state TEXT NOT NULL, claimed_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        outcome TEXT, UNIQUE(root_thread,task_id,revision)
      );
    ''')
    columns = {row['name'] for row in db.execute('PRAGMA table_info(agent_dispatch)')}
    if 'message' not in columns:
        db.execute('ALTER TABLE agent_dispatch ADD COLUMN message TEXT')
    # A crash after claiming might follow successful acceptance. Never replay.
    db.execute("UPDATE agent_dispatch SET state='uncertain',outcome='interrupted_requires_reconciliation',updated_at=? WHERE state IN ('sending','adapter_sending')", (now(),))


def canonical(value):
    if not isinstance(value, str) or not value.strip():
        return None
    value = value.strip()
    if value in ('root', '/root', 'coordinator'):
        return None
    value = value if value.startswith('/root/') else '/root/' + value
    return value if re.fullmatch(r'/root/[A-Za-z0-9_/-]{1,100}', value) else None


def paused(value):
    return (value.get('paused') is True or value.get('dispatchPaused') is True
            or value.get('mode') in ('paused', 'pause', 'stopped'))


def read_sources(monitor_path, tasks_path, team_path, state_path, wall):
    team = json.loads(Path(team_path).read_text())
    root = str(uuid.UUID(team['rootThread']))
    ledger = json.loads(Path(tasks_path).read_text())
    agents = json.loads(Path(monitor_path).read_text())['agents']
    observed = datetime.fromisoformat(agents['observedAt'].replace('Z', '+00:00')).timestamp()
    if (paused(team) or paused(ledger) or paused(ledger.get('workMode', {}))
            or agents.get('rootThread') != root or agents.get('ok') is not True
            or agents.get('live') is not True or not -1 <= wall - observed <= 12):
        return root, [], [], {}
    rows = agents['agents']
    if not isinstance(rows, list):
        raise ValueError('invalid agents')
    with closing(sqlite3.connect(Path(state_path).resolve().as_uri() + '?mode=ro', uri=True, timeout=1)) as state:
        children = state.execute("""SELECT id,agent_path FROM threads WHERE cwd=? AND archived=0
          AND CASE WHEN json_valid(source) THEN json_extract(source,'$.subagent.thread_spawn.parent_thread_id') END=?""",
          (str(REPO), root)).fetchall()
    # Ambiguous duplicate paths are not safe dispatch targets.
    mapping = {}
    for child, path in children:
        mapping.setdefault(path, []).append(child)
    mapping = {path: ids[0] for path, ids in mapping.items() if len(ids) == 1 and canonical(path) == path}
    return root, ledger['tasks'], rows, mapping


def eligible(task):
    ready = task.get('readiness', {})
    return (task.get('status') in ('next', 'working') and task.get('archived') is not True
            and task.get('currentSession') is not False and task.get('dispatchable') is not False
            and not paused(task) and ready.get('ready') is True and ready.get('authorized') is True
            and ready.get('scope') == 'local' and ready.get('blocked') is False
            and isinstance(task.get('id'), str) and re.fullmatch(r'[A-Za-z0-9_-]{1,100}', task['id']))


def candidates(task):
    explicit = task.get('requestedAssignee')
    values = [explicit] if explicit else task.get('readiness', {}).get('eligibleAssignees')
    if not isinstance(values, list):
        values = [task.get('owner')]
    return [path for value in values if (path := canonical(value))]


def record_assignment(path, task, claim, state):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        assignments = json.loads(path.read_text()) if path.exists() else {}
        old = assignments.get(claim['agent_path'], {})
        assignments[claim['agent_path']] = {**old, 'taskId': task['id'], 'task': task.get('title', task['id']),
            'workspace': task.get('workspace', 'production'), 'dispatchId': claim['id'],
            'dispatchState': state, 'updatedAt': now()}
        temporary = path.with_name(path.name + '.dispatch.tmp')
        temporary.write_text(json.dumps(assignments, indent=2) + '\n')
        temporary.replace(path)


def dispatch_tick(db, monitor_path, tasks_path, team_path, codex,
                  state_path=Path.home() / '.codex/state_5.sqlite', assignments_path=None,
                  current_time=None, runner=subprocess.run):
    wall = time.time() if current_time is None else current_time
    root, tasks, rows, children = read_sources(monitor_path, tasks_path, team_path, state_path, wall)
    if not rows:
        return []
    by_path = {row.get('id'): row for row in rows}
    events = []
    with transaction(db):
        for claim in db.execute("SELECT * FROM agent_dispatch WHERE root_thread=? AND state IN ('queued','adapter_queued','running','uncertain')", (root,)).fetchall():
            row = by_path.get(claim['agent_path'], {})
            transition = row.get('lastTransitionAt')
            # Assignment labels alone are not lifecycle proof. Require a transition
            # strictly after durable claim, scoped to the same existing session.
            if (row.get('currentTaskId') != claim['task_id']
                    or children.get(claim['agent_path']) != claim['child_thread'] or not transition
                    or datetime.fromisoformat(transition.replace('Z', '+00:00')) <= datetime.fromisoformat(claim['claimed_at'].replace('Z', '+00:00'))):
                continue
            target = 'running' if row.get('status') in ACTIVE else 'completed' if row.get('status') == 'done' else None
            if target:
                db.execute('UPDATE agent_dispatch SET state=?,updated_at=?,outcome=? WHERE id=?',
                           (target, now(), 'observed_child_lifecycle', claim['id']))
        reservations = {row['agent_path'] for row in db.execute("SELECT agent_path FROM agent_dispatch WHERE root_thread=? AND state IN ('sending','queued','adapter_pending','adapter_sending','adapter_queued','running','uncertain')", (root,))}
    available = {path for path, row in by_path.items() if row.get('status') in AVAILABLE and path in children and path not in reservations}
    for task in tasks:
        if not eligible(task):
            continue
        target = next((path for path in candidates(task) if path in available), None)
        if not target:
            continue
        claim = {'id': str(uuid.uuid4()), 'agent_path': target, 'child_thread': children[target]}
        timestamp = now()
        with transaction(db):
            # Serialize concurrent dispatchers and prevent another task taking this worker.
            if db.execute("SELECT 1 FROM agent_dispatch WHERE root_thread=? AND agent_path=? AND state IN ('sending','queued','adapter_pending','adapter_sending','adapter_queued','running','uncertain')", (root, target)).fetchone():
                continue
            inserted = db.execute('INSERT OR IGNORE INTO agent_dispatch(id,root_thread,task_id,revision,agent_path,child_thread,state,claimed_at,updated_at,outcome) VALUES(?,?,?,?,?,?,?,?,?,?)',
                (claim['id'], root, task['id'], str(task.get('dispatchRevision', '1')), target,
                 claim['child_thread'], 'sending', timestamp, timestamp, 'claimed_before_queue')).rowcount
        if not inserted:
            continue
        available.discard(target)
        message = (f"Daemon assignment {task['id']} (dispatch {claim['id']}). "
                   f"Read the current task in {Path(tasks_path).resolve()} and execute its authorized scope. "
                   "Honor AGENTS.md, user pauses and continuous production. Do not view images or screenshots. "
                   "Record concrete outcome in the task ledger and report completion. "
                   "The persistent daemon owns subsequent assignment; do not spawn or assign agents.")
        db.execute('UPDATE agent_dispatch SET message=? WHERE id=?', (message, claim['id']))
        status, outcome = 'uncertain', 'queue_result_unknown_requires_reconciliation'
        try:
            result = runner([codex, 'queue', '--thread', claim['child_thread'], '--message', message],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=False)
            if result.returncode == 0:
                status, outcome = 'queued', 'queue_accepted_not_running'
            else:
                detail = result.stderr if isinstance(result.stderr, bytes) else str(result.stderr).encode()
                outcome = 'queue_nonzero_requires_reconciliation'
                if b'direct app-server input is not allowed for multi-agent v2 sub-agents' in detail:
                    status, outcome = 'adapter_pending', 'child_input_explicitly_rejected_requires_tool_adapter'
                for marker, category in ((b'no rollout found', 'thread_not_found'),
                                         (b'child', 'child_target_rejected'),
                                         (b'permission', 'permission_rejected'),
                                         (b'connect', 'transport_failed'),
                                         (b'root', 'root_session_required'),
                                         (b'subagent', 'subagent_target_rejected'),
                                         (b'agent', 'agent_target_rejected')):
                    if marker in detail.lower():
                        outcome += ':' + category
                        if category == 'thread_not_found' and status != 'adapter_pending':
                            status = 'rejected'
                        break
        except (OSError, subprocess.TimeoutExpired):
            pass
        with transaction(db):
            db.execute('UPDATE agent_dispatch SET state=?,updated_at=?,outcome=? WHERE id=?',
                       (status, now(), outcome, claim['id']))
        if assignments_path:
            record_assignment(assignments_path, task, claim, status)
        events.append({'dispatchId': claim['id'], 'taskId': task['id'], 'agent': target,
                       'childThread': claim['child_thread'], 'state': status, 'outcome': outcome})
    adapter_events = dispatch_adapter(db, root, codex, runner, {task['id'] for task in tasks if eligible(task)})
    if assignments_path:
        by_task = {task.get('id'): task for task in tasks}
        for event in adapter_events:
            task = by_task.get(event['taskId'])
            if task:
                record_assignment(assignments_path, task, {'id': event['dispatchId'], 'agent_path': event['agent']}, event['state'])
    events.extend(adapter_events)
    return events


def dispatch_adapter(db, root, codex, runner=subprocess.run, permitted_task_ids=None):
    """Mechanical root tool adapter; all assignment decisions are already durable."""
    events = []
    for row in db.execute("SELECT * FROM agent_dispatch WHERE root_thread=? AND state='adapter_pending'", (root,)).fetchall():
        if permitted_task_ids is not None and row['task_id'] not in permitted_task_ids:
            continue
        with transaction(db):
            changed = db.execute("UPDATE agent_dispatch SET state='adapter_sending',updated_at=? WHERE id=? AND state='adapter_pending'", (now(), row['id'])).rowcount
        if not changed:
            continue
        action = {'tool': 'collaboration.followup_task', 'target': row['agent_path'], 'message': row['message']}
        message = (f"Daemon dispatch {row['id']}: EXECUTION ADAPTER ONLY. The daemon has already selected "
                   f"task {row['task_id']} and existing child UUID {row['child_thread']}. "
                   "Direct app-server child input is explicitly prohibited by the runtime. "
                   "Execute this exact followup_task action immediately; do not choose, replace, defer, "
                   "seek approval, spawn, or assign any other agent. Queue acceptance is not running. "
                   "Report the tool outcome against the dispatch ID. Action: " + json.dumps(action))
        status, outcome = 'uncertain', 'adapter_delivery_unknown_requires_reconciliation'
        try:
            result = runner([codex, 'queue', '--thread', root, '--message', message],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=False)
            if result.returncode == 0:
                status, outcome = 'adapter_queued', 'exact_daemon_decision_queued_for_tool_execution_not_running'
        except (OSError, subprocess.TimeoutExpired):
            pass
        with transaction(db):
            db.execute('UPDATE agent_dispatch SET state=?,updated_at=?,outcome=? WHERE id=?',
                       (status, now(), outcome, row['id']))
        events.append({'dispatchId': row['id'], 'taskId': row['task_id'], 'agent': row['agent_path'],
                       'childThread': row['child_thread'], 'state': status, 'outcome': outcome})
    return events
