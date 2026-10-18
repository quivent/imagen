"""Numerical checks; no renderer or image viewing."""
import json
from pathlib import Path
import sys
import unittest
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts/worlds'))
from initialize_from_source import appearance_controls, rgb_step, shift


class SourceInitializationTests(unittest.TestCase):
    def test_joint_fit_solves_coupled_color_effects_with_bounded_steps(self):
        matrix = np.array([[1., .2], [.1, .8], [.4, .3]])
        residual = matrix @ np.array([.2, -.15])
        step = rgb_step(matrix, residual)
        self.assertLess(np.linalg.norm(matrix @ step-residual), .001)
        self.assertTrue(np.all(np.abs(rgb_step(matrix, residual*100)) <= .5))
        with self.assertRaises(ValueError):
            rgb_step(matrix, [float('nan')]*3)

    def test_shared_color_shift_preserves_source_parameters_and_quality_controls(self):
        root = Path(__file__).resolve().parents[1]
        parameters = json.loads((root/'public/worlds/draa-valley/parameters.json').read_text())
        original = json.dumps(parameters, sort_keys=True)
        controls = appearance_controls(parameters)
        shifted = shift(parameters, next(c for c in controls if c[0]=='fields-2'), 100.)
        group = next(g for g in shifted['groups'] if g['id']=='fields-2')
        self.assertTrue(all(row[0] == group['limits'][0][1] for row in group['values']))
        self.assertEqual(json.dumps(parameters, sort_keys=True), original)
        self.assertFalse(any(c[0]=='world-15' for c in controls))


if __name__ == '__main__':
    unittest.main()
