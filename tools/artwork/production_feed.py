#!/usr/bin/env python3
"""Read-only, paginated observations of the continuous production parity daemon."""
import argparse
from collections import OrderedDict
import json
import math
from pathlib import Path
import re
import time

import parity_daemon
import prompt_clarity as study
from study_controller import Controller

PAGE_SIZE = 20
IDENTITY = re.compile(r'[a-f0-9]{64}')


def _stamp(file):
    try:
        info = file.stat()
        return (info.st_mtime_ns, info.st_size)
    except FileNotFoundError:
        return None


class ProductionFeed:
    def __init__(self, root=study.DEFAULT_ROOT, daemon_root=parity_daemon.DEFAULT_ROOT,
                 controller=Controller, daemon=None, clock=time.monotonic):
        self.root = Path(root).resolve()
        self.daemon_root = Path(daemon_root).resolve()
        self.controller = controller
        self.daemon = daemon
        self.clock = clock
        self.entries = {}
        self.public_cache = OrderedDict()
        self.scanned_at = None
        self.rows = []

    def daemon_status(self):
        # Kernel lock evidence is read independently for each configured lane.
        def status(root):
            if not root.is_dir():
                daemon = object.__new__(parity_daemon.ParityDaemon)
                daemon.root = root
                return {**daemon.read(), 'runnerAlive': False}
            return parity_daemon.ParityDaemon(root, self.root).status()

        main = self.daemon.status() if self.daemon is not None else status(self.daemon_root)
        roots = [self.daemon_root]
        secondary = self.daemon_root.with_name(self.daemon_root.name+'-gpu1')
        if secondary.is_dir():
            roots.append(secondary)
        lanes = []
        for position, root in enumerate(roots):
            state = main if position == 0 else status(root)
            try:
                config = json.loads((root/'config.json').read_text())
            except (OSError, ValueError):
                config = {}
            raw_port = config.get('workerPort')
            port = int(raw_port) if isinstance(raw_port, (int, str)) and str(raw_port).isdigit() else None
            gpu = {18761: 0, 18763: 1}.get(port)
            lane_index = config.get('laneIndex', position)
            lanes.append({**state, 'laneIndex': lane_index, 'gpuIndex': gpu,
                          'workerPort': port})
        completed = sum(max(0, int(lane.get('completedPairs', 0))) for lane in lanes)
        enabled = [lane for lane in lanes if lane.get('enabled')]
        running = [lane for lane in enabled if lane.get('runnerAlive')]
        available = running or enabled
        stage = next((name for name in ('running', 'waiting-worker', 'checking', 'waiting-draft')
                      if any(lane.get('stage') == name for lane in available)),
                     available[0].get('stage', 'checking') if available else
                     'needs-attention' if any(lane.get('stage') == 'needs-attention' for lane in lanes) else 'paused')
        problems = [f"Lane {lane['laneIndex']}: {lane['problem']}" for lane in lanes if lane.get('problem')]
        current = next((lane.get('currentPackage') for lane in available if lane.get('currentPackage')),
                       main.get('currentPackage'))
        return {**main, 'lanes': lanes, 'enabled': bool(enabled),
                'runnerAlive': any(lane.get('runnerAlive') for lane in lanes),
                'stage': stage, 'currentPackage': current, 'completedPairs': completed,
                'pass': max(int(lane.get('pass', 1)) for lane in lanes),
                'problem': ' · '.join(problems) if problems else None}

    def scan(self):
        now = self.clock()
        if self.scanned_at is not None and now-self.scanned_at < 2:
            return
        runs = self.root/'runs'
        directories = sorted((path for path in runs.iterdir()
                              if IDENTITY.fullmatch(path.name) and path.is_dir()),
                             key=lambda path: path.name) if runs.exists() else []
        present = set()
        for directory in directories:
            identity = directory.name
            present.add(identity)
            stamps = (_stamp(directory/'package.json'), _stamp(directory/'control.json'))
            old = self.entries.get(identity)
            if old and old['stamps'] == stamps:
                continue
            if stamps[0] is None:
                self.entries.pop(identity, None)
                continue
            try:
                package = json.loads((directory/'package.json').read_text())
                if package.get('study') != 'ADHC-001' or package.get('id') != identity:
                    self.entries.pop(identity, None)
                    continue
                control = json.loads((directory/'control.json').read_text()) if stamps[1] else {}
                pairs = []
                for pair_id, pair in control.get('pairs', {}).items():
                    if not isinstance(pair, dict) or not isinstance(pair.get('completedAt'), (int, float)):
                        continue
                    pairs.append((float(pair['completedAt']), identity, pair_id))
                self.entries[identity] = {'stamps': stamps, 'pairs': pairs}
            except (OSError, ValueError, TypeError, AttributeError):
                # Atomic source writes normally prevent partial records. Try again next scan.
                self.entries.pop(identity, None)
        for identity in self.entries.keys()-present:
            self.entries.pop(identity)
        self.rows = sorted((row for entry in self.entries.values() for row in entry['pairs']),
                           reverse=True)
        self.scanned_at = now

    def public(self, identity, live=False):
        directory = self.root/'runs'/identity
        stamp = (_stamp(directory/'package.json'), _stamp(directory/'control.json'))
        cached = self.public_cache.get(identity)
        if cached and cached[0] == stamp and (not live or self.clock()-cached[1] < 2):
            self.public_cache.move_to_end(identity)
            return cached[2]
        controller = self.controller(identity, self.root)
        value = (controller.public(), controller.package)
        self.public_cache[identity] = (stamp, self.clock(), value)
        self.public_cache.move_to_end(identity)
        while len(self.public_cache) > PAGE_SIZE+1:
            self.public_cache.popitem(last=False)
        return value

    def feed(self, page=1):
        if type(page) is not int or page < 1:
            raise ValueError('Page must be a positive integer')
        daemon = self.daemon_status()
        self.scan()
        total = len(self.rows)
        pages = max(1, math.ceil(total/PAGE_SIZE))
        page = min(page, pages)
        selected = self.rows[(page-1)*PAGE_SIZE:page*PAGE_SIZE]
        pairs = []
        current_identity = daemon.get('currentPackage')
        current = None
        if current_identity and IDENTITY.fullmatch(current_identity):
            current, _ = self.public(current_identity, live=True)
        for completed_at, identity, pair_id in selected:
            public, package = self.public(identity)
            pair = next((row for row in public['pairs'] if row['id'] == pair_id), None)
            if pair is None:
                continue
            scene = package.get('sourceCorpus', {}).get('scene', {})
            pairs.append({**pair, 'id': identity+':'+pair_id.replace('-', ''),
                          'requestPair': pair_id, 'package': identity,
                          'sceneName': scene.get('name') or scene.get('id') or 'Scene',
                          'sceneId': scene.get('id'), 'seed': pair.get('seed'),
                          'completedAt': completed_at,'promptRevision':package.get('promptRevision','historical-production')})
            if current is None:
                current = public
        completed = max(0, int(daemon.get('completedPairs', 0)))
        remaining = 150-(completed % 150)
        workflow = {**(current or {}), 'study': 'ADHC-001', 'package': current_identity,
                    'stage': daemon.get('stage', 'paused'), 'enabled': bool(daemon.get('enabled')),
                    'runnerAlive': bool(daemon.get('runnerAlive')), 'problem': daemon.get('problem'),
                    'pairs': pairs, 'plannedPairs': 150, 'completedPairs': completed,
                    'remainingPairs': remaining, 'continuous': True, 'report': None,
                    'reviewsOptional': True, 'reviewRequired': False,
                    'pass': daemon.get('pass', 1), 'seed': daemon.get('seed', 42),
                    'lanes': [{key: lane.get(key) for key in
                               ('laneIndex', 'gpuIndex', 'workerPort', 'sceneId', 'stage',
                                'enabled', 'runnerAlive', 'currentPackage', 'completedPairs', 'pass', 'seed')}
                              for lane in daemon.get('lanes', [])]}
        return {'daemon': daemon, 'status': workflow['stage'], 'workflow': workflow,
                'currentPackage': current_identity, 'pairs': pairs,
                'page': page, 'pages': pages, 'totalPairs': total}


_feeds = OrderedDict()


def feed(root=study.DEFAULT_ROOT, daemon_root=parity_daemon.DEFAULT_ROOT, page=1):
    key = (str(Path(root).resolve()), str(Path(daemon_root).resolve()))
    if key not in _feeds:
        _feeds[key] = ProductionFeed(root, daemon_root)
    _feeds.move_to_end(key)
    while len(_feeds) > 4:
        _feeds.popitem(last=False)
    return _feeds[key].feed(page)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=study.DEFAULT_ROOT)
    parser.add_argument('--daemon-root', type=Path, default=parity_daemon.DEFAULT_ROOT)
    parser.add_argument('--page', type=int, default=1)
    parser.add_argument('action', choices=['feed'])
    args = parser.parse_args()
    print(json.dumps(feed(args.root, args.daemon_root, args.page)))


if __name__ == '__main__':
    main()
