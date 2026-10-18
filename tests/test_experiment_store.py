"""Check incremental publication without rendering or viewing images."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('experiment_store', Path(__file__).resolve().parents[1]/'scripts/worlds/experiment_store.py')
store = importlib.util.module_from_spec(spec)
spec.loader.exec_module(store)

class PublicationTests(unittest.TestCase):
    def test_immutable_capture_hash_is_computed_once_and_replaced_bytes_invalidate(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            directory = root/'.runtime/worlds/method1/run'
            directory.mkdir(parents=True)
            capture = directory/'one.png'
            capture.write_bytes(b'first numerical artifact')
            store._images.clear()
            with patch.object(store, 'REPO', root), patch.object(store.hashlib, 'sha256', wraps=store.hashlib.sha256) as digest:
                first = store.image(capture)
                self.assertEqual(store.image(capture), first)
                self.assertEqual(digest.call_count, 1)
                capture.write_bytes(b'changed artifact bytes')
                self.assertNotEqual(store.image(capture)['sha256'], first['sha256'])
                self.assertEqual(digest.call_count, 2)

    def test_progress_reuses_previous_candidates_and_appends_new_records(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            store._progress.clear()
            for index in (1, 2):
                (directory/f'candidate-{index:02}.json').write_text('{"parameters":[1,2,3]}')
            first = {'id': 1, 'render': 'a.png', 'components': {'weighted_total': .4}}
            second = {'id': 2, 'render': 'b.png', 'components': {'weighted_total': .3}}
            with patch.object(store, 'image', side_effect=lambda path: {'url':str(path)}) as capture:
                one = store.candidate_records(directory, [first])
                two = store.candidate_records(directory, [first, second])
                self.assertIs(one[0], two[0])
                self.assertEqual(capture.call_count, 2)
                self.assertEqual(two[1]['recipe']['parameters'], [1,2,3])
                self.assertNotIn('render', two[1])

if __name__ == '__main__':
    unittest.main()
