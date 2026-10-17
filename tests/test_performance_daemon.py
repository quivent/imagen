from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import performance_daemon as daemon
from task_inbox import connect


def stamp(seconds):
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat().replace('+00:00', 'Z')


def canonical(wall, status='done', transition=1010):
    return {'agents': {'ok': True, 'live': True, 'observedAt': stamp(wall), 'agents': [{'id': '/root/performance', 'status': status, 'lastTransitionAt': stamp(transition)}]}}


def healthy(wall):
    return {'type': 'sample', 'observedAt': stamp(wall)}


class PerformanceDaemonTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.db = connect(Path(self.directory.name) / 'inbox.sqlite3')
        self.state = {'startedAt': stamp(1000), 'mandateStartedAt': stamp(1000), 'mandateActive': True}

    def tearDown(self):
        self.db.close()
        self.directory.cleanup()

    def requests(self):
        return self.db.execute('SELECT * FROM inbox').fetchall()

    def test_idle_wake_is_once_per_fresh_transition_durable_across_restart(self):
        daemon.tick(self.state, healthy(1012), canonical(1012), self.db, 1012)
        daemon.tick(self.state, healthy(1015), canonical(1015), self.db, 1015)
        self.assertEqual(len(self.requests()), 1)
        self.assertEqual(self.requests()[0]['requested_assignee'], 'performance')
        self.assertIsNone(self.requests()[0]['requested_priority'])
        restored = json.loads(json.dumps(self.state))
        restored['startedAt'] = stamp(1014)
        daemon.tick(restored, healthy(1016), canonical(1016), self.db, 1016)
        self.assertEqual(len(self.requests()), 1)
        daemon.tick(restored, healthy(1020), canonical(1020, transition=1019), self.db, 1020)
        self.assertEqual(len(self.requests()), 2)

    def test_stale_unknown_running_and_pre_restart_lifecycle_do_not_wake(self):
        for observation in [canonical(990), canonical(1012, status='unknown'), canonical(1012, status='running'), canonical(1012, transition=999), {}]:
            daemon.tick(self.state, healthy(1012), observation, self.db, 1012)
        self.assertEqual(len(self.requests()), 0)
        self.state['mandateActive'] = False
        daemon.tick(self.state, healthy(1012), canonical(1012), self.db, 1012)
        self.assertEqual(len(self.requests()), 0)

    def test_daemon_watches_engineer_only_and_unknown_lifecycle_never_becomes_idle(self):
        daemon.tick(self.state, {'observedAt': stamp(1010)}, canonical(1010, 'running'), self.db, 1010)
        self.assertEqual(self.state['state'], 'watching')
        self.assertEqual(self.state['agentState'], 'running')
        self.assertEqual(len(self.requests()), 0)
        daemon.tick(self.state, None, canonical(1010, 'done'), self.db, 1035)
        self.assertEqual(self.state['state'], 'blocked')
        self.assertEqual(self.state['agentState'], 'unknown')
        self.assertEqual(len(self.requests()), 0)
        self.assertNotIn('endpoints', self.state)
        self.assertNotIn('issues', self.state)

    def test_lifecycle_events_are_bounded_and_notification_status_is_real(self):
        self.state['events'] = [{'at': stamp(1010), 'event': 'coordinator_wake_queued'}] * 150
        daemon.tick(self.state, {'observedAt': stamp(1012)}, canonical(1012), self.db, 1012)
        self.assertEqual(len(self.state['events']), 100)
        self.assertEqual(self.state['wakeState'], 'pending')
        self.db.execute("UPDATE inbox SET state='acked'")
        daemon.tick(self.state, {'observedAt': stamp(1013)}, canonical(1013), self.db, 1013)
        self.assertEqual(self.state['wakeState'], 'acked')


if __name__ == '__main__':
    unittest.main()
