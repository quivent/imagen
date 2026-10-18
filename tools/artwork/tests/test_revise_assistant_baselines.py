import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('revise_assistant_baselines',Path(__file__).resolve().parents[1]/'revise_assistant_baselines.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class RevisionGuardsTest(unittest.TestCase):
 def test_negative_subjects_must_remain_excluded_not_merely_mentioned(self):
  baseline='A dune landscape. No buildings or camels.'
  self.assertEqual(module.dropped_exclusions(baseline,'Dunes with buildings and camels.'),['buildings','camels'])
  self.assertEqual(module.dropped_exclusions(baseline,'Dunes. No buildings; no camels.'),[])
  self.assertEqual(module.dropped_exclusions(baseline,'Dunes without buildings or camels.'),[])
  self.assertEqual(module.dropped_exclusions('No people or legible signs.','No people.'),['legible','signs'])
 def test_location_identity_checks_only_names_present_in_assistant_baseline(self):
  scene={'name':'An oasis in the Draa Valley','baselinePrompt':'Draa Valley irrigation channel with palm trees.'}
  self.assertEqual(module.protected_names(scene),['Draa','Valley'])
  self.assertEqual(module.protected_names({'name':'A Mexican cenote','baselinePrompt':'A Mexican limestone sinkhole.'}),['Mexican'])
 def test_punctuation_and_minor_synonym_rewrite_is_detected(self):
  first='Sand leads toward dunes, blue violet troughs beneath light.'
  second='Sand leading to dunes: blue-violet troughs under light.'
  self.assertEqual(module.normalized_ratio(first,second),1)
  self.assertLess(module.normalized_ratio(first,'Foreground rippled sand rises toward ochre crests; distant ridges sit behind. Blue violet troughs under amber light.'),.86)

if __name__=='__main__':unittest.main()
