#!/usr/bin/env python3
"""Forced SSH command exposing only the two private artwork workers."""
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.request import Request, urlopen

ROOT = Path('/workspace/artwork/control')
PORTS = {'flux1-dev': 18761, 'flux2-dev-nf4': 18762}


def call(profile, route, value=None):
    raw = json.dumps(value).encode() if value is not None else None
    req = Request(f'http://127.0.0.1:{PORTS[profile]}{route}', data=raw,
                  headers={'Content-Type': 'application/json'})
    with urlopen(req, timeout=5) as response:
        return json.load(response)


def public_job(job):
    spec = job.get('spec') or {}
    receipt = job.get('receipt') or {}
    result = {k: job.get(k) for k in ('id', 'profile', 'status', 'created', 'started', 'finished')}
    match = re.fullmatch(r'web-(.+)-\d{2}', str(job.get('id', '')))
    if match:
        result['requestId'] = match.group(1)
    result.update(prompt=spec.get('prompt'), width=spec.get('width'), height=spec.get('height'),
                  settings=spec.get('settings', {}), seconds=receipt.get('generation_seconds'),
                  sha256=receipt.get('sha256'))
    if job.get('problem'):
        result['problem'] = 'Generation needs attention; its records have been retained.'
    return result


def public_health(profile, health):
    return {'profile': profile, **{k: health.get(k) for k in ('phase', 'paused', 'queued', 'running')},
            'problem': 'Worker needs attention.' if health.get('problem') else None}


def all_jobs(profile):
    response = call(profile, '/jobs')
    return response if isinstance(response, list) else response.get('jobs', [])


def state():
    workers, jobs = [], []
    for profile in PORTS:
        try:
            health = public_health(profile, call(profile, '/health'))
            current_jobs = all_jobs(profile)
            workers.append(health)
            jobs.extend(public_job(job) for job in current_jobs)
        except Exception:
            workers.append({'profile': profile, 'phase': 'unavailable', 'problem': 'Worker is not responding.'})
    gpus = []
    try:
        result = subprocess.run(['nvidia-smi', '--query-gpu=index,name,memory.used,memory.total,utilization.gpu',
                                 '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=3, check=True)
        for line in result.stdout.splitlines():
            index, name, used, total, utilization = [part.strip() for part in line.split(',')]
            gpus.append({'index': int(index), 'name': name, 'memory_used_mb': int(used),
                         'memory_total_mb': int(total), 'utilization_percent': int(utilization)})
    except Exception:
        pass
    jobs.sort(key=lambda job: job.get('created') or 0, reverse=True)
    return {'ok': True, 'workers': workers, 'jobs': jobs[:80], 'gpus': gpus}


def integer(body, name, default, low, high):
    value = body.get(name, default)
    if type(value) is not int or not low <= value <= high:
        raise ValueError('Invalid ' + name)
    return value


def submit(body):
    allowed = {'profile', 'prompt', 'width', 'height', 'steps', 'guidance_scale', 'seed',
               'max_sequence_length', 'count', 'requestId'}
    if set(body) - allowed:
        raise ValueError('Unsupported generation fields')
    profile = body.get('profile')
    if profile not in PORTS:
        raise ValueError('Unknown model profile')
    prompt = body.get('prompt')
    if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 20000:
        raise ValueError('Prompt must contain 1–20000 characters')
    width = integer(body, 'width', 512, 256, 1536)
    height = integer(body, 'height', 512, 256, 1536)
    if width % 32 or height % 32:
        raise ValueError('Dimensions must be multiples of 32')
    count = integer(body, 'count', 1, 1, 20)
    seed = integer(body, 'seed', 42, 0, 2**32 - count)
    settings = {'seed': seed, 'steps': integer(body, 'steps', 28, 1, 60),
                'max_sequence_length': integer(body, 'max_sequence_length', 512, 32, 512)}
    guidance = body.get('guidance_scale', 3.5 if profile == 'flux1-dev' else 4)
    if type(guidance) not in (int, float) or not math.isfinite(guidance) or not 1 <= guidance <= 10:
        raise ValueError('Invalid guidance scale')
    settings['guidance_scale'] = guidance
    request_id = body.get('requestId')
    if not isinstance(request_id, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{16,64}', request_id):
        raise ValueError('A stable requestId is required')
    fingerprint = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
    directory = ROOT / 'requests'
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / (request_id + '.json')
    with (ROOT / 'submit.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if path.exists():
            record = json.loads(path.read_text())
            if record['fingerprint'] != fingerprint:
                raise ValueError('Request ID belongs to different generation settings')
        else:
            active = sum(job.get('status') in ('queued', 'running') for job in all_jobs(profile))
            if active + count > 100:
                raise ValueError('This worker already has a full queue')
            record = {'id': request_id, 'fingerprint': fingerprint, 'request': body,
                      'created': time.time(), 'jobs': [f'web-{request_id}-{i:02d}' for i in range(count)]}
            with path.open('x') as stream:
                json.dump(record, stream)
                stream.flush()
                os.fsync(stream.fileno())
        jobs = []
        for i, ident in enumerate(record['jobs']):
            spec = {'model': profile, 'prompt': prompt, 'width': width, 'height': height,
                    'settings': {**settings, 'seed': seed + i}, 'references': []}
            jobs.append(public_job(call(profile, '/jobs', {'id': ident, 'spec': spec})))
        return {'ok': True, 'requestId': request_id, 'jobs': jobs}


def main():
    if os.environ.get('SSH_ORIGINAL_COMMAND') != 'artwork-control-v1':
        raise ValueError('Only the artwork control bridge is available')
    raw = sys.stdin.buffer.read(32769)
    if not 0 < len(raw) <= 32768:
        raise ValueError('Invalid request size')
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError('Invalid request')
    action, body = value.get('action'), value.get('body', {})
    if not isinstance(body, dict):
        raise ValueError('Invalid body')
    if action == 'state':
        return state()
    if action == 'jobs':
        return submit(body)
    if action == 'pause':
        profile = body.get('profile')
        if profile not in PORTS or type(body.get('paused')) is not bool or set(body) != {'profile', 'paused'}:
            raise ValueError('A profile and pause state are required')
        worker = call(profile, '/control', {'paused': body['paused']})
        return {'ok': True, 'worker': public_health(profile, worker)}
    raise ValueError('Unknown action')


if __name__ == '__main__':
    try:
        print(json.dumps(main()))
    except ValueError as exc:
        print(json.dumps({'ok': False, 'status': 400, 'problem': str(exc)}))
    except Exception:
        print(json.dumps({'ok': False, 'status': 503, 'problem': 'The worker did not respond. Keep this request ID when retrying.'}))
