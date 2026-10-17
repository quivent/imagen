import importlib.util
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import tempfile
import types
import unittest
from unittest.mock import patch


class RefillSteps(unittest.TestCase):
    def test_saved_per_model_steps_apply_only_to_new_jobs(self):
        source = Path(__file__).resolve().parents[1] / 'deployment/controller/tools/artwork/remote/refill.py'
        spec = importlib.util.spec_from_file_location('refill_steps', source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'docs/artwork').mkdir(parents=True)
            (root / 'docs/artwork/geographic-scenes.json').write_text(json.dumps({'scenes': [{'id': 'scene', 'name': 'Scene', 'prompt': 'Recorded prompt'}]}))
            state = root / 'state'
            runtime = state / 'generation-refill'
            runtime.mkdir(parents=True)
            database = state / 'queue.sqlite3'
            with closing(sqlite3.connect(database)) as db, db:
                db.execute('CREATE TABLE jobs(scene TEXT,spec TEXT,state TEXT,backend TEXT)')
            class Store:
                def __init__(self, _state):
                    pass
                def enqueue(self, request):
                    with closing(sqlite3.connect(database)) as db, db:
                        result = db.execute('INSERT INTO jobs VALUES(?,?,?,?)', (request['scene'], json.dumps(request), 'queued', 'command'))
                        return {'id': str(result.lastrowid)}
            def save(left, right):
                (runtime / 'settings.json').write_text(json.dumps({'modelSteps': {'flux1-dev': left, 'flux2-dev-nf4': right}}))
            def rows():
                with closing(sqlite3.connect(database)) as db, db:
                    return [json.loads(row[0]) for row in db.execute('SELECT spec FROM jobs ORDER BY rowid')]
            with patch.object(module, 'REPO', root), patch.object(module, 'STATE', state), patch.object(module, 'RUNTIME', runtime), patch.dict('sys.modules', {'store': types.SimpleNamespace(Store=Store)}), patch('builtins.print'):
                save(16, 50)
                module.refill()
                original = rows()
                self.assertEqual(len(original), 6)
                self.assertEqual([r['settings']['steps'] for r in original], [16] * 3 + [50] * 3)
                save(8, 60)
                module.refill()
                self.assertEqual(rows(), original, 'already queued jobs stay unchanged')
                with closing(sqlite3.connect(database)) as db, db:
                    db.execute("UPDATE jobs SET state='done'")
                module.refill()
                final = rows()
                self.assertEqual(final[:6], original)
                self.assertEqual([r['settings']['steps'] for r in final[6:]], [8] * 3 + [60] * 3)
                save(0, 60)
                with self.assertRaises(ValueError):
                    module.refill()
                self.assertEqual(rows(), final, 'invalid settings cannot enqueue jobs')
