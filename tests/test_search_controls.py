import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/worlds'))
from search_controls import DEFAULTS, batch, controls, validate

class SearchTests(unittest.TestCase):
    def setUp(self):
        self.parameters=json.loads((Path(__file__).resolve().parents[1]/'public/worlds/draa-valley/parameters.json').read_text())
        self.config={**DEFAULTS,'families':list(DEFAULTS['families'])}

    def test_full_search_covers_all_eligible_controls_without_duplicates(self):
        pool=controls(self.parameters,self.config['families'])
        self.assertEqual(len(pool),849)
        self.assertEqual(len({item[0] for item in pool}),len(pool))
        self.assertFalse(any(item[0] in ['water.speed','ray.farDistance','ray.hitTolerance'] for item in pool))
        covered=set()
        for cycle in range(54):
            selected,_,_=batch(self.parameters,self.config,cycle)
            covered.update(item[0] for item in selected)
        self.assertEqual(len(covered),len(pool))

    def test_family_selection_and_adaptive_steps_are_bounded(self):
        self.config['families']=['lighting']
        base,count,fraction=batch(self.parameters,self.config,0)
        wide,_,wide_fraction=batch(self.parameters,self.config,0,plateau=100000)
        self.assertTrue(all(item[1].startswith('world-') for item in base))
        self.assertEqual(wide_fraction,.16)
        self.assertAlmostEqual(wide[0][4],4*base[0][4])
        self.config['adaptive']=False
        self.assertEqual(batch(self.parameters,self.config,0,100000)[2],fraction)

    def test_invalid_settings_rejected(self):
        for invalid in [{'families':[]},{'proposals':9},{'intervalSeconds':1.5},{'stepFraction':float('nan')},{'paused':1},{'stepFraction':.5}]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):validate({**self.config,**invalid})

if __name__=='__main__':unittest.main()
