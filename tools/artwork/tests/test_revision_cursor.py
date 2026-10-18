import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from parity_daemon import revision_cursor

class CursorTests(unittest.TestCase):
 def test_prefers_approved_forward_scene_on_its_own_lane(self):
  config={'laneCount':2,'laneIndex':0,'workerPort':18761}
  state={'pass':3,'seed':44,'sceneIndex':4}
  self.assertEqual(revision_cursor(state,config,[0,1,6,9]),{'sceneIndex':6})
 def test_wraps_to_approved_scene_with_new_paired_seed(self):
  config={'laneCount':2,'laneIndex':1,'workerPort':18763}
  state={'pass':3,'seed':44,'sceneIndex':80}
  self.assertEqual(revision_cursor(state,config,[0,1,6,9]),{'sceneIndex':1,'pass':4,'seed':45})
 def test_empty_pool_preserves_continuous_historical_fallback(self):
  self.assertIsNone(revision_cursor({'pass':3,'seed':44,'sceneIndex':80},{'laneCount':2,'laneIndex':1,'workerPort':18763},[]))
