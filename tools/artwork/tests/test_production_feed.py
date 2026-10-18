"""Read-only feed pagination, optional review and kernel-runner observations."""
import copy
from contextlib import ExitStack
import fcntl
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import production_feed as module


class FakeDaemon:
    def __init__(self, **state):
        self.state = {'study': 'ADHC-001', 'enabled': True, 'stage': 'running',
                      'currentPackage': None, 'sceneIndex': 34, 'pass': 1,
                      'seed': 42, 'completedPairs': 34, 'runnerAlive': True, **state}
    def status(self):
        return copy.deepcopy(self.state)


class FakeController:
    calls = []
    def __init__(self, identity, root):
        self.identity = identity
        self.directory = Path(root)/'runs'/identity
        self.package = json.loads((self.directory/'package.json').read_text())
        self.calls.append(identity)
    def public(self):
        state = json.loads((self.directory/'control.json').read_text())
        pairs = [{'id': identity, 'seed': pair['seed'],
                  'images': {'left': {'url': '/blind/left'}, 'right': {'url': '/blind/right'}},
                  'review': state.get('reviews', {}).get(identity), 'revealedArms': None}
                 for identity, pair in state.get('pairs', {}).items()]
        return {'package': self.identity, 'study': 'ADHC-001', 'stage': 'waiting-review',
                'enabled': False, 'runnerAlive': False, 'pairs': pairs, 'report': {'old': True}}


class ProductionFeedTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)/'study'
        self.daemon_root = Path(self.temp.name)/'daemon'
        self.clock = 100.
        FakeController.calls = []
    def tearDown(self):
        self.temp.cleanup()
    def package(self, number, completed=True, study='ADHC-001', timestamp=None):
        identity = f'{number:064x}'
        directory = self.root/'runs'/identity
        directory.mkdir(parents=True)
        (directory/'package.json').write_text(json.dumps({'id': identity, 'study': study,
            'sourceCorpus': {'scene': {'id': f'scene-{number:03}', 'name': f'Scene {number}'}}}))
        (directory/'control.json').write_text(json.dumps({'pairs': {'pair-01': {
            'seed': 42, 'completedAt': number if timestamp is None else timestamp}} if completed else {}, 'reviews': {}}))
        return identity
    def feed(self, daemon):
        return module.ProductionFeed(self.root, self.daemon_root, FakeController,
                                     daemon=daemon, clock=lambda: self.clock)
    def test_latest_twenty_and_pages_keep_review_identity_and_daemon_aggregate(self):
        for number in range(1, 36):
            self.package(number)
        self.package(100, study='different-study')
        current = self.package(36, completed=False)
        feed = self.feed(FakeDaemon(currentPackage=current))
        latest = feed.feed()
        self.assertEqual(latest['page'], 1)
        self.assertEqual(latest['pages'], 2)
        self.assertEqual(latest['totalPairs'], 35)
        self.assertEqual(len(latest['pairs']), 20)
        pair = latest['pairs'][0]
        self.assertEqual(pair['id'], f'{35:064x}:pair01')
        self.assertEqual(pair['requestPair'], 'pair-01')
        self.assertEqual(pair['package'], f'{35:064x}')
        self.assertEqual(pair['sceneName'], 'Scene 35')
        self.assertEqual(pair['seed'], 42)
        self.assertIsNone(pair['revealedArms'])
        self.assertEqual(latest['currentPackage'], current)
        workflow = latest['workflow']
        self.assertEqual(workflow['stage'], 'running', 'historical waiting-review never gates the daemon')
        self.assertTrue(workflow['enabled'])
        self.assertTrue(workflow['runnerAlive'])
        self.assertEqual(workflow['completedPairs'], 34, 'daemon count remains authoritative during completion race')
        self.assertEqual(workflow['remainingPairs'], 116)
        self.assertTrue(workflow['continuous'])
        self.assertTrue(workflow['reviewsOptional'])
        self.assertFalse(workflow['reviewRequired'])
        self.assertIsNone(workflow['report'])
        self.assertEqual(len(FakeController.calls), 21, 'only current package and selected page are validated')
        second = feed.feed(2)
        self.assertEqual(len(second['pairs']), 15)
        self.assertEqual(second['pairs'][-1]['package'], f'{1:064x}')
        self.assertEqual(feed.feed(999)['page'], 2)
        for page in (0, -1, 1.5, True):
            with self.assertRaises(ValueError):
                feed.feed(page)
    def test_unchanged_historical_packages_do_not_revalidate_every_poll(self):
        identity = self.package(1)
        feed = self.feed(FakeDaemon())
        feed.feed()
        self.assertEqual(FakeController.calls, [identity])
        self.clock += 3
        feed.feed()
        self.assertEqual(FakeController.calls, [identity])
        control = self.root/'runs'/identity/'control.json'
        data = json.loads(control.read_text())
        data['reviews'] = {'pair-01': {'choice': 'tie'}}
        control.write_text(json.dumps(data))
        self.clock += 3
        self.assertEqual(feed.feed()['pairs'][0]['review'], {'choice': 'tie'})
        self.assertEqual(FakeController.calls, [identity, identity])
    def test_metadata_cache_discovers_append_after_two_seconds(self):
        self.package(1)
        feed = self.feed(FakeDaemon())
        self.assertEqual(feed.feed()['totalPairs'], 1)
        self.package(2)
        self.clock += 1
        self.assertEqual(feed.feed()['totalPairs'], 1)
        self.clock += 2
        self.assertEqual(feed.feed()['totalPairs'], 2)
    def test_empty_paused_feed_and_pass_remaining(self):
        result = self.feed(FakeDaemon(enabled=False, stage='paused', sceneIndex=0,
                                     completedPairs=150, **{'pass': 2})).feed()
        self.assertEqual(result['pairs'], [])
        self.assertEqual(result['pages'], 1)
        self.assertEqual(result['totalPairs'], 0)
        self.assertEqual(result['workflow']['remainingPairs'], 150)
        self.assertEqual(result['workflow']['stage'], 'paused')
        self.assertFalse(self.root.exists(), 'feed does not create or schedule study work')
    def test_missing_daemon_runtime_is_not_created(self):
        result = module.ProductionFeed(self.root, self.daemon_root).feed()
        self.assertFalse(result['daemon']['runnerAlive'])
        self.assertEqual(result['status'], 'paused')
        self.assertFalse(self.daemon_root.exists())
        self.assertFalse(self.root.exists())

    def test_dual_lane_status_uses_both_locks_real_ports_and_global_completion(self):
        second = self.daemon_root.with_name(self.daemon_root.name+'-gpu1')
        states = []
        for root, index, port, completed, scene_index in [
                (self.daemon_root, 0, 18761, 60, 60), (second, 1, 18763, 0, 75)]:
            root.mkdir()
            state = {'study': 'ADHC-001', 'enabled': True, 'stage': 'running',
                     'currentPackage': None, 'sceneIndex': scene_index,
                     'sceneId': f'scene-{scene_index+1:03}', 'completedPairs': completed,
                     'pass': 1, 'seed': 42}
            states.append(state)
            (root/'state.json').write_text(json.dumps(state))
            (root/'config.json').write_text(json.dumps({'laneIndex': index, 'workerPort': port}))
        feed = module.ProductionFeed(self.root, self.daemon_root)
        with ExitStack() as stack:
            locks = [stack.enter_context((root/'runner.lock').open('a')) for root in (self.daemon_root, second)]
            for lock in locks:
                fcntl.flock(lock, fcntl.LOCK_EX|fcntl.LOCK_NB)
            result = feed.feed()
            self.assertEqual([lane['gpuIndex'] for lane in result['daemon']['lanes']], [0, 1])
            self.assertTrue(all(lane['runnerAlive'] for lane in result['daemon']['lanes']))
            self.assertEqual(result['workflow']['completedPairs'], 60)
            self.assertEqual(result['workflow']['remainingPairs'], 90, 'lane1 initial index75 is not75 completions')
            self.assertEqual([lane['sceneId'] for lane in result['workflow']['lanes']], ['scene-061', 'scene-076'])
            states[0].update(enabled=False, stage='paused')
            states[1].update(completedPairs=3)
            for root, state in zip((self.daemon_root, second), states):
                (root/'state.json').write_text(json.dumps(state))
            result = feed.feed()
            self.assertTrue(result['daemon']['enabled'])
            self.assertTrue(result['daemon']['runnerAlive'])
            self.assertEqual(result['status'], 'running')
            self.assertEqual(result['workflow']['completedPairs'], 63)
            self.assertEqual(result['workflow']['remainingPairs'], 87)

    def test_real_daemon_status_uses_kernel_lock_not_saved_flag(self):
        self.daemon_root.mkdir()
        state = {'study': 'ADHC-001', 'enabled': True, 'stage': 'running',
                 'currentPackage': None, 'sceneIndex': 0, 'completedPairs': 0,
                 'runnerAlive': True}
        (self.daemon_root/'state.json').write_text(json.dumps(state))
        feed = module.ProductionFeed(self.root, self.daemon_root)
        self.assertFalse(feed.feed()['daemon']['runnerAlive'], 'saved boolean cannot prove a live runner')
        with (self.daemon_root/'runner.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX|fcntl.LOCK_NB)
            try:
                self.assertTrue(feed.feed()['daemon']['runnerAlive'])
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)


if __name__ == '__main__':
    unittest.main()
