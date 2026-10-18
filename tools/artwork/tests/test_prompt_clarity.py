import copy
import importlib.util
import json
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

MODULE=Path(__file__).resolve().parents[1]/'prompt_clarity.py'
spec=importlib.util.spec_from_file_location('prompt_clarity',MODULE)
runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)

class PromptClarityTests(unittest.TestCase):
 def test_exact_historical_control_and_paired_settings(self):
  p=runner.compile_package();catalog=json.loads(runner.CATALOG.read_text());source=next(s['source'] for s in catalog['experiments'] if s['id']=='experiment-2')
  self.assertEqual(p['prompts']['A'],source['prompt']);self.assertEqual(len(p['requests']),6)
  self.assertNotEqual(p['prompts']['A'],p['prompts']['B']);self.assertFalse(p['execution']['started'])
  self.assertEqual([pair['submissionOrder'] for pair in p['pairs']],[['A','B'],['B','A'],['A','B']])
  for i,pair in enumerate(p['pairs']):
   a,b=p['requests'][i*2:i*2+2]
   for key in ('backend','model','settings','width','height','scene'):self.assertEqual(a[key],b[key])
   self.assertEqual(a['settings']['seed'],pair['seed']);self.assertEqual(set(pair['reviewSlots'].values()),{'A','B'})
  self.assertEqual(runner.compile_package(),p)
 def test_preparation_is_offline_immutable_and_does_not_enqueue(self):
  with tempfile.TemporaryDirectory() as temp,patch.object(socket,'socket',side_effect=AssertionError('Network forbidden')):
   root=Path(temp);p=runner.prepare(root);self.assertEqual(runner.prepare(root),p)
   self.assertEqual(runner.load_package(p['id'],root),p)
   self.assertFalse(list(root.rglob('*.sqlite3')))
   self.assertFalse(runner.status(root)['runs'][0]['enqueued'])
   f=root/'runs'/p['id']/'package.json';modified=copy.deepcopy(p);modified['requests'][0]['settings']['steps']=50;f.write_text(json.dumps(modified))
   with self.assertRaises(ValueError):runner.load_package(p['id'],root)
 def test_explicit_enqueue_is_isolated_and_idempotent(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);p=runner.prepare(root);first=runner.enqueue(p['id'],root);again=runner.enqueue(p['id'],root)
   self.assertEqual([j['id'] for j in first['jobs']],[j['id'] for j in again['jobs']]);self.assertTrue(all(j['cached'] for j in again['jobs']))
   self.assertTrue(Path(first['factory']).is_relative_to(root.resolve()));self.assertFalse(first['inferenceStarted'])
   self.assertTrue(runner.status(root)['runs'][0]['enqueued'])
 def test_changed_history_controls_and_duplicate_seeds_are_rejected(self):
  plan=json.loads(runner.PLAN.read_text());plan['settings']['steps']=50
  with self.assertRaises(ValueError):runner.compile_package(plan)
  plan=json.loads(runner.PLAN.read_text());plan['seeds']=[47,47]
  with self.assertRaises(ValueError):runner.compile_package(plan)
if __name__=='__main__':unittest.main()
