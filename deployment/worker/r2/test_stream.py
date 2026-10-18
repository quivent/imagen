"""Isolated archive failure tests using opaque bytes, never generated images."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest

sys.path.insert(0, str(Path(__file__).parent))
spec = importlib.util.spec_from_file_location('archive_stream', Path(__file__).with_name('stream.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Fault(Exception):
    def __init__(self, code): self.response = {'Error': {'Code': code}}

class S3:
    def __init__(self): self.data = {}; self.fail_key = None; self.puts = []
    def head_object(self, Bucket, Key):
        if Key not in self.data: raise Fault('404')
        body, meta = self.data[Key]
        return {'ContentLength': len(body), 'Metadata': meta, 'ETag': '"' + m.hashlib.sha256(body).hexdigest() + '"'}
    def get_object(self, Bucket, Key):
        h = self.head_object(Bucket, Key)
        return {**h, 'Body': io.BytesIO(self.data[Key][0])}
    def put_object(self, Bucket, Key, Body, Metadata, ContentType, **condition):
        if Key == m.INDEX_KEY:
            assert threading.current_thread() is threading.main_thread(), 'Mutable index must have one serial writer'
        if self.fail_key == Key: self.fail_key = None; raise Fault('InjectedOutage')
        if condition.get('IfNoneMatch') == '*' and Key in self.data: raise Fault('412')
        if 'IfMatch' in condition and (Key not in self.data or self.head_object(Bucket, Key)['ETag'] != condition['IfMatch']): raise Fault('412')
        self.data[Key] = (Body, Metadata); self.puts.append(Key)
        return {'ETag': self.head_object(Bucket, Key)['ETag']}

class ReconcileTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        m.ROOT = Path(self.tmp.name) / 'r2'; m.ROOT.mkdir()
        m.JOBS = (Path(self.tmp.name) / 'jobs').resolve()
        m.EXTRA_JOBS = (Path(self.tmp.name) / 'gpu1-jobs',)
        self.ident = 'flux1-dev/ordinary-existing-job'
        self.path = m.JOBS / self.ident / 'result.png'; self.path.parent.mkdir(parents=True)
        self.path.write_bytes(b'opaque archived byte fixture, not an image')
        digest = m.upstream.sha256_file(self.path)
        (self.path.parent/'receipt.json').write_text(json.dumps({'id': self.path.parent.name, 'profile': 'flux1-dev', 'source': str(self.path), 'sha256': digest}))
        (self.path.parent/'job.json').write_text(json.dumps({'status': 'done', 'finished': time.time()-100, 'receipt': {'sha256': digest}}))
        import os
        os.utime(self.path, (time.time()-10, time.time()-10))
        self.s3 = S3(); self.index = m.StudyIndex(self.s3, 'bucket')
        self.r = m.Reconciler(m.ImmutableUploads(self.s3), 'bucket', self.index)
        self.image_key = m.PREFIX+self.ident+'/result.png'; self.receipt_key=m.PREFIX+self.ident+'/receipt.json'
    def retry(self):
        self.r.entries[self.ident]['nextAttemptAt'] = 0
        return self.r.cycle()
    def test_second_lane_uses_same_logical_profile_and_single_index(self):
        import os
        image=m.EXTRA_JOBS[0]/'flux1-dev/gpu1-unique-job/result.png';image.parent.mkdir(parents=True)
        image.write_bytes(b'second opaque fixture')
        digest=m.upstream.sha256_file(image)
        (image.parent/'receipt.json').write_text(json.dumps({'id':image.parent.name,'profile':'flux1-dev','source':str(image),'sha256':digest}))
        (image.parent/'job.json').write_text(json.dumps({'status':'done','finished':time.time()-100,'receipt':{'sha256':digest}}))
        os.utime(image,(time.time()-10,time.time()-10))
        status=self.r.cycle()
        self.assertEqual(status['completedJobs'],2);self.assertEqual(status['pendingJobs'],0)
        self.assertIn('flux1-dev/gpu1-unique-job',self.index.jobs)
        self.assertEqual(self.index.jobs['flux1-dev/gpu1-unique-job']['profile'],'flux1-dev')
        self.assertIn(m.PREFIX+'flux1-dev/gpu1-unique-job/result.png',self.s3.data)
    def test_partial_upload_retries_without_replacing_image(self):
        self.s3.fail_key = self.receipt_key
        status = self.r.cycle(); self.assertEqual(status['pendingJobs'],1); self.assertEqual(status['status'],'degraded')
        self.assertGreater(self.r.entries[self.ident]['nextAttemptAt'],time.time())
        self.assertIn(self.image_key,self.s3.data); self.assertNotIn(self.receipt_key,self.s3.data)
        self.r = m.Reconciler(m.ImmutableUploads(self.s3),'bucket',self.index)
        self.assertEqual(self.r.entries[self.ident]['errorCode'],'InjectedOutage')
        self.assertEqual(self.retry()['pendingJobs'],0)
        self.assertEqual(self.s3.puts.count(self.image_key),1)
    def test_index_failure_never_acknowledges_and_recovers(self):
        self.s3.fail_key=m.INDEX_KEY
        self.assertEqual(self.r.cycle()['pendingJobs'],1)
        self.assertFalse((m.ROOT/'receipts/flux1-dev/ordinary-existing-job.json').exists())
        self.assertEqual(self.retry()['pendingJobs'],0)
        self.assertIn(self.ident,self.index.jobs)
    def test_periodic_verification_repairs_missing_object(self):
        self.assertEqual(self.r.cycle()['pendingJobs'],0)
        del self.s3.data[self.image_key]
        self.r.entries[self.ident]['contentVerifiedAt']=time.time()-601
        self.assertEqual(self.r.cycle()['pendingJobs'],0)
        self.assertIn(self.image_key,self.s3.data)
        self.assertEqual(self.s3.puts.count(self.image_key),2)
    def test_conflicting_object_is_preserved_and_alerted(self):
        self.s3.data[self.image_key]=(b'conflict',{'sha256':'wrong'})
        status=self.r.cycle()
        self.assertEqual(status['pendingJobs'],1);self.assertEqual(status['errorCount'],1)
        self.assertEqual(self.s3.data[self.image_key][0],b'conflict')
    def test_forged_metadata_does_not_substitute_for_byte_hash(self):
        original=self.path.read_bytes()
        self.s3.data[self.image_key]=(b'X'*len(original),{'sha256':m.hashlib.sha256(original).hexdigest()})
        self.assertEqual(self.r.cycle()['errorCount'],1)
        self.assertEqual(self.s3.data[self.image_key][0],b'X'*len(original))
    def test_done_job_with_missing_image_is_durable_backlog(self):
        self.path.unlink()
        status=self.r.cycle()
        self.assertEqual(status['completedJobs'],1)
        self.assertEqual(status['pendingJobs'],1)
        self.assertEqual(status['errorCount'],1)
    def test_done_job_with_missing_receipt_is_durable_backlog(self):
        (self.path.parent/'receipt.json').unlink()
        self.assertEqual(self.r.cycle()['pendingJobs'],1)
    def test_unconfirmed_new_job_precedes_old_verification(self):
        self.r.cycle()
        self.r.entries[self.ident]['contentVerifiedAt']=time.time()-601
        self.assertEqual(self.r.save({self.ident:self.path})['verificationDueJobs'],1)
        self.assertEqual(self.r.save({self.ident:self.path})['status'],'degraded')
    def test_new_archive_is_not_starved_by_old_verifications(self):
        import os
        def clone(name):
            image=self.path.parent.parent/name/'result.png'
            image.parent.mkdir()
            image.write_bytes(self.path.read_bytes())
            receipt=json.loads((self.path.parent/'receipt.json').read_text())
            receipt.update(id=name,source=str(image))
            (image.parent/'receipt.json').write_text(json.dumps(receipt))
            (image.parent/'job.json').write_text((self.path.parent/'job.json').read_text())
            os.utime(image,(time.time()-10,time.time()-10))
            return image
        for n in range(5): clone('old-'+str(n))
        for _ in range(2): self.r.cycle()
        for e in self.r.entries.values(): e['contentVerifiedAt']=0
        new=clone('zz-new-urgent')
        status=self.r.cycle()
        self.assertIn('flux1-dev/zz-new-urgent',self.index.jobs)
        self.assertEqual(status['pendingJobs'],0)

if __name__=='__main__': unittest.main()
