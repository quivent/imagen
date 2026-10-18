"""The research entry point must never inherit the production queue implicitly."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class EntryPointTest(unittest.TestCase):
    def test_isolated_state_and_explicit_override_work_outside_checkout(self):
        entry = Path(__file__).resolve().parents[1]/'artwork.py'
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            environment = {**os.environ, 'ARTWORK_STATE': str(root/'production-one'),
                           'ARTWORK_FACTORY_STATE': str(root/'production-two'),
                           'ARTWORK_RESEARCH_STATE': str(root/'research')}
            result = subprocess.run([sys.executable, '-B', str(entry), 'status'],
                                    cwd=root, env=environment, check=True, capture_output=True, text=True)
            self.assertEqual(json.loads(result.stdout)['jobs'], [])
            self.assertTrue((root/'research/queue.sqlite3').exists())
            self.assertFalse((root/'production-one').exists())
            self.assertFalse((root/'production-two').exists())
            subprocess.run([sys.executable, '-B', str(entry), '--state', str(root/'explicit'), 'status'],
                           cwd=root, env=environment, check=True, capture_output=True)
            self.assertTrue((root/'explicit/queue.sqlite3').exists())


if __name__ == '__main__':
    unittest.main()
