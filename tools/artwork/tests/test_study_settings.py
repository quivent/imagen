import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import prompt_clarity as study
import study_settings
from parity_daemon import ParityDaemon,atomic
from test_parity_daemon import FakeController
SETTINGS={'width':512,'height':512,'steps':28,'guidance_scale':3.5,'max_sequence_length':512}
class StudySettingsTests(unittest.TestCase):
 def test_landscape_and_portrait_choices(self):
  for width,height in [(1536,1024),(1024,1536),(768,512)]:
   value={**SETTINGS,'width':width,'height':height,'max_sequence_length':512}
   self.assertEqual(study_settings.validate(value),value)
 def test_validated_shared_settings_survive_restart_and_invalid_controls_cannot_write(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);value={**SETTINGS,'width':768,'height':768,'steps':16};saved=study_settings.save(root,value)
   self.assertEqual(study_settings.read(root,SETTINGS),saved)
   for invalid in [{**value,'steps':17},{**value,'height':640},{**value,'max_sequence_length':1024}]:
    with self.assertRaises(ValueError):study_settings.save(root,invalid)
   self.assertEqual(study_settings.read(root,SETTINGS)['settings'],value)
 def test_inflight_pair_keeps_its_settings_and_next_scene_uses_saved_controls(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);study_root=root/'study';current=study.prepare_corpus(study_root,SETTINGS,'scene-001',42)
   FakeController.states={};daemon=ParityDaemon(root/'daemon',study_root,FakeController,study.prepare_corpus)
   atomic(daemon.root/'config.json',{'settings':SETTINGS});daemon.update(enabled=True,currentPackage=current['id'])
   study_settings.save(study_root,{**SETTINGS,'steps':16})
   first=daemon.tick();self.assertEqual(first['activeSettings']['steps'],28);self.assertEqual(first['completedPairs'],1)
   second=daemon.tick();self.assertEqual(second['activeSettings']['steps'],16);self.assertEqual(second['completedPairs'],2)
   pkg=study.compile_corpus_package({**SETTINGS,'steps':16},'scene-002')
   self.assertEqual([r['settings']['steps'] for r in pkg['requests']],[16,16])
