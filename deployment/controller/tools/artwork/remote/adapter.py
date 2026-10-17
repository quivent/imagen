#!/usr/bin/env python3
"""Factory command adapter for the private, persistent FLUX workers.

Accepts the factory packet on stdin; emits only a completed local receipt on
stdout. SSH carries requests to loopback, so no public inference port is needed.
An interrupted invocation can submit the same factory job ID again safely.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import sys
import tempfile
import time


PROFILES = {'flux1-dev': 18761, 'flux2-dev-nf4': 18762}
DEADLINE_SECONDS = 840
MAX_IMAGE_BYTES = 50_000_000

# The script and command are fixed; request data travels on stdin, never as
# shell arguments. urllib errors deliberately omit bodies and credentials.
REMOTE_REQUEST = r'''
import ctypes, json, os, re, select, struct, sys, time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
p = json.load(sys.stdin)
data = json.dumps(p['data']).encode() if p.get('data') is not None else None
r = Request('http://127.0.0.1:%d%s' % (p['port'], p['path']), data=data,
            headers={'Content-Type': 'application/json'}, method=p['method'])
try:
    descriptor = None
    # Watch before the first read so completion between the read and wait
    # cannot be lost. Existing resident GPU services remain untouched.
    if p.get('wait'):
        match = re.fullmatch(r'/jobs/([A-Za-z0-9_-]{1,128})', p['path'])
        profile = {18761: 'flux1-dev', 18762: 'flux2-dev-nf4'}.get(p['port'])
        if not match or not profile or p['method'] != 'GET':
            raise ValueError('Invalid completion wait')
        libc = ctypes.CDLL(None, use_errno=True)
        descriptor = libc.inotify_init1(os.O_CLOEXEC | os.O_NONBLOCK)
        directory = ('/workspace/artwork/jobs/' + profile + '/' + match[1]).encode()
        if descriptor < 0 or libc.inotify_add_watch(descriptor, directory, 0x00000008 | 0x00000080) < 0:
            raise OSError('Completion watch unavailable')
    try:
        until = time.monotonic() + 12
        while True:
            with urlopen(r, timeout=15) as response:
                body = response.read(2_000_001)
                if len(body) > 2_000_000:
                    raise ValueError('Response too large')
                result = json.loads(body)
            if descriptor is None or result.get('status') in ('done', 'failed', 'uncertain'):
                break
            changed = False
            while not changed:
                remaining = until - time.monotonic()
                if remaining <= 0 or not select.select([descriptor], [], [], remaining)[0]:
                    break
                events = os.read(descriptor, 65536)
                cursor = 0
                while cursor + 16 <= len(events):
                    _, _, _, length = struct.unpack_from('iIII', events, cursor)
                    name = events[cursor + 16:cursor + 16 + length].split(b'\0', 1)[0]
                    changed = changed or name in (b'job.json', b'receipt.json')
                    cursor += 16 + length
            if not changed:
                break
    finally:
        if descriptor is not None and descriptor >= 0:
            os.close(descriptor)
    print(json.dumps({'response': result}))
except HTTPError as exc:
    print(json.dumps({'httpError': exc.code}))
except (URLError, TimeoutError, OSError):
    print(json.dumps({'transportError': True}))
'''


class AdapterError(Exception):
    pass


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def time_left(deadline, cap):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise AdapterError('Remote job remains recorded; reconcile its ID before retrying')
    return min(cap, remaining)


def pause(deadline, seconds=3):
    time.sleep(time_left(deadline, seconds))


def transport_options():
    # Reuse one authenticated transport for status and SCP. Keep the Unix
    # socket path short (macOS has a small limit), private, and host/key bound.
    directory = Path('/tmp') / ('artwork-ssh-' + str(os.getuid()))
    directory.mkdir(mode=0o700, exist_ok=True)
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise AdapterError('SSH transport directory is not private')
    return ['-o', 'ControlMaster=auto', '-o', 'ControlPersist=60',
            '-o', 'ControlPath=' + str(directory / '%C')]


def request(host, ssh_port, port, method, path, data, deadline, wait=False):
    """Retry transport failures with the same idempotent request identity."""
    packet = {'port': port, 'method': method, 'path': path, 'data': data, 'wait': wait}
    command = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
               '-o', 'StrictHostKeyChecking=yes', '-o', 'ServerAliveInterval=10',
               '-o', 'ServerAliveCountMax=2', *transport_options(), '-p', str(ssh_port), host,
               'python3 -c ' + shlex.quote(REMOTE_REQUEST)]
    while True:
        try:
            result = subprocess.run(command, input=json.dumps(packet), text=True,
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                    timeout=time_left(deadline, 30))
        except subprocess.TimeoutExpired:
            pause(deadline)
            continue
        if result.returncode:
            pause(deadline)
            continue
        if len(result.stdout) > 2_100_000:
            raise AdapterError('Remote response exceeds the receipt limit')
        try:
            envelope = json.loads(result.stdout)
        except (ValueError, TypeError):
            raise AdapterError('Remote response was not a receipt') from None
        if not isinstance(envelope, dict):
            raise AdapterError('Remote response was not a receipt')
        if envelope.get('transportError'):
            pause(deadline)
            continue
        status = envelope.get('httpError')
        if status is not None:
            if status >= 500 or status in (408, 429):
                pause(deadline)
                continue
            raise AdapterError('Remote worker returned HTTP %s; job ID is unchanged' % status)
        response = envelope.get('response')
        if not isinstance(response, dict):
            raise AdapterError('Remote worker returned an invalid job record')
        return response


def download(host, ssh_port, source, destination, expected_hash, deadline):
    if destination.exists():
        if destination.is_file() and digest(destination) == expected_hash:
            return
        raise AdapterError('Existing local image differs from remote receipt; preserved for reconciliation')
    descriptor, temporary = tempfile.mkstemp(prefix='.result-', suffix='.partial',
                                           dir=destination.parent)
    os.close(descriptor)
    partial = Path(temporary)
    try:
        command = ['scp', '-q', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
                   '-o', 'StrictHostKeyChecking=yes', '-o', 'ServerAliveInterval=10',
                   '-o', 'ServerAliveCountMax=2', *transport_options(), '-P', str(ssh_port),
                   host + ':' + source, str(partial)]
        while True:
            try:
                result = subprocess.run(command, stdout=subprocess.DEVNULL,
                                        stderr=subprocess.DEVNULL,
                                        timeout=time_left(deadline, 120))
            except subprocess.TimeoutExpired:
                pause(deadline)
                continue
            if result.returncode:
                pause(deadline)
                continue
            if not 0 < partial.stat().st_size <= MAX_IMAGE_BYTES:
                raise AdapterError('Remote image has an invalid file size')
            if digest(partial) != expected_hash:
                raise AdapterError('Downloaded image did not match the remote receipt')
            with partial.open('rb') as stream:
                os.fsync(stream.fileno())
            # Linking instead of replacing protects an output completed by a
            # concurrent reconciliation of this same attempt.
            try:
                os.link(partial, destination)
            except FileExistsError:
                if digest(destination) != expected_hash:
                    raise AdapterError('Local output changed during download; existing file preserved')
            return
    finally:
        partial.unlink(missing_ok=True)


def run(packet):
    deadline = time.monotonic() + DEADLINE_SECONDS
    if not isinstance(packet, dict):
        raise AdapterError('Expected a factory packet')
    job = packet.get('job', '')
    if not isinstance(job, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', job):
        raise AdapterError('Factory job ID is invalid')
    spec = packet.get('spec')
    if not isinstance(spec, dict):
        raise AdapterError('Factory spec is missing')
    if spec.get('references'):
        raise AdapterError('These workers accept text-to-image jobs only; no request was sent')
    profile = spec.get('model')
    if profile not in PROFILES:
        raise AdapterError('Choose model flux1-dev or flux2-dev-nf4; no request was sent')
    host = os.environ.get('ARTWORK_SSH_HOST', '')
    if not re.fullmatch(r'(?:[A-Za-z0-9_][A-Za-z0-9_.-]*@)?[A-Za-z0-9][A-Za-z0-9.-]*', host):
        raise AdapterError('ARTWORK_SSH_HOST must be a hostname with an optional SSH user')
    try:
        ssh_port = int(os.environ.get('ARTWORK_SSH_PORT', '0'))
    except ValueError:
        raise AdapterError('ARTWORK_SSH_PORT must be an integer') from None
    if not 1 <= ssh_port <= 65535:
        raise AdapterError('ARTWORK_SSH_PORT is outside the TCP port range')
    output = packet.get('outputDirectory')
    if not isinstance(output, str) or not Path(output).is_absolute():
        raise AdapterError('Factory outputDirectory must be an absolute path')
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = request(host, ssh_port, PROFILES[profile], 'POST', '/jobs',
                     {'id': job, 'spec': spec}, deadline)
    while result.get('status') != 'done':
        if result.get('status') in ('failed', 'uncertain'):
            raise AdapterError('Remote job is %s; reconcile the same ID' % result['status'])
        if result.get('status') not in ('queued', 'running', 'loading'):
            raise AdapterError('Remote job has an unknown status; reconcile the same ID')
        result = request(host, ssh_port, PROFILES[profile], 'GET', '/jobs/' + job,
                         None, deadline, wait=True)
    receipt_observed_at = time.time()
    receipt = result.get('receipt')
    if not isinstance(receipt, dict):
        raise AdapterError('Completed remote job has no receipt')
    source = '/workspace/artwork/jobs/%s/%s/result.png' % (profile, job)
    if receipt.get('source') != source:
        raise AdapterError('Remote image path does not match this job and model')
    expected_hash = receipt.get('sha256', '')
    if not isinstance(expected_hash, str) or not re.fullmatch(r'[0-9a-f]{64}', expected_hash):
        raise AdapterError('Remote receipt has no valid image SHA-256')
    local_source = output / 'result.png'
    download_started_at = time.time()
    download(host, ssh_port, source, local_source, expected_hash, deadline)
    complete = {'source': str(local_source), 'generation': receipt,
                'remote': {'job': job, 'profile': profile, 'host': host, 'port': ssh_port},
                'delivery': {'receiptObservedAt': receipt_observed_at,
                             'downloadStartedAt': download_started_at,
                             'downloadFinishedAt': time.time(),
                             'completionObservation': 'remote-filesystem-event'}}
    descriptor, temporary = tempfile.mkstemp(prefix='.generation-', suffix='.partial', dir=output)
    try:
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(complete, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, output / 'generation.json')
    finally:
        Path(temporary).unlink(missing_ok=True)
    return complete


if __name__ == '__main__':
    try:
        payload = sys.stdin.read(2_000_001)
        if len(payload) > 2_000_000:
            raise AdapterError('Factory packet exceeds the request limit')
        print(json.dumps(run(json.loads(payload)), ensure_ascii=False))
    except AdapterError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
    except Exception as exc:
        # Do not print arbitrary subprocess responses or exception bodies.
        print('Adapter stopped: ' + type(exc).__name__ + '; reconcile the factory job ID', file=sys.stderr)
        sys.exit(1)
