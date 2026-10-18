import concurrent.futures
import json
from pathlib import Path
import re
import sqlite3
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'deployment/controller/tools/artwork'))
from images import digest
from service import make_server
from store import Store
from workers import BFL, builtin_packet, step, Rejected


def png(path, width=96, height=64):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    raw = b''.join(b'\0' + b''.join(bytes((x * 2 % 256, y * 3 % 256, 90)) for x in range(width)) for y in range(height))
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) +
                     chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


class FactoryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.store = Store(self.root / 'state')
        self.image = self.root / 'source.png'
        png(self.image)

    def tearDown(self):
        self.temp.cleanup()

    def enqueue(self, **changes):
        return self.store.enqueue({'scene': 'scene-001', 'name': 'Dunes', 'brief': 'Ochre dunes at dusk',
                                   'width': 96, 'height': 64, **changes})['id']

    def generate(self, **changes):
        job = self.enqueue(**changes)
        row = self.store.claim(changes.get('backend', 'builtin'), 'test')
        return job, row, self.store.complete(job, row['token'], self.image)

    def test_idempotent_requests_and_reference_content(self):
        first = self.enqueue(references=[{'path': str(self.image)}])
        second = self.enqueue(references=[{'path': str(self.image)}])
        self.assertEqual(first, second)
        png(self.image, 97, 64)
        self.assertNotEqual(first, self.enqueue(references=[{'path': str(self.image)}]))
        self.assertEqual(len(self.store.snapshot()['jobs']), 2)

    def test_subject_templates_do_not_add_architecture_to_nature(self):
        self.enqueue()
        prompt = self.store.snapshot()['jobs'][0]['spec']['prompt']
        self.assertNotIn('architectur', prompt)
        self.assertNotIn('religious', prompt)

    def test_cancellation_stops_unclaimed_work(self):
        job = self.enqueue()
        self.store.cancel(job, 'No longer needed')
        self.assertIsNone(self.store.claim('builtin', 'worker'))
        self.assertEqual(self.store.snapshot()['jobs'][0]['state'], 'cancelled')

    def test_bad_provider_settings_are_rejected_before_queue(self):
        for request in ({'backend': 'builtin', 'model': 'invented'},
                        {'backend': 'bfl', 'model': 'flux-2-klein-4b', 'settings': {'disable_pup': True}},
                        {'backend': 'bfl', 'settings': {'seed': 'not-a-number'}},
                        {'backend': 'builtin', 'settings': {'quality': 'invented'}}):
            with self.assertRaises(ValueError):
                self.enqueue(**request)
        self.assertEqual(self.store.snapshot()['jobs'], [])

    def test_atomic_claims_across_connections(self):
        for i in range(12):
            self.enqueue(variant=str(i))
        with concurrent.futures.ThreadPoolExecutor(8) as pool:
            rows = list(pool.map(lambda _: Store(self.store.root).claim('builtin', 'race'), range(20)))
        ids = [r['id'] for r in rows if r]
        self.assertEqual(len(ids), 12)
        self.assertEqual(len(set(ids)), 12)

    def test_expired_unknown_submission_never_auto_replays(self):
        job = self.enqueue()
        row = self.store.claim('builtin', 'old', seconds=-1)
        self.assertEqual(self.store.snapshot()['jobs'][0]['state'], 'uncertain')
        self.assertIsNone(Store(self.store.root).claim('builtin', 'new'))
        self.assertEqual(self.store.snapshot()['jobs'][0]['state'], 'uncertain')
        # A known late output can still reconcile this exact attempt.
        self.store.complete(job, row['token'], self.image)
        self.assertEqual(self.store.snapshot()['jobs'][0]['state'], 'generated')

    def test_retry_fences_previous_worker(self):
        job = self.enqueue()
        old = self.store.claim('builtin', 'old', seconds=-1)
        self.store.claim('builtin', 'reaper')
        self.store.retry(job, 'Confirmed no request was sent')
        new = self.store.claim('builtin', 'new')
        with self.assertRaises(ValueError):
            self.store.complete(job, old['token'], self.image)
        self.store.complete(job, new['token'], self.image)

    def test_remote_receipt_resumes_same_attempt_after_restart(self):
        job = self.enqueue(backend='bfl')
        row = self.store.claim('bfl', 'first')
        self.store.submitted(job, row['token'], {'id': 'remote-123'})
        self.store.defer(job, row['token'], 'restart', 0)
        resumed = Store(self.store.root).claim('bfl', 'second')
        self.assertEqual(resumed['attempt'], row['attempt'])
        self.assertEqual(resumed['tries'], 1)
        self.assertNotEqual(resumed['token'], row['token'])
        self.assertEqual(json.loads(resumed['remote'])['id'], 'remote-123')

    def test_receipts_are_idempotent_but_conflicting_source_is_rejected(self):
        job, row, version = self.generate()
        self.assertEqual(self.store.complete(job, row['token'], self.image), version)
        png(self.image, 97, 64)
        with self.assertRaises(ValueError):
            self.store.complete(job, row['token'], self.image)

    def test_wrong_dimensions_are_not_publishable(self):
        job = self.enqueue(width=128)
        row = self.store.claim('builtin', 'test')
        with self.assertRaises(ValueError):
            self.store.complete(job, row['token'], self.image)
        self.assertEqual(self.store.snapshot()['versions'], [])

    def test_explicit_review_and_compare_and_swap_selection(self):
        _, _, original = self.generate()
        self.store.review(original, 'accepted', 'Chosen by operator')
        _, _, candidate = self.generate(variant='rain')
        self.assertEqual(self.store.snapshot()['scenes'][0]['selected'], original)
        with self.assertRaises(ValueError):
            self.store.review(candidate, 'accepted', 'replace without acknowledgment')
        with self.assertRaises(ValueError):
            self.store.review(original, 'rejected', 'protected')
        self.store.review(candidate, 'accepted', 'Rain variation selected', expected_selected=original)
        self.assertEqual(len(self.store.snapshot()['versions']), 2)
        self.assertTrue(self.store.asset(original, 'full').is_file())

    def test_export_checks_hashes_and_excludes_pending(self):
        _, _, version = self.generate()
        empty = Path(self.store.export('before-review'))
        self.assertEqual(json.loads((empty / 'manifest.json').read_text())['entries'], [])
        self.store.review(version, 'accepted', 'Chosen')
        directory = Path(self.store.export('selected'))
        self.assertEqual(len(json.loads((directory / 'manifest.json').read_text())['entries']), 1)
        with self.assertRaises(ValueError):
            self.store.export('selected')
        self.store.asset(version, 'full').write_bytes(b'changed')
        with self.assertRaises(ValueError):
            self.store.export('corrupt')
        self.assertFalse((self.store.root / 'exports/corrupt').exists())

    def test_similarity_identifies_exact_duplicates_without_accepting(self):
        _, _, first = self.generate()
        _, _, second = self.generate(variant='second')
        result = self.store.similar(first)[0]
        self.assertEqual(result['id'], second)
        self.assertTrue(result['identical'])
        self.assertEqual(result['distance'], 0)
        self.assertTrue(all(v['state'] == 'pending' for v in self.store.snapshot()['versions']))

    def test_import_preserves_bytes_and_does_not_queue_generations(self):
        _, _, version = self.generate()
        full, small = self.store.asset(version, 'full'), self.store.asset(version, 'small')
        manifest = self.root / 'atlas.json'
        manifest.write_text(json.dumps({'scenes': [{'id': 'scene-150', 'name': 'Lagoon',
            'source': str(self.image), 'assets': {'full': str(full.relative_to(self.root)), 'small': str(small.relative_to(self.root))},
            'assetSha256': {'full': digest(full), 'small': digest(small)}}]}))
        clean = Store(self.root / 'imported')
        self.assertEqual(clean.import_atlas(manifest, self.root), 1)
        self.assertEqual(clean.import_atlas(manifest, self.root), 0)
        self.assertEqual(clean.snapshot()['jobs'], [])
        self.assertEqual(digest(clean.asset('import-scene-150', 'full')), digest(full))

    def test_builtin_packet_has_only_real_tool_arguments(self):
        self.enqueue()
        packet = builtin_packet(self.store.claim('builtin', 'agent'))
        self.assertEqual(set(packet['arguments']), {'prompt', 'transparent_background'})
        self.assertIn('96×64', packet['arguments']['prompt'])
        self.assertNotIn('image_url', packet)

    def test_bfl_pending_restart_and_cost_units(self):
        self.enqueue(backend='bfl')
        image = self.image
        class Fake:
            calls = 0
            polls = 0
            def submit(self, spec):
                self.calls += 1
                return {'id': 'known', 'cost': 4}
            def poll(self, receipt):
                self.polls += 1
                return {'status': 'Pending'} if self.polls == 1 else {'status': 'Ready', 'result': {'sample': 'fixture'}, 'cost': 3}
            def download(self, url, path):
                path.write_bytes(image.read_bytes())
        fake = Fake()
        step(self.store, 'bfl', fake)
        with self.store.db() as db:
            db.execute('UPDATE jobs SET available=0')
        step(Store(self.store.root), 'bfl', fake)
        self.assertEqual(fake.calls, 1)
        self.assertEqual(self.store.snapshot()['jobs'][0]['state'], 'generated')
        self.assertEqual(self.store.snapshot()['metrics']['knownCost'], {'BFL credits': 3})

    def test_bfl_wire_contract_keeps_key_on_api_origin(self):
        self.enqueue(backend='bfl', references=[{'path': str(self.image), 'role': 'edit-target'}])
        spec = self.store.snapshot()['jobs'][0]['spec']
        adapter = BFL(key='test-key')
        with patch('workers.request_json', return_value={'id': 'remote', 'polling_url': 'https://untrusted.example/'}) as wire:
            receipt = adapter.submit(spec)
            url, body, headers = wire.call_args.args
            self.assertEqual(url, 'https://api.bfl.ai/v1/flux-2-pro')
            self.assertEqual(headers, {'x-key': 'test-key'})
            self.assertEqual(body['output_format'], 'png')
            self.assertTrue(body['input_image'].startswith('iVBOR'))
            self.assertIn('Image 1: edit-target', body['prompt'])
            adapter.poll(receipt)
            self.assertEqual(wire.call_args.args[0], 'https://api.bfl.ai/v1/get_result?id=remote')

    def test_ambiguous_network_failure_does_not_resubmit(self):
        self.enqueue(backend='bfl')
        class Fake:
            def submit(self, spec):
                raise TimeoutError('after provider accepted request')
        step(self.store, 'bfl', Fake())
        self.assertEqual(self.store.snapshot()['jobs'][0]['state'], 'uncertain')
        self.assertFalse(step(self.store, 'bfl', Fake()))

    def test_rate_limit_retries_are_bounded(self):
        self.enqueue(backend='bfl')
        class Fake:
            def submit(self, spec):
                raise Rejected(429)
        for _ in range(3):
            step(self.store, 'bfl', Fake())
            with self.store.db() as db:
                db.execute('UPDATE jobs SET available=0')
        self.assertEqual(self.store.snapshot()['jobs'][0]['state'], 'failed')
        self.assertFalse(step(self.store, 'bfl', Fake()))

    def test_command_worker_runs_real_subprocess_and_saves_receipt(self):
        self.enqueue(backend='command', model='fixture')
        script = self.root / 'model.py'
        script.write_text('import json,sys,pathlib,shutil\np=json.load(sys.stdin)\n'
                          f's=pathlib.Path(p["outputDirectory"])/"result.png"\nshutil.copyfile({str(self.image)!r},s)\n'
                          'print(json.dumps({"source":str(s),"cost":0,"currency":"USD"}))\n')
        step(self.store, 'command', argv=[sys.executable, str(script)])
        self.assertEqual(self.store.snapshot()['jobs'][0]['state'], 'generated')
        self.assertTrue(list((self.store.root / 'work').glob('*/receipt.json')))

    def test_http_origin_token_and_path_boundaries(self):
        server = make_server(self.store, 0)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        base = f'http://127.0.0.1:{server.server_port}'
        try:
            html = urlopen(base).read().decode()
            token = re.search(r'name="artwork-token" content="([^"]+)"', html)[1]
            self.assertTrue(json.load(urlopen(base + '/api/health'))['ok'])
            data = json.dumps({'scene': 'new', 'brief': 'Quiet sea'}).encode()
            for headers in ({}, {'X-Artwork-Token': token, 'Origin': 'https://outside.example'},
                            {'X-Artwork-Token': token, 'Host': 'outside.example'}):
                with self.assertRaises(HTTPError) as context:
                    urlopen(Request(base + '/api/enqueue', data, headers={'Content-Type': 'application/json', **headers}))
                self.assertEqual(context.exception.code, 403)
                context.exception.close()
            response = urlopen(Request(base + '/api/enqueue', data,
                headers={'Content-Type': 'application/json', 'X-Artwork-Token': token}))
            self.assertIn('id', json.load(response))
            with self.assertRaises(HTTPError) as context:
                urlopen(base + '/asset/../../queue.sqlite3')
            context.exception.close()
        finally:
            server.shutdown(); server.server_close(); thread.join()

    def test_metrics_do_not_present_unknown_cost_as_free(self):
        self.generate()
        metrics = self.store.snapshot()['metrics']
        self.assertEqual(metrics['unknownCostAttempts'], 1)
        self.assertEqual(metrics['knownCost'], {})
        self.assertEqual(metrics['knownCostPerAcceptedVersion'], {})

    def test_backup_contains_consistent_database_and_verified_assets(self):
        _, _, version = self.generate()
        self.store.review(version, 'accepted', 'Keep this one')
        path = Path(self.store.backup('recovery'))
        self.assertTrue(json.loads((path / 'backup.json').read_text())['complete'])
        with sqlite3.connect(path / 'queue.sqlite3') as db:
            self.assertEqual(db.execute('SELECT selected FROM scenes').fetchone()[0], version)
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
        self.assertEqual(digest(path / 'versions' / version / 'full.webp'), digest(self.store.asset(version, 'full')))
        with self.assertRaises(FileExistsError):
            self.store.backup('recovery')


if __name__ == '__main__':
    unittest.main()
