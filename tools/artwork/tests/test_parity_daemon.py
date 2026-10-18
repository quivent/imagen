import copy
from contextlib import closing
import importlib.util
import json
from pathlib import Path
import plistlib
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

TOOLS=Path(__file__).resolve().parents[1];sys.path.insert(0,str(TOOLS))
import parity_daemon as module

SETTINGS={'width':512,'height':512,'steps':28,'guidance_scale':3.5,'max_sequence_length':512}

class FakeController:
 states={}
 def __init__(self,identity,root):
  self.identity=identity;self.directory=Path(root)/'runs'/identity;self.states.setdefault(identity,{'enabled':False,'stage':'prepared','pairs':{},'runnerAlive':False})
 def status(self):return copy.deepcopy(self.states[self.identity])
 def pause(self):self.states[self.identity].update(enabled=False,stage='paused')
 def arm(self):self.states[self.identity].update(enabled=True,stage='checking')
 def reconcile(self):self.states[self.identity].update(enabled=False,stage='paused',problem=None)
 def run(self,preflight,adapter):
  self.states[self.identity].update(enabled=False,stage='waiting-review',pairs={'pair-01':{'completedAt':1}})

class ParityDaemonTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);FakeController.states={}
  self.corpus=json.loads(module.study.CORPUS.read_text());self.corpus['scenes'][1]['precisionPrompt']=None;self.path=self.root/'corpus.json';self.path.write_text(json.dumps(self.corpus))
  self.patch=patch.object(module.study,'CORPUS',self.path);self.patch.start()
  def prepare(root,settings,scene_id,seed):return {'id':scene_id+'-'+str(seed),'pairs':[{'id':'pair-01'}]}
  self.d=module.ParityDaemon(self.root/'daemon',self.root/'study',FakeController,prepare)
  module.atomic(self.d.root/'config.json',{'settings':SETTINGS})
 def tearDown(self):self.patch.stop();self.temp.cleanup()
 def draft(self,index):
  self.corpus['scenes'][index]['precisionPrompt']='saved rewrite';self.path.write_text(json.dumps(self.corpus))
 def test_waiting_review_does_not_stop_next_scene_and_missing_draft_resumes(self):
  self.d.enable();state=self.d.tick()
  self.assertEqual(state['completedPairs'],1);self.assertTrue(state['enabled']);self.assertEqual(state['sceneIndex'],1)
  self.assertEqual(FakeController.states['scene-001-42']['stage'],'waiting-review')
  self.assertEqual(self.d.tick()['stage'],'waiting-draft');self.assertEqual(len(FakeController.states),1)
  self.draft(1);state=self.d.tick();self.assertEqual(state['completedPairs'],2);self.assertEqual(state['sceneIndex'],2)
 def test_pass_wrap_increments_seed(self):
  self.draft(149);self.d.update(sceneIndex=149,enabled=True)
  state=self.d.tick();self.assertEqual(state['seed'],43);self.assertEqual(state['pass'],2);self.assertEqual(state['sceneIndex'],0)
 def test_uncertain_existing_request_halts_without_replay(self):
  FakeController.states['scene-001-42']={'enabled':False,'stage':'needs-attention','pairs':{},'problem':'Uncertain job','runnerAlive':False}
  with patch.object(FakeController,'run',side_effect=AssertionError('No replay')):
   self.d.enable();state=self.d.tick();self.assertEqual(state['stage'],'needs-attention');self.assertFalse(state['enabled']);self.assertEqual(state['completedPairs'],0)
   with self.assertRaises(ValueError):self.d.enable()
 def test_user_pause_disables_active_controller(self):
  self.d.update(currentPackage='scene-001-42',enabled=True)
  FakeController.states['scene-001-42']={'enabled':True,'stage':'running','pairs':{},'runnerAlive':True}
  state=self.d.pause();self.assertFalse(state['enabled']);self.assertFalse(FakeController.states['scene-001-42']['enabled'])
  with patch.object(self.d,'prepare',side_effect=AssertionError('No new image')):self.d.tick()
 def test_restart_advances_existing_completed_pair_without_regeneration(self):
  FakeController.states['scene-001-42']={'enabled':False,'stage':'waiting-review','pairs':{'pair-01':{}},'runnerAlive':False}
  with patch.object(FakeController,'run',side_effect=AssertionError('No replay')):
   self.d.enable();self.assertEqual(self.d.tick()['completedPairs'],1)
 def test_running_existing_controller_is_not_duplicated(self):
  FakeController.states['scene-001-42']={'enabled':True,'stage':'running','pairs':{},'runnerAlive':True}
  with patch.object(FakeController,'run',side_effect=AssertionError('No second runner')):
   self.d.enable();self.assertEqual(self.d.tick()['stage'],'waiting-worker')
 def test_frozen_current_scene_change_requires_attention(self):
  self.d.update(currentPackage='different-frozen-package',enabled=True)
  self.assertEqual(self.d.tick()['stage'],'needs-attention')
 def test_install_launchd_is_persistent_but_does_not_enable(self):
  with patch.object(Path,'home',return_value=self.root/'home'):
   result=self.d.install({'settings':SETTINGS,'sshHost':'root@example.test','sshPort':1234})
   self.assertFalse(result['enabled']);plist=plistlib.loads(Path(result['plist']).read_bytes())
   self.assertIs(plist['KeepAlive'],True);self.assertIs(plist['RunAtLoad'],True)
   self.assertIn('run',plist['ProgramArguments']);self.assertEqual(plist['EnvironmentVariables']['ARTWORK_SSH_PORT'],'1234')
 def test_transient_preflight_retries_only_without_submitted_jobs(self):
  problem='The read-only worker check could not complete. No image was requested.'
  c=FakeController('scene-001-42',self.d.study_root)
  FakeController.states[c.identity].update(stage='needs-attention',problem=problem)
  self.d.enable();self.assertEqual(self.d.tick()['stage'],'waiting-worker');self.assertTrue(self.d.read()['enabled'])
  self.assertEqual(self.d.tick()['completedPairs'],1)
  database=c.directory/'factory/queue.sqlite3';database.parent.mkdir(parents=True)
  with closing(sqlite3.connect(database)) as db:
   db.execute('CREATE TABLE jobs (id TEXT)');db.execute('INSERT INTO jobs VALUES (?)',('uncertain-job',));db.commit()
  self.assertFalse(self.d.retry_unsubmitted_preflight(c,{'problem':problem}))
 def test_unreviewed_pairs_continue_and_new_process_uses_saved_cursor(self):
  self.draft(1);self.draft(2);self.d.enable()
  self.d.tick();self.d.tick()
  self.assertEqual(self.d.read()['completedPairs'],2)
  restarted=module.ParityDaemon(self.d.root,self.d.study_root,FakeController,self.d.prepare)
  self.assertTrue(restarted.read()['enabled']);restarted.tick()
  self.assertEqual(restarted.read()['completedPairs'],3)
  self.assertEqual(restarted.read()['sceneIndex'],3)
  self.assertTrue(all(s['stage']=='waiting-review' for s in FakeController.states.values()))
  self.assertTrue(restarted.read()['enabled'])
 def test_process_restart_retains_explicit_pause_and_single_runner_fence(self):
  self.d.enable();self.d.pause()
  restarted=module.ParityDaemon(self.d.root,self.d.study_root,FakeController,self.d.prepare)
  self.assertFalse(restarted.read()['enabled'])
  with patch.object(restarted,'prepare',side_effect=AssertionError('Paused restart must not submit')):restarted.tick()
  with self.d.lock('runner.lock',False):
   self.assertTrue(restarted.status()['runnerAlive'])
   with self.assertRaises(BlockingIOError):
    with restarted.lock('runner.lock',False):pass
 def test_two_lanes_have_disjoint_initial_ranges_and_later_passes(self):
  a={'laneCount':2,'laneIndex':0,'workerPort':18761,'initialRange':[0,75]}
  b={'laneCount':2,'laneIndex':1,'workerPort':18763,'initialRange':[75,150]}
  for number in (1,2,3):
   first=set(module.lane_indices(a,number));second=set(module.lane_indices(b,number))
   self.assertFalse(first&second);self.assertEqual(first|second,set(range(150)))
  self.assertEqual(module.lane_indices(b,1)[0],75);self.assertEqual(module.lane_indices(b,2)[0],1)
 def test_lane_one_starts_at_tail_and_wraps_same_next_seed(self):
  cfg={'settings':SETTINGS,'laneCount':2,'laneIndex':1,'workerPort':18763,'initialRange':[75,150]}
  module.atomic(self.d.root/'config.json',cfg);self.draft(75);self.d.enable();s=self.d.tick()
  self.assertEqual(s['sceneIndex'],76);self.assertIn('scene-076-42',FakeController.states)
  self.draft(149);self.d.update(sceneIndex=149,currentPackage=None);s=self.d.tick()
  self.assertEqual((s['sceneIndex'],s['seed'],s['pass']),(1,43,2))
 def test_shared_scene_seed_reservation_prevents_second_submission(self):
  second=module.ParityDaemon(self.root/'daemon2',self.d.study_root,FakeController,self.d.prepare)
  module.atomic(second.root/'config.json',{'settings':SETTINGS});second.enable()
  with self.d.reservation(0,42):
   with patch.object(second,'prepare',side_effect=AssertionError('Reserved scene must not submit')):
    self.assertEqual(second.tick()['stage'],'waiting-worker')
  self.assertEqual(second.tick()['completedPairs'],1)
 def test_lane_configuration_preserves_inflight_cursor_and_rejects_reassignment(self):
  module.atomic(self.d.root/'config.json',{'settings':SETTINGS,'laneCount':2,'laneIndex':0,'initialRange':[0,75]})
  self.draft(53);self.d.update(sceneIndex=53,currentPackage='scene-054-42',enabled=True)
  self.assertEqual(self.d.tick()['sceneIndex'],54)
  self.d.update(sceneIndex=80,currentPackage='scene-081-42',enabled=True)
  with patch.object(self.d,'prepare',side_effect=AssertionError('Do not steal another lane')):
   self.assertEqual(self.d.tick()['stage'],'needs-attention')
 def test_second_lane_install_has_distinct_launchd_label(self):
  with patch.object(Path,'home',return_value=self.root/'home'):
   result=self.d.install({'settings':SETTINGS,'sshHost':'root@example.test','sshPort':1234,'laneCount':2,'laneIndex':1,'workerPort':18763,'initialRange':[75,150]})
   plist=plistlib.loads(Path(result['plist']).read_bytes());self.assertEqual(plist['Label'],module.LABEL+'.gpu1')
   self.assertEqual(self.d.config()['workerPort'],18763)

if __name__=='__main__':unittest.main()
