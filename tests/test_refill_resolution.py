import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import types
import unittest
from unittest.mock import patch


class RefillResolution(unittest.TestCase):
    def test_new_requests_keep_model_specific_resolution_and_existing_sampling(self):
        source = Path(__file__).resolve().parents[1] / 'deployment/controller/tools/artwork/remote/refill.py'
        spec = importlib.util.spec_from_file_location('refill_resolution', source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        requests = []

        class Store:
            def __init__(self, root):
                pass

            def enqueue(self, request):
                requests.append(request)
                return {'id': str(len(requests))}

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'docs/artwork').mkdir(parents=True)
            (root / 'docs/artwork/geographic-scenes.json').write_text(json.dumps({'scenes': [{'id': 'scene', 'name': 'Scene', 'prompt': 'Existing authorized scene'}]}))
            state = root / 'state'
            state.mkdir()
            with sqlite3.connect(state / 'queue.sqlite3') as connection:
                connection.execute('CREATE TABLE jobs (scene TEXT, spec TEXT, state TEXT, backend TEXT)')
            with patch.object(module, 'REPO', root), patch.object(module, 'STATE', state), patch.object(module, 'RUNTIME', state / 'generation-refill'), patch.dict('sys.modules', {'store': types.SimpleNamespace(Store=Store)}), patch('builtins.print'):
                module.refill()
        self.assertEqual(len(requests), 6)
        for model, size in [('flux1-dev', 512), ('flux2-dev-nf4', 1024)]:
            own = [request for request in requests if request['model'] == model]
            self.assertEqual(len(own), 3)
            self.assertTrue(all((request['width'], request['height']) == (size, size) for request in own))
            self.assertTrue(all(request['settings']['steps'] == 28 and request['settings']['guidance_scale'] == 3.5 for request in own))
            self.assertEqual([request['settings']['seed'] for request in own], [42, 43, 44])


if __name__ == '__main__':
    unittest.main()
