#!/usr/bin/env python3
"""Collect public studio state from fixed private sources; never emit source content."""
import datetime
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import time
import tempfile

ARTWORK = Path(__file__).resolve().parents[1]
REPO = ARTWORK.parents[1]
CODEX = Path.home() / '.codex'
ROOT_THREAD = os.environ.get('ARTWORK_MONITOR_ROOT_THREAD', '')
CACHE = ARTWORK / '.state' / 'studio-monitor' / 'lifecycle.json'
MAX_READ = 8 * 1024 * 1024


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')


def daemon_alive():
    try:
        metadata = json.loads((CODEX / 'app-server-daemon' / 'daemon.pid').read_text())
        pid = int(metadata['pid'])
        if pid <= 1:
            return False
        result = subprocess.run(['ps', '-p', str(pid), '-o', 'lstart=', '-o', 'comm='], capture_output=True, text=True, timeout=2)
        valid = (result.returncode == 0 and 'codex' in result.stdout.lower()
                 and ' '.join(result.stdout.split()[:5]) == ' '.join(metadata['processStartTime'].split()))
        return metadata if valid else None
    except Exception:
        return False


def lifecycle(file, prior):
    # Cache only offsets and lifecycle metadata, never response items or text.
    stat = file.stat()
    identity = [stat.st_dev, stat.st_ino]
    valid = prior.get('identity') == identity and prior.get('offset', 0) <= stat.st_size
    record = dict(prior) if valid else {'status': 'unknown', 'turn': None, 'lastTransitionAt': None, 'lastEventAt': None}
    offset = record.get('offset', 0) if valid else 0
    skipped = stat.st_size - offset > MAX_READ
    if skipped:
        offset = stat.st_size - MAX_READ
        record.update(status='unknown', turn=None, lastTransitionAt=None)
    with file.open('rb') as source:
        source.seek(offset)
        if skipped:
            source.readline()
        data = source.read(MAX_READ)
        end = data.rfind(b'\n')
        if end < 0:
            return record
        record['offset'] = source.tell() - len(data) + end + 1
    record['identity'] = identity
    for line in data[:end].splitlines():
        try:
            event = json.loads(line)
        except Exception:
            continue
        if event.get('type') != 'event_msg':
            continue
        payload = event.get('payload', {})
        kind, turn = payload.get('type'), payload.get('turn_id')
        timestamp = event.get('timestamp')
        record['lastEventAt'] = timestamp
        if kind == 'task_started':
            record.update(status='running', turn=turn, lastTransitionAt=timestamp)
        elif kind == 'task_complete' and (record.get('turn') in (None, turn)):
            record.update(status='done', turn=turn, lastTransitionAt=timestamp)
        elif kind in ('turn_aborted', 'task_aborted', 'task_interrupted', 'error') and (record.get('turn') in (None, turn)):
            record.update(status='unknown' if kind == 'error' else 'interrupted', turn=turn, lastTransitionAt=timestamp)
    return record


def agents():
    source = 'Own-session task lifecycle events, scoped to this studio team'
    result = {'ok': False, 'live': False, 'source': source, 'observedAt': None, 'capacity': 3, 'coordinator': 'unknown', 'agents': []}
    try:
        daemon = daemon_alive()
        if not daemon:
            return result
        daemon_started = float(daemon['processIdentity']['startSeconds'])
        with sqlite3.connect(f'file:{CODEX / "state_5.sqlite"}?mode=ro', uri=True, timeout=1) as db:
            db.row_factory = sqlite3.Row
            root = db.execute('SELECT id,rollout_path FROM threads WHERE id=? AND cwd=?', (ROOT_THREAD, str(REPO))).fetchone()
            children = db.execute("SELECT id,rollout_path,agent_path FROM threads WHERE cwd=? AND CASE WHEN json_valid(source) THEN json_extract(source,'$.subagent.thread_spawn.parent_thread_id') END=? ORDER BY created_at", (str(REPO), ROOT_THREAD)).fetchall()
        if not root or len(children) > 3:
            return result
        try:
            saved = json.loads(CACHE.read_text())
        except Exception:
            saved = {}
        output = []
        current = {}
        for row in [root, *children]:
            file = Path(row['rollout_path'])
            if not file.resolve().is_relative_to((CODEX / 'sessions').resolve()) or file.is_symlink():
                raise ValueError('Untrusted source')
            state = lifecycle(file, saved.get(row['id'], {}))
            if state['status'] == 'running':
                transition = state.get('lastTransitionAt')
                started = datetime.datetime.fromisoformat(transition.replace('Z', '+00:00')).timestamp() if transition else 0
                if started < daemon_started - 1:
                    state['status'] = 'unknown'
            current[row['id']] = state
            if row['id'] == ROOT_THREAD:
                result['coordinator'] = 'running' if state['status'] == 'running' else 'idle' if state['status'] == 'done' else 'unknown'
                result['coordinatorLastTransitionAt'] = state.get('lastTransitionAt')
            else:
                # Publish only team paths, states and event timestamps. No task text.
                path = row['agent_path']
                if not isinstance(path, str) or not path.startswith('/root/') or len(path) > 100:
                    path = 'Studio worker'
                output.append({'id': path, 'task': 'Studio team worker', 'status': state['status'], 'lastTransitionAt': state.get('lastTransitionAt'), 'lastEventAt': state.get('lastEventAt')})
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode='w', dir=CACHE.parent, delete=False) as cache_file:
            json.dump(current, cache_file)
            temporary = Path(cache_file.name)
        temporary.chmod(0o600)
        temporary.replace(CACHE)
        result.update(ok=True, live=True, observedAt=now(), agents=output)
    except Exception:
        pass
    return result


def generation():
    result = {'ok': False, 'observedAt': None, 'source': 'Private resident GPU worker health over SSH', 'workers': []}
    code = """import json,datetime
from urllib.request import urlopen
workers=[]
for port in [18761,18762]:
 with urlopen('http://127.0.0.1:'+str(port)+'/health',timeout=2) as response:
  data=json.load(response)
 workers.append({key:data.get(key) for key in ['profile','phase','running','current','paused','queued']})
print(json.dumps({'workers':workers,'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}))
"""
    try:
        host = os.environ.get('ARTWORK_SSH_HOST', 'root@81.183.231.113')
        port = os.environ.get('ARTWORK_SSH_PORT', '33645')
        command = ['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=3', '-p', port, host, 'python3 -']
        process = subprocess.run(command, input=code, text=True, capture_output=True, timeout=7, check=True)
        data = json.loads(process.stdout)
        if len(data['workers']) != 2:
            return result
        result.update(ok=True, workers=data['workers'], observedAt=data['observedAt'])
    except Exception:
        pass
    return result


def tasks():
    result = {'ok': False, 'observedAt': None, 'source': 'Persistent task record and live tracker claim leases', 'working': [], 'claims': []}
    try:
        record = json.loads((ARTWORK / 'comparison' / 'tasks.json').read_text())
        result['working'] = [{'id': row['id'], 'title': row['title']} for row in record['tasks'] if row.get('status') == 'working']
        claims = json.loads((REPO / '.tracker' / 'runtime' / 'claims.json').read_text()).get('claims', {})
        for ident, claim in claims.items():
            beat = claim.get('beat') or claim.get('at')
            age = time.time() - datetime.datetime.fromisoformat(beat.replace('Z', '+00:00')).timestamp()
            if 0 <= age <= 2700:
                result['claims'].append({'id': ident, 'active': True, 'beat': beat})
        result.update(ok=True, observedAt=now(), recordUpdatedAt=record.get('updatedAt'))
    except Exception:
        pass
    return result


def services():
    result = {}
    for name, label in [('refiller', 'giving.kinship.artwork-refill'), ('studio', 'giving.kinship.artwork-comparison'), ('ingress', 'giving.kinship.artwork-ingress')]:
        try:
            process = subprocess.run(['launchctl', 'print', f'gui/{os.getuid()}/{label}'], capture_output=True, text=True, timeout=2)
            result[name] = 'running' if process.returncode == 0 and 'state = running' in process.stdout else 'unknown'
        except Exception:
            result[name] = 'unknown'
    return result


if __name__ == '__main__':
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=3) as pool:
        generation_result = pool.submit(generation)
        agents_result = pool.submit(agents)
        tasks_result = pool.submit(tasks)
        result = {'ok': True, 'generation': generation_result.result(), 'agents': agents_result.result(), 'tasks': tasks_result.result(), 'services': services(), 'observedAt': now()}
    print(json.dumps(result))
