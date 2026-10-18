from contextlib import closing
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from agent_dispatch import dispatch_tick, initialize
from task_inbox import REPO, connect

ROOT = '01a14bd7-2140-7cd2-8c7d-daf97ae093ed'
CHILD = '01a14bd7-2140-7cd2-8c7d-daf97ae093ee'


class DispatchTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.db = connect(self.base / 'inbox.sqlite')
        self.addCleanup(self.db.close)
        initialize(self.db)
        self.state = self.base / 'state.sqlite'
        with closing(sqlite3.connect(self.state, isolation_level=None)) as state:
            state.execute('CREATE TABLE threads(id,agent_path,cwd,archived,source)')
            state.execute('INSERT INTO threads VALUES(?,?,?,?,?)', (CHILD, '/root/ui', str(REPO), 0,
                json.dumps({'subagent': {'thread_spawn': {'parent_thread_id': ROOT}}})))
        self.team = self.base / 'team.json'
        self.monitor = self.base / 'status.json'
        self.tasks = self.base / 'tasks.json'
        self.team.write_text(json.dumps({'rootThread': ROOT}))
        self.agents = {'rootThread': ROOT, 'observedAt': '2026-10-18T18:00:00Z', 'ok': True, 'live': True,
                       'agents': [{'id': '/root/ui', 'status': 'done'}]}
        self.task = {'id': 'DOCS', 'owner': 'ui', 'status': 'next', 'readiness': {
            'ready': True, 'authorized': True, 'blocked': False, 'scope': 'local'}}
        self.runner = Mock(return_value=Mock(returncode=0))

    def tick(self):
        self.monitor.write_text(json.dumps({'agents': self.agents}))
        self.tasks.write_text(json.dumps({'tasks': [self.task]}))
        return dispatch_tick(self.db, self.monitor, self.tasks, self.team, 'codex', self.state,
                             current_time=1792346401, runner=self.runner)

    def test_claim_before_queue_and_no_replay(self):
        def queue(*args, **kwargs):
            self.assertEqual(self.db.execute('SELECT state FROM agent_dispatch').fetchone()[0], 'sending')
            self.assertEqual(args[0][3], CHILD)
            return Mock(returncode=0)
        self.runner.side_effect = queue
        self.assertEqual(self.tick()[0]['state'], 'queued')
        self.assertEqual(self.tick(), [])
        self.runner.assert_called_once()

    def test_ambiguous_result_and_restart_never_replay(self):
        self.runner.side_effect = subprocess.TimeoutExpired('codex', 30)
        self.assertEqual(self.tick()[0]['state'], 'uncertain')
        initialize(self.db)
        self.assertEqual(self.tick(), [])
        self.runner.assert_called_once()

    def test_interrupted_delivery_is_reserved_after_restart(self):
        self.tick()
        self.db.execute("UPDATE agent_dispatch SET state='sending'")
        initialize(self.db)
        self.assertEqual(self.db.execute('SELECT state FROM agent_dispatch').fetchone()[0], 'uncertain')
        self.task['id'] = 'OTHER'
        self.assertEqual(self.tick(), [])
        self.runner.assert_called_once()

    def test_ineligible_and_stale_sources(self):
        for field, value in [('archived', True), ('paused', True), ('owner', 'root'), ('dispatchable', False)]:
            original = self.task.copy()
            self.task[field] = value
            self.assertEqual(self.tick(), [])
            self.task = original
        for field, value in [('status', 'unknown'), ('status', 'running')]:
            self.agents['agents'][0][field] = value
            self.assertEqual(self.tick(), [])
        self.agents['agents'][0]['status'] = 'done'
        self.agents['rootThread'] = CHILD
        self.assertEqual(self.tick(), [])
        self.agents['rootThread'] = ROOT
        self.agents['observedAt'] = '2026-10-18T17:59:00Z'
        self.assertEqual(self.tick(), [])
        self.runner.assert_not_called()

    def test_unready_and_other_parent(self):
        self.task['readiness']['authorized'] = False
        self.assertEqual(self.tick(), [])
        self.task['readiness']['authorized'] = True
        with closing(sqlite3.connect(self.state, isolation_level=None)) as state:
            state.execute('UPDATE threads SET source=?', (json.dumps({'subagent': {'thread_spawn': {'parent_thread_id': CHILD}}}),))
        self.assertEqual(self.tick(), [])
        self.runner.assert_not_called()

    def test_explicit_child_rejection_queues_exact_mechanical_adapter(self):
        rejection = Mock(returncode=1, stderr=b'Error: direct app-server input is not allowed for multi-agent v2 sub-agents (code -32600)')
        self.runner.side_effect = [rejection, Mock(returncode=0)]
        events = self.tick()
        self.assertEqual(events[-1]['state'], 'adapter_queued')
        first, second = self.runner.call_args_list
        self.assertEqual(first.args[0][3], CHILD)
        self.assertEqual(second.args[0][3], ROOT)
        self.assertIn('collaboration.followup_task', second.args[0][-1])
        self.assertIn('/root/ui', second.args[0][-1])
        self.assertIn(CHILD, second.args[0][-1])
        self.assertEqual(self.tick(), [])
        self.assertEqual(self.runner.call_count, 2)

    def test_unknown_failure_never_uses_adapter(self):
        self.runner.return_value = Mock(returncode=1, stderr=b'Unclassified failure')
        self.assertEqual(self.tick()[0]['state'], 'uncertain')
        self.runner.assert_called_once()

    def test_lifecycle_evidence_updates_claim_without_requeue(self):
        self.tick()
        self.db.execute("UPDATE agent_dispatch SET claimed_at='2026-10-18T17:59:00Z'")
        self.agents['agents'][0].update(status='running', currentTaskId='DOCS', lastTransitionAt='2026-10-18T18:00:00Z')
        self.assertEqual(self.tick(), [])
        self.assertEqual(self.db.execute('SELECT state FROM agent_dispatch').fetchone()[0], 'running')
        self.agents['agents'][0].update(status='done', lastTransitionAt='2026-10-18T18:00:01Z')
        self.assertEqual(self.tick(), [])
        self.assertEqual(self.db.execute('SELECT state FROM agent_dispatch').fetchone()[0], 'completed')
        self.runner.assert_called_once()

    def test_one_worker_reserved_across_tasks(self):
        self.tick()
        self.task['id'] = 'DOCS2'
        self.assertEqual(self.tick(), [])
        self.runner.assert_called_once()


if __name__ == '__main__':
    unittest.main()
