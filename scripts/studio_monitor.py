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

REPO = Path(__file__).resolve().parents[1]
ARTWORK = REPO
CODEX = Path.home() / '.codex'
ROOT_THREAD = os.environ.get('ARTWORK_MONITOR_ROOT_THREAD', '')
try:
    configured_team=json.loads((REPO/'.runtime/monitor/team.json').read_text())
    if isinstance(configured_team.get('rootThread'),str):ROOT_THREAD=configured_team['rootThread']
except (OSError,ValueError):pass
CACHE = REPO / '.runtime' / 'monitor' / 'lifecycle.json'
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
    result = {'ok': False, 'live': False, 'source': source, 'rootThread': ROOT_THREAD, 'observedAt': None, 'capacity': None, 'coordinator': 'unknown', 'agents': []}
    try:
        daemon = daemon_alive()
        if not daemon:
            return result
        daemon_started = float(daemon['processIdentity']['startSeconds'])
        with sqlite3.connect(f'file:{CODEX / "state_5.sqlite"}?mode=ro', uri=True, timeout=1) as db:
            db.row_factory = sqlite3.Row
            root = db.execute('SELECT id,rollout_path FROM threads WHERE id=? AND cwd=?', (ROOT_THREAD, str(REPO))).fetchone()
            children = db.execute("SELECT id,rollout_path,agent_path FROM threads WHERE cwd=? AND CASE WHEN json_valid(source) THEN json_extract(source,'$.subagent.thread_spawn.parent_thread_id') END=? ORDER BY created_at", (str(REPO), ROOT_THREAD)).fetchall()
        if not root:
            return result
        try:
            saved = json.loads(CACHE.read_text())
        except Exception:
            saved = {}
        try:
            assignments = json.loads((CACHE.parent / 'assignments.json').read_text())
        except Exception:
            assignments = {}
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
                result['coordinatorStartedAt'] = state.get('lastTransitionAt') if state['status'] == 'running' else None
                result['coordinatorTask'] = assignments.get('/root', {}).get('task', 'Coordinate current work')
                result['coordinatorCurrentTaskId'] = assignments.get('/root', {}).get('taskId')
                result['coordinatorWorkspace'] = assignments.get('/root', {}).get('workspace', 'production')
            else:
                # Publish only team paths, states and event timestamps. No task text.
                path = row['agent_path']
                if not isinstance(path, str) or not path.startswith('/root/') or len(path) > 100:
                    path = 'Studio worker'
                output.append({'id': path, 'workspace': assignments.get(path, {}).get('workspace', 'production'), 'task': assignments.get(path, {}).get('task', 'Studio team worker'), 'name': assignments.get(path, {}).get('name'), 'currentTaskId': assignments.get(path, {}).get('taskId'), 'startedAt': state.get('lastTransitionAt') if state['status'] == 'running' else None, 'status': state['status'], 'lastTransitionAt': state.get('lastTransitionAt'), 'lastEventAt': state.get('lastEventAt')})
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode='w', dir=CACHE.parent, delete=False) as cache_file:
            json.dump(current, cache_file)
            temporary = Path(cache_file.name)
        temporary.chmod(0o600)
        temporary.replace(CACHE)
        result.update(ok=True, live=True, observedAt=now(), capacity=len(output), agents=output)
    except Exception:
        pass
    return result


def generation():
    result = {'ok': False, 'observedAt': None, 'source': 'Private resident GPU worker health over SSH', 'workers': []}
    code = """import json,datetime,subprocess
from pathlib import Path
from urllib.request import urlopen
workers=[]
for port,profile,gpu in [(18761,'flux1-dev',0),(18763,'flux1-dev',1),(18762,'flux2-dev-nf4',1)]:
 try:
  with urlopen('http://127.0.0.1:'+str(port)+'/health',timeout=2) as response:data=json.load(response)
 except Exception:data={'profile':profile,'phase':'unavailable','running':0,'current':None,'paused':True,'queued':None}
 workers.append({**{key:data.get(key) for key in ['profile','phase','running','current','paused','queued']},'port':port,'gpuIndex':gpu})
observed=datetime.datetime.now(datetime.timezone.utc).isoformat()
gpus=[]
try:
 raw=subprocess.check_output(['nvidia-smi','--query-gpu=index,name,utilization.gpu,memory.used,memory.total,power.draw,power.limit,temperature.gpu','--format=csv,noheader,nounits'],text=True,timeout=3)
 for line in raw.strip().splitlines():
  values=[v.strip() for v in line.split(',')]
  gpu={'index':int(values[0]),'name':values[1],'observedAt':observed}
  for key,value in zip(['utilization_percent','memory_used_mb','memory_total_mb','power_watts','power_limit_watts','temperature_c'],values[2:]):
   try:gpu[key]=float(value)
   except ValueError:gpu[key]=None
  gpus.append(gpu)
except Exception:pass
archive={'ok':False,'observedAt':None,'status':'unknown'}
try:
 archive=json.loads(Path('/workspace/artwork/r2/status.json').read_text())
 archive['ok']=True
 process=subprocess.run(['supervisorctl','status','artwork-r2'],text=True,capture_output=True,timeout=2)
 archive['alive']=process.returncode==0 and 'RUNNING' in process.stdout
 archive['observedAt']=datetime.datetime.fromtimestamp(archive.get('heartbeatAt') or archive.get('sweptAt') or 0,datetime.timezone.utc).isoformat()
except Exception:pass
items=[]
judge_ready=None
try:
 with urlopen('http://127.0.0.1:8002/health',timeout=0.5) as response:judge_healthy=response.status==200
 with urlopen('http://127.0.0.1:8002/v1/models',timeout=0.5) as response:judge_models=json.load(response)
 if judge_healthy and any(model.get('id')=='pixtral-critic' for model in judge_models.get('data',[])):judge_ready=True
except Exception:pass
for filename,kind in [('/workspace/artwork/models/manifest.json','generation'),('/workspace/artwork/judges/download-receipt.json','judge')]:
 try:
  receipt=json.loads(Path(filename).read_text())
  for ident,entry in receipt.get('models',{}).items():
   target=Path(entry['path'])
   verified=target.is_dir() and (kind=='generation' and (target/'.download-complete.json').is_file() or kind=='judge' and receipt.get('complete') is True)
   lane=0 if ident=='flux1' else 1 if ident.startswith('flux2') else None
   worker=next((w for w in workers if w['profile']==('flux1-dev' if ident=='flux1' else 'flux2-dev-nf4')), {}) if lane is not None else {}
   loaded=worker.get('phase')=='ready' if worker.get('phase') else None
   phase=worker.get('phase')
   if ident=='pixtral' and judge_ready is True:loaded,phase=True,'ready'
   precision={'flux1':'BF16','flux2':'BF16','flux2-nf4':'NF4 text encoder','pixtral':'W4A16','dinov2':'BF16'}.get(ident)
   items.append({'id':ident,'name':{'flux1':'FLUX.1 DEV','flux2':'FLUX.2 DEV','flux2-nf4':'FLUX.2 text encoder','pixtral':'Pixtral 12B','dinov2':'DINOv2 Giant'}.get(ident,ident),'repo':entry.get('repo'),'revision':entry.get('revision'),'precision':precision,'bytes':entry.get('bytes'),'downloaded':verified,'loaded':loaded,'phase':phase,'gpuIndex':lane,'problem':None})
 except Exception:pass
print(json.dumps({'workers':workers,'gpus':gpus,'models':{'observedAt':observed,'items':items},'archive':archive,'observedAt':observed}))
"""
    try:
        host = os.environ.get('ARTWORK_SSH_HOST', '')
        port = os.environ.get('ARTWORK_SSH_PORT', '22')
        command = ['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=3', '-p', port, host, 'python3 -']
        process = subprocess.run(command, input=code, text=True, capture_output=True, timeout=7, check=True)
        data = json.loads(process.stdout)
        if len(data['workers']) != 3:
            return result
        result.update(ok=True, workers=data['workers'], gpus=data.get('gpus',[]), models=data.get('models'), archive=data.get('archive'), observedAt=data['observedAt'])
    except Exception:
        pass
    return result


def tasks():
    result = {'ok': False, 'observedAt': None, 'source': 'Persistent project task record; claim leases when available', 'working': [], 'claims': []}
    try:
        record = json.loads((REPO / 'tasks.json').read_text())
        result['working'] = [{'id': row['id'], 'title': row['title'], 'owner': row.get('owner')} for row in record['tasks'] if row.get('status') == 'working']
        claims_path = REPO / '.tracker' / 'runtime' / 'claims.json'
        claims = json.loads(claims_path.read_text()).get('claims', {}) if claims_path.exists() else {}
        for ident, claim in claims.items():
            beat = claim.get('beat') or claim.get('at')
            age = time.time() - datetime.datetime.fromisoformat(beat.replace('Z', '+00:00')).timestamp()
            if 0 <= age <= 2700:
                result['claims'].append({'id': ident, 'active': True, 'beat': beat})
        result.update(ok=True, observedAt=now(), recordUpdatedAt=record.get('updatedAt'))
    except Exception:
        pass
    return result


def performance_daemon():
    result = {'ok': False, 'alive': False, 'state': 'unknown', 'observedAt': None}
    try:
        path = REPO / '.runtime/performance/status.json'
        if path.is_symlink() or path.stat().st_size > 256 * 1024:
            return result
        state = json.loads(path.read_text())
        process = subprocess.run(['launchctl', 'print', f'gui/{os.getuid()}/vision.influx.artwork.performance'], capture_output=True, text=True, timeout=2)
        pid = state.get('pid')
        alive = isinstance(pid, int) and process.returncode == 0 and 'state = running' in process.stdout and any(line.strip() == f'pid = {pid}' for line in process.stdout.splitlines())
        observed = datetime.datetime.fromisoformat(state['heartbeatAt'].replace('Z', '+00:00')).timestamp()
        fresh = -1 <= time.time() - observed <= 20
        # Publish bounded measurements and fixed event codes only. Inbox IDs,
        # coordinator details, runtime paths and raw process logs stay private.
        result.update({key: state.get(key) for key in ['pid', 'startedAt', 'heartbeatAt', 'lastActivityAt', 'activityCount', 'agentState', 'mandateActive', 'collectorPid', 'collectorRestarts']})
        result.update(ok=alive and fresh, alive=alive, observedAt=state['heartbeatAt'], state=state.get('state') if alive and fresh else 'unknown')
        result['events'] = [{key: event.get(key) for key in ('at', 'event')} for event in state.get('events', [])[-10:]]
        result['wakeState'] = state.get('wakeState')
        result['wakeQueued'] = state.get('wakeState') in ('pending', 'sending', 'notified')
    except Exception:
        pass
    return result


def daemons(performance=None):
    descriptions = [
        ('studio', 'Studio and live monitor', 'Serves the app, collects current observations and pushes shared WebSocket updates.', 'giving.kinship.artwork-comparison'),
        ('ingress', 'Public connection', 'Keeps the encrypted reverse tunnel to the HTTPS gateway connected.', 'giving.kinship.artwork-ingress'),
        ('refiller', 'Generation queue', 'Keeps a bounded queue of ordinary scene jobs available to both model lanes.', 'giving.kinship.artwork-refill'),
        ('inbox', 'Task inbox', 'Durably stores incoming requests and notifies the coordinator for Task Keeper.', 'vision.influx.artwork.task-inbox'),
        ('enforcer', 'Enforcer', 'Checks ready work against observed assignments, records penalties and escalates dispatch gaps.', 'vision.influx.artwork.enforcer'),
        ('performance', 'Performance', 'Watches the Performance engineer lifecycle and asks the coordinator to reactivate the engineer after a newly observed idle episode.', 'vision.influx.artwork.performance'),
        ('production0', 'Production · GPU 0', 'Continuously generates paired production and precision prompts on the first GPU.', 'vision.influx.imagen.parity'),
        ('production1', 'Production · GPU 1', 'Continuously generates disjoint paired scenes on the second GPU.', 'vision.influx.imagen.parity.gpu1'),
        ('naming', 'Image naming', 'Names new arrivals automatically without image viewing or model calls.', 'vision.influx.imagen.naming'),
    ]
    items = []
    for ident, name, description, label in descriptions:
        process = subprocess.run(['launchctl', 'print', f'gui/{os.getuid()}/{label}'], capture_output=True, text=True, timeout=2)
        pid = None
        for line in process.stdout.splitlines():
            if line.strip().startswith('pid = '):
                try: pid = int(line.split('=',1)[1])
                except ValueError: pass
        alive = process.returncode == 0 and pid is not None and 'state = running' in process.stdout
        item = {'id':ident, 'name':name, 'description':description, 'alive':alive, 'pid':pid, 'errorCode':None}
        if ident in ('production0','production1','naming'):
            try:
                relative={'production0':'.runtime/research/production-parity-daemon/state.json','production1':'.runtime/research/production-parity-daemon-gpu1/state.json','naming':'.runtime/image-names/daemon-status.json'}[ident]
                state=json.loads((REPO/relative).read_text());heartbeat=state.get('heartbeatAt')
                stamp=heartbeat if isinstance(heartbeat,(float,int)) else datetime.datetime.fromisoformat(heartbeat.replace('Z','+00:00')).timestamp()
                fresh=-2<=time.time()-stamp<=12
                item.update(alive=alive and fresh,observedAt=datetime.datetime.fromtimestamp(stamp,datetime.timezone.utc).isoformat(),heartbeatAt=heartbeat,lastActivityAt=state.get('updatedAt',heartbeat),activityCount=state.get('completedPairs'),activityLabel='Completed study pairs' if ident!='naming' else 'Automatic naming',stage=state.get('stage',state.get('status')),enabled=state.get('enabled'),sceneId=state.get('sceneId'))
            except Exception:item['alive']=False
        elif ident == 'studio':
            try:
                state=json.loads((REPO/'.runtime/monitor/status.json').read_text())
                item['lastActivityAt']=state.get('observedAt')
                item['activityLabel']='Latest monitor observation'
            except Exception:pass
        elif ident == 'performance':
            state = performance or performance_daemon()
            item.update(observedAt=state.get('observedAt'), staleAfterSeconds=20,
                        heartbeatAt=state.get('heartbeatAt'), lastActivityAt=state.get('lastActivityAt'),
                        activityCount=state.get('activityCount'), activityLabel='Engineer lifecycle observations',
                        activityState=state.get('state', 'unknown'), agentState=state.get('agentState', 'unknown'),
                        wakeQueued=state.get('wakeQueued', False))
        elif ident == 'enforcer':
            try:
                state = json.loads((REPO / '.runtime/task-inbox/enforcement.json').read_text())
                item['lastActivityAt'] = state.get('observedAt')
                item['activityLabel'] = 'Latest assignment enforcement check'
            except Exception: pass
        elif ident == 'inbox':
            try:
                path=REPO/'.runtime/task-inbox/inbox.sqlite3'
                with sqlite3.connect(f'file:{path}?mode=ro',uri=True,timeout=1) as db:
                    row=db.execute("SELECT value FROM daemon_state WHERE key='heartbeat'").fetchone()
                    item['heartbeatAt']=row[0] if row else None
                    item['lastActivityAt']=db.execute('SELECT max(updated_at) FROM inbox').fetchone()[0]
                    item['activityCount']=db.execute("SELECT count(*) FROM inbox WHERE state='acked'").fetchone()[0]
                    item['activityLabel']='Requests recorded'
                    uncertain=db.execute("SELECT outcome FROM inbox WHERE state='uncertain' ORDER BY updated_at DESC LIMIT 1").fetchone()
                    item['errorCode']=uncertain[0] if uncertain else None
            except Exception:pass
        elif ident == 'refiller':
            try:
                path=REPO.parent/'kinship-of-cancer/tools/artwork/.state/generation-refill/status.json'
                state=json.loads(path.read_text());item['lastActivityAt']=state.get('checkedAt')
                item['activityLabel']='Last bounded queue pass'
            except Exception:pass
        items.append(item)
    return {'ok':True,'observedAt':now(),'staleAfterSeconds':12,'items':items}


def enforcement():
    try:
        state = json.loads((REPO / '.runtime/task-inbox/enforcement.json').read_text())
        return {**state, 'rule': 'dispatch', 'state': {'satisfied': 'ok', 'violation': 'violation'}.get(state.get('state'), 'unknown'), 'runningAgents': state.get('agentsRunning')}
    except Exception:
        return {'rule': 'dispatch', 'state': 'unknown', 'observedAt': None}


if __name__ == '__main__':
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=3) as pool:
        generation_result = pool.submit(generation)
        agents_result = pool.submit(agents)
        tasks_result = pool.submit(tasks)
        agent_data = agents_result.result()
        task_data = tasks_result.result()
        try:
            assignments = json.loads((CACHE.parent / 'assignments.json').read_text())
        except Exception:
            assignments = {}
        active_ids = {row.get('currentTaskId') for row in agent_data.get('agents', []) if row.get('status') == 'running'}
        if agent_data.get('coordinator') == 'running':
            active_ids.add(assignments.get('/root', {}).get('taskId'))
        task_data['working'] = [row for row in task_data.get('working', []) if row['id'] in active_ids]
        task_data['source'] = 'Current-session running agents matched to recorded active task assignments'
        performance = performance_daemon()
        result = {'ok': True, 'generation': generation_result.result(), 'agents': agent_data, 'tasks': task_data, 'daemons': daemons(performance), 'performanceDaemon': performance, 'enforcement': enforcement(), 'observedAt': now()}
    result['models'] = result['generation'].get('models', {'observedAt': None, 'items': []})
    result['archive'] = result['generation'].get('archive', {'ok': False, 'observedAt': None, 'status': 'unknown'})
    archive = result['archive']
    result['daemons']['items'].append({'id': 'archive', 'name': 'R2 archive reconciler',
        'description': 'Verifies completed images and receipts against R2, retries missing uploads and repairs index gaps.',
        'alive': archive.get('alive'), 'observedAt': result['generation'].get('observedAt'),
        'lastActivityAt': archive.get('observedAt'), 'heartbeatAt': archive.get('observedAt'),
        'activityCount': archive.get('confirmedJobs'), 'activityLabel': 'Verified archived jobs',
        'pendingJobs': archive.get('pendingJobs'), 'verificationDueJobs': archive.get('verificationDueJobs'),
        'oldestPendingSeconds': archive.get('oldestPendingSeconds'), 'archiveStatus': archive.get('status'),
        'errorCode': 'archive_backlog' if archive.get('pendingJobs', 0) else None})
    print(json.dumps(result))
