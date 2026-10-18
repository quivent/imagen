import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

TOOLS=Path(__file__).resolve().parents[1];sys.path.insert(0,str(TOOLS))
import prompt_clarity as study
import study_controller as controller

class ControllerTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name).resolve();self.package=study.prepare(self.root);self.c=controller.Controller(self.package['id'],self.root);self.calls=[]
  self.revision=json.loads((study.REPO/'deployment/worker/models/pins.json').read_text())['models']['flux1']['revision']
  self.store=self.c.store()
  # The factory's image conversion is separately tested. Here mark completion
  # after the controller has independently verified our synthetic receipt.
  def complete(job,token,source,*args,**kw):
   with self.store.db() as db:db.execute("UPDATE jobs SET state='generated' WHERE id=? AND token=?",(job,token))
  self.completion=patch.object(type(self.store),'complete',side_effect=complete);self.completion.start()
 def tearDown(self):self.completion.stop();self.temp.cleanup()
 def proof(self,p):return {'ready':True,'revision':self.revision,'tokens':{}}
 def adapter(self,packet):
  self.calls.append(packet['job']);spec=packet['spec'];settings=spec['settings'];directory=Path(packet['outputDirectory']);directory.mkdir(parents=True,exist_ok=True);source=directory/'result.png'
  source.write_bytes(b'\x89PNG\r\n\x1a\n'+b'\x00\x00\x00\rIHDR'+struct.pack('>II',spec['width'],spec['height'])+b'synthetic-numerical-fixture')
  return {'source':str(source),'generation':{'id':packet['job'],'profile':'flux1-dev','prompt':spec['prompt'],'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'seed':settings['seed'],'parameters':{'width':spec['width'],'height':spec['height'],'num_inference_steps':settings['steps'],'guidance_scale':settings['guidance_scale'],'max_sequence_length':settings['max_sequence_length']},'precision':{'transformer_dtype':'torch.bfloat16','text_encoder_4bit':False},'generation_seconds':3.5,'packages':{'torch':'test-version'},'model_manifest':{'models':{'flux1':{'revision':self.revision}}}}}
 def test_first_pair_review_then_budget_complete_and_blinding(self):
  self.c.guidance({'maxPairs':2,'reviewEvery':1,'focus':'Keep composition clear'})
  self.c.arm();deadline=self.c.read()['expiresAt'];self.c.arm();self.assertEqual(self.c.read()['expiresAt'],deadline)
  self.c.run(self.proof,self.adapter);s=self.c.public();self.assertEqual(s['stage'],'waiting-review');self.assertEqual(len(self.calls),2);self.assertIsNone(s['pairs'][0]['revealedArms']);self.assertNotIn('arms',s['pairs'][0])
  self.c.review('pair-01','left','Prefer the spatial clarity',True);self.c.run(self.proof,self.adapter)
  self.assertEqual(len(self.calls),4);self.assertEqual(self.c.public()['completedPairs'],2)
  self.c.review('pair-02','tie','',True);self.assertEqual(self.c.public()['stage'],'complete');self.assertEqual(self.c.public()['report']['reviewedPairs'],2);self.assertEqual(self.c.public()['report']['preferences']['tie'],1);self.assertTrue((self.c.directory/'report.json').exists());self.assertFalse(self.c.read()['enabled']);self.c.run(self.proof,self.adapter);self.assertEqual(len(self.calls),4)
 def test_ambiguous_request_is_not_replayed_and_local_receipt_can_reconcile(self):
  self.c.arm()
  def uncertain(packet):
   receipt=self.adapter(packet);controller.atomic(Path(packet['outputDirectory'])/'generation.json',receipt);raise RuntimeError('transport stopped after remote completion')
  self.c.run(self.proof,uncertain);self.assertEqual(self.c.public()['stage'],'needs-attention');self.assertEqual(len(self.calls),1)
  with self.assertRaises(ValueError):self.c.arm()
  self.c.reconcile();self.assertEqual(self.c.public()['stage'],'paused');self.c.arm();self.c.run(self.proof,self.adapter);self.assertEqual(len(self.calls),2);self.assertEqual(self.c.public()['completedPairs'],1)
 def test_missing_receipt_stays_stopped_and_runtime_drift_never_imports(self):
  self.c.arm();self.c.run(self.proof,lambda packet:(_ for _ in ()).throw(RuntimeError('unknown submission')))
  with self.assertRaises(ValueError):self.c.reconcile()
  self.assertEqual(self.c.public()['stage'],'needs-attention')
 def test_control_mismatch_stops_without_importing_the_pair(self):
  self.c.arm()
  def wrong(packet):r=self.adapter(packet);r['generation']['parameters']['num_inference_steps']=50;return r
  self.c.run(self.proof,wrong);self.assertEqual(self.c.public()['completedPairs'],0);self.assertEqual(self.c.public()['stage'],'needs-attention');self.assertEqual(len(self.calls),1)
 def test_pause_during_first_image_and_resume_uses_the_same_receipt(self):
  self.c.arm()
  def pause(packet):r=self.adapter(packet);self.c.pause();return r
  self.c.run(self.proof,pause);self.assertEqual(len(self.calls),1);self.assertEqual(self.c.public()['stage'],'paused')
  self.c.arm();self.c.run(self.proof,self.adapter);self.assertEqual(len(self.calls),2);self.assertEqual(self.c.public()['completedPairs'],1)
 def test_failed_preflight_never_submits_and_can_be_cleared_without_a_queue(self):
  self.c.arm();self.c.run(lambda p:{'ready':False,'problem':'Worker is not ready'},self.adapter);self.assertEqual(self.calls,[]);self.assertEqual(self.c.public()['stage'],'needs-attention')
 def test_runtime_drift_stops_before_import(self):
  self.c.arm()
  def drift(packet):
   r=self.adapter(packet)
   if len(self.calls)>1:r['generation']['packages']['torch']='changed-runtime'
   return r
  self.c.run(self.proof,drift);self.assertEqual(self.c.public()['stage'],'needs-attention');self.assertEqual(self.c.public()['completedPairs'],0);self.assertEqual(len(self.calls),2)
 def test_restart_after_both_receipts_reconciles_without_any_new_images(self):
  self.c.arm();update=self.c.update
  def interrupt(fn,event=None):
   if event=='Pair imported into the study':raise SystemExit('Synthetic process interruption')
   return update(fn,event)
  with patch.object(self.c,'update',side_effect=interrupt):
   with self.assertRaises(SystemExit):self.c.run(self.proof,self.adapter)
  self.assertEqual(self.c.public()['stage'],'needs-attention');self.assertEqual(len(self.calls),2)
  self.c.reconcile();self.assertEqual(self.c.public()['stage'],'waiting-review');self.assertEqual(self.c.public()['completedPairs'],1);self.assertEqual(len(self.calls),2)
 def test_runner_lock_fences_a_second_controller(self):
  self.c.arm()
  with self.c.lock('runner.lock',False):
   result=self.c.run(self.proof,self.adapter);self.assertTrue(result['runnerAlive']);self.assertEqual(self.calls,[])
 def test_guidance_and_review_validation(self):
  with self.assertRaises(ValueError):self.c.guidance({'maxPairs':100,'reviewEvery':1,'focus':''})
  with self.assertRaises(ValueError):self.c.review('pair-01','left')
  with self.assertRaises(ValueError):controller.Controller('../escape',self.root)
class OfflineCompletionTest(unittest.TestCase):
 def test_real_factory_processing_and_pair_import_with_synthetic_png(self):
  import shutil,zlib
  if not shutil.which('cwebp') or not shutil.which('dwebp'):self.skipTest('Image conversion tools unavailable')
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);p=study.prepare(root);c=controller.Controller(p['id'],root)
   holder=type('Fixture',(),{})();holder.calls=[];holder.revision=json.loads((study.REPO/'deployment/worker/models/pins.json').read_text())['models']['flux1']['revision']
   def chunk(name,value):return struct.pack('>I',len(value))+name+value+struct.pack('>I',zlib.crc32(name+value)&0xffffffff)
   def adapter(packet):
    receipt=ControllerTests.adapter(holder,packet);w,h=packet['spec']['width'],packet['spec']['height']
    png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress((b'\0'+bytes([30,40,50])*w)*h))+chunk(b'IEND',b'')
    Path(receipt['source']).write_bytes(png);receipt['generation']['sha256']=hashlib.sha256(png).hexdigest();return receipt
   c.guidance({'maxPairs':1,'reviewEvery':1,'focus':'Numerical fixture only'});c.arm();c.run(lambda p:{'ready':True},adapter)
   self.assertEqual(c.public()['stage'],'waiting-review');self.assertEqual(c.public()['completedPairs'],1);self.assertEqual(len(holder.calls),2)
   with c.store().db() as db:
    versions=list(db.execute('SELECT metadata FROM versions'));self.assertEqual(len(versions),2)
    for version in versions:
     metadata=json.loads(version['metadata']);self.assertEqual((metadata['width'],metadata['height']),(512,512));self.assertIn('original',metadata['files'])
if __name__=='__main__':unittest.main()
