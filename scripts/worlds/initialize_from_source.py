"""Source-directed initialization of the fixed GLSL scene; never displays images.

Camera/composition probes precede a joint finite-difference RGB fit. All probes
are saved; only native-resolution literal-objective improvements are promoted.
This estimates parameters of the authored topology, not hidden geometry.
"""
from copy import deepcopy
import json
from pathlib import Path
import time
import numpy as np
from fit_parameters import REPO, ROOT, Renderer, digest, propose
from pixels import literal_components, read_png, resize_area, write_png
from experiment_store import publish_method1


def appearance_controls(parameters):
    """Shared field colors avoid independently fitting sixteen arbitrary plots."""
    result = []
    for identifier in ['world-02', 'world-03', 'world-04', 'world-05',
                       'world-06', 'world-08', 'world-09', 'world-10', 'fields-2']:
        group = next(item for item in parameters['groups'] if item['id'] == identifier)
        for component in range(3):
            result.append((identifier, component, group['limits'][component]))
    result.append(('world-14', 1, [.3, 2.]))
    return result


def shift(parameters, control, fraction):
    result = deepcopy(parameters)
    identifier, component, (low, high) = control
    group = next(item for item in result['groups'] if item['id'] == identifier)
    for row in group['values']:
        row[component] = float(np.clip(row[component] + fraction*(high-low), low, high))
    return result


def rgb_step(jacobian, residual, regularization=.01):
    """Regularized normalized-range step, capped before bounded line search."""
    jacobian = np.asarray(jacobian, dtype=float)
    residual = np.asarray(residual, dtype=float)
    if jacobian.ndim != 2 or jacobian.shape[0] != residual.size:
        raise ValueError('RGB derivative dimensions do not match')
    if not np.isfinite(jacobian).all() or not np.isfinite(residual).all():
        raise ValueError('Finite RGB derivatives required')
    scale = np.sqrt(residual.size)
    matrix = np.vstack([jacobian/scale, regularization*np.eye(jacobian.shape[1])])
    target = np.concatenate([residual/scale, np.zeros(jacobian.shape[1])])
    return np.clip(np.linalg.lstsq(matrix, target, rcond=None)[0], -.5, .5)


def initialize(experiment_id='experiment-3'):
    runtime = REPO/'.runtime/worlds'
    catalog = json.loads((REPO/'public/worlds/experiments.json').read_text())
    study = next(item for item in catalog['experiments'] if item['id'] == experiment_id)
    source_path = runtime/'method1/exp2-source.png'
    if digest(source_path) != study['source']['sha256']:
        raise ValueError('Immutable FLUX1 source mismatch')
    source = read_png(source_path)
    if source.shape != (512, 512, 3):
        raise ValueError('This initialization requires the native512 FLUX1 source')
    output = runtime/'method1'/f"exp{study['number']}-run1-initialization"
    output.mkdir(parents=True, exist_ok=False)
    parameters = json.loads((ROOT/'parameters.json').read_text())
    camera = {'position': [2.3, 20.], 'look': [-.06, -.06], 'clock': 0.}
    report = {'schema': 1, 'experimentId': experiment_id, 'source': study['source'],
              'searchSize': 512, 'objectiveVersion': 2, 'method': 1,
              'shaderSha256': digest(ROOT/'scene.frag'), 'vertexSha256': digest(ROOT/'scene.vert'),
              'startedAt': time.time(), 'candidates': [],
              'weights': {'pixel_mismatch_10pct': .5, 'local_structure_delta': .35, 'full_rgb_rms': .15},
              'pixelSpace': 'normalized display RGB; native512, no source transformation',
              'route': 'macOS CGL core; same unchanged GLSL scene as Experiment2',
              'search': {'version': 3, 'initialization': study['initialization']},
              'visualInspectionByAgent': False,
              'limitations': ['Authored scene topology remains fixed; no hidden-geometry recovery.',
                              'RGB derivatives propose appearance changes; literal objective selects them.',
                              'Numerical improvement does not establish visual or 3D correctness.']}

    def recipe(values, view):
        return {'schema': 1, 'experimentId': experiment_id, 'source': study['source'],
                'method': 1, 'parameters': values, 'camera': view,
                'sourceSha256': study['source']['sha256'], 'shaderSha256': report['shaderSha256']}

    with Renderer(width=512, height=512) as renderer:
        baseline = renderer.render(parameters, camera)
        write_png(output/'baseline-512.png', baseline)
        report['baseline'] = literal_components(source, baseline)
        best = report['baseline']['weighted_total']

        def capture(values, view, label, direction=0):
            nonlocal parameters, camera, best
            pixels = renderer.render(values, view)
            score = literal_components(source, pixels)
            index = len(report['candidates']) + 1
            filename = f'candidate-{index:02}.png'
            write_png(output/filename, pixels)
            (output/f'candidate-{index:02}.json').write_text(json.dumps(recipe(values, view), indent=2)+'\n')
            improved = score['weighted_total'] < best
            report['candidates'].append({'id': index, 'control': label, 'direction': direction,
                'components': score, 'render': filename, 'sha256': digest(output/filename),
                'camera': deepcopy(view), 'newBest': improved})
            if improved:
                parameters, camera, best = deepcopy(values), deepcopy(view), score['weighted_total']
            (output/'report.json').write_text(json.dumps(report, indent=2)+'\n')
            publish_method1(output)
            print(json.dumps({'candidate': index, 'control': label, 'best': best}), flush=True)
            return pixels

        composition = [('camera.x', None, 0, 0, 4.), ('camera.z', None, 0, 1, 10.),
                       ('camera.yaw', None, 1, 0, .18), ('camera.pitch', None, 1, 1, .15),
                       ('camera.focalLength', 'world-15', 0, 1, .5),
                       ('camera.eyeHeight', 'world-15', 0, 0, .8),
                       ('channel.halfWidth', 'world-11', 0, 0, .6),
                       ('foothill.height', 'world-13', 0, 2, 7.)]
        for adjustment in composition:
            anchor, view = deepcopy(parameters), deepcopy(camera)
            for direction in (-1, 1):
                values, proposed_view = propose(anchor, view, adjustment, direction)
                capture(values, proposed_view, 'initialize.composition.'+adjustment[0], direction)

        # Derivatives are estimated at one fixed anchor, using native512 renders.
        # Only the linear solve uses area-averaged RGB32 to capture broad color.
        anchor, view = deepcopy(parameters), deepcopy(camera)
        anchor_rgb = resize_area(renderer.render(anchor, view), 32).reshape(-1)/255.
        columns = []
        controls = appearance_controls(anchor)
        for control in controls:
            identifier, component, _ = control
            group = next(item for item in anchor['groups'] if item['id'] == identifier)
            low, high = control[2]
            fraction = .04 if max(row[component] for row in group['values']) < high-.04*(high-low) else -.04
            pixels = capture(shift(anchor, control, fraction), view,
                             f'initialize.derivative.{identifier}.{component}')
            columns.append((resize_area(pixels, 32).reshape(-1)/255.-anchor_rgb)/fraction)
        step = rgb_step(np.column_stack(columns), resize_area(source, 32).reshape(-1)/255.-anchor_rgb)
        report['search']['appearanceStep'] = step.tolist()
        for fraction in (1., .5, .25):
            values = deepcopy(anchor)
            for control, amount in zip(controls, step):
                values = shift(values, control, float(amount)*fraction)
            capture(values, view, f'initialize.jointAppearance.{fraction}')

        final = renderer.render(parameters, camera)
        if not np.array_equal(final, renderer.render(parameters, camera)):
            raise RuntimeError('Fixed-clock initialization is not deterministic')
        write_png(output/'best-512.png', final)
        (output/'candidate.json').write_text(json.dumps(recipe(parameters, camera), indent=2)+'\n')
        validation = {'baseline512': report['baseline'], 'best512': literal_components(source, final)}
        for name, dx, dz in [('forward', 0, -12), ('lateral', 5, 0), ('close', 0, -24), ('return', 0, 0)]:
            translated = deepcopy(camera)
            translated['position'][0] += dx
            translated['position'][1] += dz
            pixels = renderer.render(parameters, translated)
            write_png(output/f'{name}-512.png', pixels)
            validation[name] = {'camera': translated, 'sha256': digest(output/f'{name}-512.png'),
                                'changedFromArrival': not np.array_equal(final, pixels)}
        if validation['return']['changedFromArrival']:
            raise RuntimeError('Return did not reproduce arrival')
    report.update(best=validation['best512'], validation=validation, finishedAt=time.time())
    (output/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    publish_method1(output)
    print(json.dumps({'complete': True, 'baseline': report['baseline'], 'best': report['best']}), flush=True)
    return output


if __name__ == '__main__':
    initialize()
