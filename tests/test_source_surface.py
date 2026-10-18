"""Validate source geometry layout without displaying images."""
import sys
from pathlib import Path
import struct
import unittest
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/worlds'))
from source_surface import surface_data
class SourceSurfaceTests(unittest.TestCase):
    def test_pixel_colors_and_shared_depth_boundaries_are_preserved(self):
        source=np.arange(4*4*3,dtype=np.uint8).reshape(4,4,3)
        raw=surface_data(source)
        self.assertEqual(raw[:8],b'IMGSURF1');self.assertEqual(struct.unpack('<2I',raw[8:16]),(4,4))
        data=np.frombuffer(raw[16:],dtype=[('color','u1',4),('depth','<f4',4)]).reshape(4,4)
        self.assertTrue(np.array_equal(data['color'][:,:,:3],source))
        self.assertTrue(np.array_equal(data['depth'][:,:-1,1],data['depth'][:,1:,0]))
        self.assertTrue(np.array_equal(data['depth'][:-1,:,3],data['depth'][1:,:,0]))
if __name__=='__main__':unittest.main()
