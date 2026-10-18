#!/usr/bin/env python3
"""Maintain local artwork names from gallery metadata, without model/image calls."""
import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import plistlib
import signal
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.runtime/image-names'
LABEL = 'vision.influx.imagen.naming'
STATUS = RUNTIME / 'daemon-status.json'
PLIST = Path.home() / 'Library/LaunchAgents' / (LABEL + '.plist')
TEMPLATE = ROOT / 'deployment/launchd' / (LABEL + '.plist.in')
PROFILES = ('flux1-dev', 'flux2-dev-nf4')


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def write_status(state):
    state['heartbeatAt'] = now()
    temporary = STATUS.with_suffix('.tmp')
    temporary.write_text(json.dumps(state, indent=2) + '\n')
    temporary.replace(STATUS)


def coverage(base, profile):
    names_path = RUNTIME / (profile + '.json')
    names = json.loads(names_path.read_text()).get('names', {}) if names_path.exists() else {}
    rows = {}
    cursor = None
    seen = set()
    while True:
        query = {'profile': profile, 'limit': 100}
        if cursor:
            query['cursor'] = cursor
        with urllib.request.urlopen(base + '/api/gallery?' + urllib.parse.urlencode(query), timeout=30) as response:
            data = json.load(response)
        if not data.get('ok'):
            raise ValueError('Gallery unavailable')
        for job in data['jobs']:
            if job['profile'] == profile:
                rows[job['id']] = job
        cursor = data.get('nextCursor')
        if not cursor:
            break
        if cursor in seen:
            raise ValueError('Repeated gallery cursor')
        seen.add(cursor)
    return {'galleryJobs': len(rows), 'namedJobs': len(names),
            'missing': sum(job_id not in names for job_id in rows),
            'hashMismatches': sum(job_id in names and names[job_id]['sha256'] != job['sha256'] for job_id, job in rows.items()),
            'verifiedAt': now()}


def run(args):
    RUNTIME.mkdir(parents=True, exist_ok=True, mode=0o700)
    stop = False

    def stopping(_signum, _frame):
        nonlocal stop
        stop = True

    signal.signal(signal.SIGTERM, stopping)
    signal.signal(signal.SIGINT, stopping)
    with (RUNTIME / 'daemon.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({'event': 'already-running'}), flush=True)
            return
        state = {'schema': 1, 'label': LABEL, 'pid': os.getpid(), 'startedAt': now(),
                 'mode': 'metadata-and-cache-only', 'status': 'running', 'profiles': {}}
        due = {p: 0.0 for p in PROFILES}
        write_status(state)
        while not stop:
            for profile in PROFILES:
                if stop or time.monotonic() < due[profile]:
                    continue
                started = time.monotonic()
                state['activeProfile'] = profile
                write_status(state)
                script = 'image_names_flux1.py' if profile == PROFILES[0] else 'image_names_flux2.py'
                result = None
                error = None
                try:
                    # No --allow-model: subprocesses may only reuse metadata and cached phrases.
                    result = subprocess.run([sys.executable, '-B', str(ROOT / 'scripts' / script), '--base', args.base],
                                            capture_output=True, text=True, timeout=120)
                    if result.returncode:
                        error = 'Helper exit ' + str(result.returncode)
                    entry = coverage(args.base, profile)
                    entry['status'] = 'ready' if not error and not entry['missing'] and not entry['hashMismatches'] else 'needs-attention'
                except Exception as problem:
                    error = type(problem).__name__
                    entry = dict(state['profiles'].get(profile, {}), status='unavailable')
                entry.update({'lastRunAt': now(), 'durationSeconds': round(time.monotonic() - started, 3)})
                if error:
                    entry['error'] = error
                state['profiles'][profile] = entry
                state.pop('activeProfile', None)
                due[profile] = time.monotonic() + (args.interval if profile == PROFILES[0] else args.flux2_interval)
                write_status(state)
                print(json.dumps({'at': now(), 'profile': profile, **entry}), flush=True)
            write_status(state)
            time.sleep(1)
        state['status'] = 'stopped'
        write_status(state)


def install(args):
    if sys.platform != 'darwin':
        raise ValueError('launchd requires macOS')
    RUNTIME.mkdir(parents=True, exist_ok=True, mode=0o700)
    replacements = {'PYTHON': sys.executable, 'REPO': str(ROOT), 'RUNTIME': str(RUNTIME),
                    'INTERVAL': str(args.interval), 'FLUX2_INTERVAL': str(args.flux2_interval), 'BASE': args.base}
    text = TEMPLATE.read_text()
    for key, value in replacements.items():
        text = text.replace('{{' + key + '}}', escape(value))
    specification = plistlib.loads(text.encode())
    PLIST.parent.mkdir(parents=True, exist_ok=True)
    with PLIST.open('wb') as handle:
        plistlib.dump(specification, handle)
    PLIST.chmod(0o600)
    print(json.dumps({'installed': str(PLIST), 'label': LABEL}))


def start():
    domain = 'gui/' + str(os.getuid())
    present = subprocess.run(['launchctl', 'print', domain + '/' + LABEL], capture_output=True)
    if present.returncode == 0:
        subprocess.run(['launchctl', 'kickstart', domain + '/' + LABEL], check=True)
    else:
        subprocess.run(['launchctl', 'bootstrap', domain, str(PLIST)], check=True)
    print(json.dumps({'started': LABEL}))


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('run', 'install', 'start', 'status'))
    parser.add_argument('--base', default='http://127.0.0.1:48624')
    parser.add_argument('--interval', type=int, default=30)
    parser.add_argument('--flux2-interval', type=int, default=60)
    args = parser.parse_args()
    args.base = args.base.rstrip('/')
    if min(args.interval, args.flux2_interval) < 10:
        parser.error('Refresh intervals must be at least 10 seconds')
    if args.command == 'install':
        install(args)
    elif args.command == 'start':
        start()
    elif args.command == 'status':
        if STATUS.exists():
            print(STATUS.read_text(), end='')
        else:
            print(json.dumps({'status': 'not-started', 'label': LABEL}))
    else:
        run(args)


if __name__ == '__main__':
    main()
