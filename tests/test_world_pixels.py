"""Validate pixel orientation, PNG fidelity and objective behavior numerically."""
import sys
from pathlib import Path
import tempfile
import unittest
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/worlds'))
from pixels import read_png,write_png,resize_area,components
from fit_parameters import propose

class PixelTests(unittest.TestCase):
    def test_roundtrip_and_crc(self):
        pixels=np.random.default_rng(42).integers(0,256,(32,32,3),dtype=np.uint8)
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/'a.png';write_png(p,pixels)
            np.testing.assert_array_equal(read_png(p),pixels)
            raw=bytearray(p.read_bytes());raw[45]^=1;p.write_bytes(raw)
            with self.assertRaises(ValueError):read_png(p)
    def test_exact_area_average(self):
        source=np.arange(48,dtype=np.uint8).reshape(4,4,3)
        expected=np.stack([source[:2,:2].mean((0,1)),source[:2,2:].mean((0,1)),source[2:,:2].mean((0,1)),source[2:,2:].mean((0,1))]).reshape(2,2,3)
        np.testing.assert_array_equal(resize_area(source,2),expected)
    def test_objective_has_no_constant_image_edges(self):
        source=np.full((64,64,3),120,dtype=np.uint8)
        self.assertEqual(components(source,source)['weighted_total'],0)
        shifted=np.full_like(source,150)
        self.assertEqual(components(source,shifted)['edge_magnitude_l1'],0)
        self.assertGreater(components(source,shifted)['weighted_total'],0)
    def test_proposal_is_bounded_and_does_not_mutate_parent(self):
        p={'groups':[{'id':'x','limits':[[0,1]],'values':[[.9]]}]};camera={'position':[0,0],'look':[0,0]}
        q,c=propose(p,camera,('test','x',0,0,.5),1)
        self.assertEqual(q['groups'][0]['values'][0][0],1)
        self.assertEqual(p['groups'][0]['values'][0][0],.9)
        self.assertEqual(c,camera)
if __name__=='__main__':unittest.main()
