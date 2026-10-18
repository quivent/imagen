import sys
from pathlib import Path
import unittest
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/worlds'))
from pixels import literal_components

class LiteralTests(unittest.TestCase):
    def test_identity_is_zero(self):
        image=np.random.default_rng(3).integers(0,256,(128,128,3),dtype=np.uint8)
        self.assertTrue(all(abs(value)<1e-12 for value in literal_components(image,image).values()))

    def test_tolerance_means_a_fraction_of_corresponding_pixels(self):
        source=np.zeros((128,128,3),dtype=np.uint8)
        image=source.copy();image[:64]=51
        result=literal_components(source,image)
        self.assertEqual(result['pixel_mismatch_10pct'],.5)
        self.assertAlmostEqual(result['full_rgb_rms'],.1)
        self.assertGreater(result['local_structure_delta'],0)

    def test_spatial_rearrangement_is_penalized_despite_matching_palette(self):
        source=np.zeros((128,128,3),dtype=np.uint8);source[:64]=255
        candidate=source[::-1].copy()
        self.assertEqual(source.mean(),candidate.mean())
        result=literal_components(source,candidate)
        self.assertEqual(result['pixel_mismatch_10pct'],1)
        self.assertGreater(result['weighted_total'],.99)

    def test_small_changes_are_measurable_below_coverage_threshold(self):
        source=np.full((128,128,3),128,dtype=np.uint8)
        result=literal_components(source,source+1)
        self.assertEqual(result['pixel_mismatch_10pct'],0)
        self.assertGreater(result['weighted_total'],0)

if __name__=='__main__':unittest.main()
