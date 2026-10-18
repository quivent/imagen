"""Numerical/coordinate safeguards for Method 2, without displaying artwork."""
import copy
import importlib.util
import json
from pathlib import Path
import struct
import sys
import unittest
import zlib

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('contour_constraints', ROOT/'scripts/worlds/contour_constraints.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
sys.path.insert(0,str(ROOT/'scripts/worlds'))
import contour_refine as refine


def png(array, mode=0):
    height, width, channels = array.shape
    rows=[]
    for y, row in enumerate(array.reshape(height, -1)):
        prior=array[y-1].reshape(-1) if y else np.zeros(width*channels,dtype=np.uint8)
        encoded=[]
        for x,v in enumerate(row):
            a=int(row[x-channels]) if x>=channels else 0
            b=int(prior[x]);c=int(prior[x-channels]) if x>=channels else 0
            if mode==0:p=0
            elif mode==1:p=a
            elif mode==2:p=b
            elif mode==3:p=(a+b)//2
            else:
                p0=a+b-c;ds=[abs(p0-a),abs(p0-b),abs(p0-c)]
                p=[a,b,c][ds.index(min(ds))]
            encoded.append((int(v)-p)&255)
        rows.append(bytes([mode])+bytes(encoded))
    def chunk(tag,data):return struct.pack('>I',len(data))+tag+data+struct.pack('>I',zlib.crc32(tag+data)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,2 if channels==3 else 6,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows)))+chunk(b'IEND',b'')


class ContourTests(unittest.TestCase):
    def test_all_png_filters_preserve_pixel_bytes_and_top_left_origin(self):
        array=np.array([[[0,100,255],[240,10,4],[20,200,60]],[[17,38,90],[220,190,13],[71,55,33]]],dtype=np.uint8)
        for mode in range(5):
            with self.subTest(mode=mode):np.testing.assert_array_equal(m.read_png(png(array,mode)),array)

    def test_rgba_and_crc_corruption(self):
        array=np.array([[[12,25,230,255],[9,0,128,255]]],dtype=np.uint8)
        raw=png(array,4)
        np.testing.assert_array_equal(m.read_png(raw),array[:,:,:3])
        broken=bytearray(raw);broken[-1]^=1
        with self.assertRaisesRegex(ValueError,'CRC'):m.read_png(broken)

    def test_integer_coordinates_retain_both_hypotheses(self):
        box,meta=m.normalise_box([490,300,540,400],1024,1024)
        self.assertEqual(box,[490/1024,300/1024,540/1024,400/1024])
        self.assertTrue(meta['ambiguity'])
        self.assertEqual(meta['alternative1000Grid'],[.49,.3,.54,.4])
        _,normal=m.normalise_box([.49,.3,.54,.4],1024,1024)
        self.assertLess(meta['weightMultiplier'],normal['weightMultiplier'])
        for invalid in [[.2,.2,.1,.3],[0,0,2000,1000],[0,float('nan'),1,1]]:
            with self.assertRaises(ValueError):m.normalise_box(invalid,1024,1024)

    def test_unlabelled_contrast_trace_detects_known_horizontal_step(self):
        image=np.zeros((128,128,3),dtype=np.uint8);image[40:]=255
        edges=m.edge_measurements(image)
        self.assertFalse(edges['segmentation']);self.assertFalse(edges['depthRecovered'])
        self.assertTrue(all(abs(p['xy'][1]-40/128)<2/128 for p in edges['upperBandContrastTrace']))
        self.assertTrue(all(p['semanticLabel'] is None for p in edges['upperBandContrastTrace']))

    def test_constant_image_does_not_fabricate_strong_contours(self):
        edges=m.edge_measurements(np.full((32,32,3),128,dtype=np.uint8))
        self.assertEqual(edges['strongPixelCount'],0)
        self.assertTrue(all(p['fitWeight']==0 for p in edges['upperBandContrastTrace']))

    def test_contour_metric_identity_displacement_and_empty_frame(self):
        source=np.zeros((64,64,3),dtype=np.uint8);source[20:]=255
        shifted=np.zeros_like(source);shifted[28:]=255
        regions=np.ones((64,64))
        identical=refine.contour_metrics(source,source,regions)
        displaced=refine.contour_metrics(source,shifted,regions)
        empty=refine.contour_metrics(source,np.zeros_like(source),regions)
        self.assertEqual(identical['contour_total'],0)
        self.assertGreater(displaced['weighted_chamfer01'],0)
        self.assertGreater(empty['contour_total'],displaced['contour_total'])
        self.assertEqual(empty['candidate_edge_pixels'],0)

    def test_soft_regions_and_blends_never_become_segmentation(self):
        constraints=[{'boxTopLeft01':[.25,.25,.75,.75],'fitWeight':.25}]
        weights=refine.soft_regions(constraints)
        self.assertGreater(weights.min(),0)
        self.assertGreater(weights[32,32],weights[0,0])
        self.assertAlmostEqual(float(weights.mean()),1)
        baseline={'groups':[{'id':'a','values':[[1.,2.]]},{'id':'b','values':[[3.,4.]]}]}
        proposal=copy.deepcopy(baseline);proposal['groups'][0]['values'][0][0]=5.
        candidate=refine.blend_parameters(baseline,proposal,{'a'},.25)
        self.assertEqual(candidate['groups'][0]['values'][0],[2.,2.])
        self.assertEqual(candidate['groups'][1],baseline['groups'][1])
        self.assertEqual(baseline['groups'][0]['values'][0],[1.,2.])

    def test_geometry_fit_preserves_depths_bounds_lineage_and_baseline(self):
        parameters=json.loads((ROOT/'public/worlds/draa-valley/parameters.json').read_text())
        original=copy.deepcopy(parameters)
        source=json.loads((ROOT/'public/worlds/draa-valley/source.json').read_text())
        analysis=json.loads((ROOT/'public/worlds/draa-valley/analysis.json').read_text())
        constraints,warnings=m.evidence(analysis,source)
        self.assertEqual(len(constraints),20)
        self.assertEqual(sum(c['coordinates']['ambiguity'] for c in constraints),12)
        self.assertFalse(warnings)
        candidate,fit=m.make_candidate(parameters,constraints,iterations=72)
        self.assertEqual(parameters,original)
        self.assertLess(fit['scoreAfter'],fit['scoreBefore'])
        self.assertEqual(candidate['parameterCount'],848)
        for old,new in zip(parameters['groups'],candidate['groups']):
            for row in new['values']:
                for value,(lo,hi) in zip(row,new['limits']):self.assertTrue(lo<=value<=hi)
            if 'z' in old['fields']:
                col=old['fields'].index('z')
                self.assertEqual([r[col] for r in old['values']],[r[col] for r in new['values']])
        changed=sum(a!=b for old,new in zip(parameters['groups'],candidate['groups']) for orow,nrow in zip(old['values'],new['values']) for a,b in zip(orow,nrow))
        self.assertLessEqual(changed,9)
        # A fresh fit with the same seed must not drift or depend on wall clock.
        again,again_fit=m.make_candidate(parameters,constraints,iterations=72)
        self.assertEqual(candidate,again)
        self.assertEqual(fit['scoreAfter'],again_fit['scoreAfter'])


if __name__=='__main__':unittest.main()
