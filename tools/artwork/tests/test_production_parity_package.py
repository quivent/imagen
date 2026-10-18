import copy
import importlib.util
import json
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('parity_prompt_package',Path(__file__).resolve().parents[1]/'prompt_clarity.py')
runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
SETTINGS={'width':1024,'height':1024,'steps':28,'guidance_scale':3.5,'max_sequence_length':512}

class ProductionParityPackageTests(unittest.TestCase):
 def test_pair_uses_exact_corpus_prompts_and_explicit_settings(self):
  corpus=json.loads(runner.CORPUS.read_text())
  p=runner.compile_corpus_package(SETTINGS,corpus=corpus)
  scene=corpus['scenes'][0]
  self.assertEqual(p['schema'],2);self.assertEqual(p['study'],'ADHC-001')
  self.assertEqual(p['prompts'],{'A':scene['prompt'],'B':scene['precisionPrompt']})
  self.assertEqual(p['pairs'][0]['submissionOrder'],['A','B'])
  self.assertEqual(p['seeds'],[42]);self.assertEqual(p['plannedImages'],2)
  for r in p['requests']:
   self.assertEqual(r['width'],1024);self.assertEqual(r['height'],1024)
   self.assertEqual(r['settings'],{'steps':28,'guidance_scale':3.5,'max_sequence_length':512,'seed':42})
  self.assertEqual(p,runner.compile_corpus_package(SETTINGS,corpus=corpus))
 def test_prepare_is_offline_and_immutable_then_derived_tamper_rejected(self):
  with tempfile.TemporaryDirectory() as temp,patch.object(socket,'socket',side_effect=AssertionError('No network')):
   p=runner.prepare_corpus(temp,SETTINGS)
   self.assertEqual(runner.prepare_corpus(temp,SETTINGS),p)
   self.assertEqual(runner.load_package(p['id'],temp),p)
   self.assertFalse(list(Path(temp).rglob('*.sqlite3')))
   path=Path(temp)/'runs'/p['id']/'package.json'
   for mutate in (lambda x:x['requests'][0].update(prompt='changed'),lambda x:x['pairs'][0].update(submissionOrder=['B','A']),lambda x:x['sourceCorpus']['scene'].update(precisionPrompt='changed'),lambda x:x['settings'].update(steps=50)):
    changed=copy.deepcopy(p);mutate(changed);path.write_text(json.dumps(changed))
    with self.assertRaises(ValueError):runner.load_package(p['id'],temp)
 def test_invalid_or_undrafted_controls_rejected(self):
  corpus=json.loads(runner.CORPUS.read_text());corpus['scenes'][1]['precisionPrompt']=None
  with self.assertRaises(ValueError):runner.compile_corpus_package(SETTINGS,'scene-002',corpus=corpus)
  with self.assertRaises(ValueError):runner.prepare_corpus()
  for change in ({'width':1023},{'steps':True},{'guidance_scale':float('nan')},{'max_sequence_length':513}):
   with self.assertRaises(ValueError):runner.compile_corpus_package(SETTINGS|change)
 def test_changed_source_prompt_is_rejected(self):
  corpus=json.loads(runner.CORPUS.read_text());corpus['scenes'][0]['prompt']='changed'
  with self.assertRaises(ValueError):runner.compile_corpus_package(SETTINGS,corpus=corpus)
 def test_later_pass_seed_is_frozen_and_loadable(self):
  with tempfile.TemporaryDirectory() as temp:
   first=runner.prepare_corpus(temp,SETTINGS)
   next_pass=runner.prepare_corpus(temp,SETTINGS,seed=43)
   self.assertNotEqual(first['id'],next_pass['id'])
   self.assertEqual(next_pass['seeds'],[43])
   self.assertTrue(all(r['settings']['seed']==43 for r in next_pass['requests']))
   self.assertEqual(runner.load_package(next_pass['id'],temp),next_pass)
   with self.assertRaises(ValueError):runner.compile_corpus_package(SETTINGS,seed=True)

if __name__=='__main__':unittest.main()
