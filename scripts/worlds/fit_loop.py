"""Continue saved Method1 fitting without replacing prior experiments."""
import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import time
from fit_parameters import REPO, ROOT, digest, run
from pixels import components, literal_components, read_png, resize_area
from search_controls import DEFAULTS, batch, validate

RUNTIME = REPO/'.runtime/worlds'
STATE = RUNTIME/'fit-loop.json'
STOP = RUNTIME/'fit-loop.stop'
SETTINGS = RUNTIME/'fit-settings.json'
active = True


def shutdown(*_):
    global active
    active = False


def save(state):
    temporary = STATE.with_suffix('.tmp')
    temporary.write_text(json.dumps({**state, 'pid': os.getpid(), 'updatedAt': time.time()}, indent=2)+'\n')
    temporary.replace(STATE)


def settings():
    if not SETTINGS.exists():
        return dict(DEFAULTS), 'defaults'
    record = json.loads(SETTINGS.read_text())
    return validate({'objectiveVersion':1, **record['settings']}), record['revision']


def main():
    RUNTIME.mkdir(parents=True, exist_ok=True)
    with (RUNTIME/'fit-loop.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        signal.signal(signal.SIGTERM, shutdown)
        signal.signal(signal.SIGINT, shutdown)
        catalog=json.loads((REPO/'public/worlds/experiments.json').read_text())
        selected=json.loads((RUNTIME/'active-experiment.json').read_text()) if (RUNTIME/'active-experiment.json').exists() else {'id':'experiment-1','sourceFile':'method1/source.png','seed':'method1/run2/candidate.json'}
        study=next(item for item in catalog['experiments'] if item['id']==selected['id'])
        source_path=RUNTIME/selected['sourceFile']
        state = json.loads(STATE.read_text()) if STATE.exists() else {}
        if state.get('experimentId','experiment-1')!=study['id']:state={}
        seed = Path(state.get('seed', RUNTIME/selected['seed']))
        report = json.loads((seed.parent/'report.json').read_text())
        best512 = report['validation']['best512']['weighted_total']
        objective = report.get('objectiveVersion',1)
        cycle, plateau = state.get('cycle', 0), state.get('plateau', 0)
        try:
            while active and not STOP.exists():
                config, revision = settings()
                if config['paused']:
                    state.update(status='paused', revision=revision)
                    save(state)
                    time.sleep(1)
                    continue
                if shutil.disk_usage(RUNTIME).free < 5_000_000_000:
                    raise RuntimeError('Less than 5GB free; fitting paused with results preserved')
                if config['objectiveVersion'] != objective:
                    objective = config['objectiveVersion']
                    measure = literal_components if objective==2 else components
                    best512 = measure(resize_area(read_png(source_path),512), read_png(seed.parent/'best-512.png'))['weighted_total']
                    plateau = 0
                recipe = json.loads(seed.read_text())
                if recipe['shaderSha256'] != digest(ROOT/'scene.frag') or recipe['sourceSha256'] != digest(source_path):
                    raise RuntimeError('Saved seed no longer matches source/shader')
                output = RUNTIME/'method1'/(('run3-loop-' if study['number']==1 else f"exp{study['number']}-run3-loop-")+time.strftime('%Y%m%dT%H%M%S')+f'-{cycle:06d}')
                selected, pool_size, fraction = batch(recipe['parameters'], config, cycle, plateau)
                state = {'status': 'running', 'experimentId':study['id'], 'searchSize':study['searchSize'], 'sourceSha256':study['source']['sha256'], 'method': 1, 'cycle': cycle, 'seed': str(seed), 'run': str(output), 'best512': best512,
                         'objectiveVersion': objective, 'searchVersion': 2, 'startedAt': time.time(), 'revision': revision, 'settings': config,
                         'activeControls': len(selected), 'eligibleControls': pool_size, 'effectiveStepFraction': fraction, 'plateau': plateau}
                save(state)
                metadata = {'version': 2, 'settings': config, 'revision': revision, 'eligibleControls': pool_size,
                            'effectiveStepFraction': fraction, 'controls': [item[0] for item in selected]}
                result = run(source_path, output, seed, search_adjustments=selected, search_metadata=metadata, objective_version=objective,source_metadata=study['source'],experiment_id=study['id'],search_size=study['searchSize'])
                value = result['validation']['best512']['weighted_total']
                gain = max(0, best512-value)
                relative = gain/best512 if best512 else 0
                plateau = plateau+1 if relative < config['meaningfulGain'] else 0
                promoted = value < best512
                if promoted:
                    seed, best512 = output/'candidate.json', value
                cycle += 1
                state.update(status='waiting', cycle=cycle, seed=str(seed), best512=best512, promoted=promoted,
                             lastGain=gain, lastRelativeGain=relative, plateau=plateau, finishedAt=time.time())
                save(state)
                print(json.dumps(state), flush=True)
                for _ in range(config['intervalSeconds']):
                    if not active or STOP.exists() or settings()[1] != revision:
                        break
                    time.sleep(1)
        finally:
            save({**state, 'status': 'stopped', 'seed': str(seed), 'best512': best512})


if __name__ == '__main__':
    main()
