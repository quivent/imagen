"""Source-colored GLSL geometry baseline, with explicit unverified relief.

No source image texture is sampled. Pixel colors are immutable vertex attributes;
the GLSL vertex program constructs a connected per-pixel surface. Exact source
view preservation is an encoding result, not evidence of recovered 3D structure.
"""
from pathlib import Path
import hashlib
import json
import struct
import subprocess
import time
import numpy as np
from fit_parameters import REPO, digest
from pixels import read_png, write_png, literal_components
from experiment_store import image, put

ROOT = REPO/'public/worlds/source-surface'
RUNTIME = REPO/'.runtime/worlds'


def surface_data(source):
    height, width = source.shape[:2]
    luminance = source.astype(float) @ np.array([.2126, .7152, .0722])/255.
    padded = np.pad(luminance, ((1, 1), (1, 1)), mode='edge')
    corners = (padded[:-1, :-1]+padded[1:, :-1]+padded[:-1, 1:]+padded[1:, 1:])/4.
    # This is a declared depth hypothesis, not a model prediction.
    grid = .3+1.4*(1-np.arange(height+1)[:, None]/height)+.5*(1-corners)
    data = np.empty((height, width), dtype=[('color', 'u1', 4), ('depth', '<f4', 4)])
    data['color'][:, :, :3] = source
    data['color'][:, :, 3] = 255
    data['depth'] = np.stack([grid[:-1, :-1], grid[:-1, 1:], grid[1:, 1:], grid[1:, :-1]], axis=2)
    return b'IMGSURF1'+struct.pack('<2I', width, height)+data.tobytes()


def run():
    catalog_path = REPO/'public/worlds/experiments.json'
    catalog = json.loads(catalog_path.read_text())
    original = next(item for item in catalog['experiments'] if item['id']=='experiment-2')
    source = read_png(RUNTIME/'method1/exp2-source.png')
    if digest(RUNTIME/'method1/exp2-source.png') != original['source']['sha256']:
        raise ValueError('Source identity changed')
    output = RUNTIME/'method3/exp4-source-surface'
    output.mkdir(parents=True, exist_ok=False)
    data_file = output/'surface.bin'
    data_file.write_bytes(surface_data(source))
    data_sha = digest(data_file)
    registry = RUNTIME/'source-surfaces.json'
    records = json.loads(registry.read_text()) if registry.exists() else {}
    records[data_sha] = str(data_file.relative_to(RUNTIME))
    temporary = registry.with_suffix('.tmp');temporary.write_text(json.dumps(records, indent=2)+'\n');temporary.replace(registry)
    binary = RUNTIME/'bin'/('source-surface-'+digest(Path(__file__).with_suffix('.py').parent/'source_surface_glsl.c')[:12])
    if not binary.exists():
        subprocess.run(['clang', '-O2', str(Path(__file__).parent/'source_surface_glsl.c'), '-framework', 'OpenGL', '-o', str(binary)], check=True)
    process = subprocess.Popen([str(binary), str(ROOT/'scene.vert'), str(ROOT/'scene.frag'), str(data_file)], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    def render(relief=0., camera=(0., 0., 0., 0., 0.)):
        process.stdin.write(struct.pack('<6f', *camera, relief));process.stdin.flush()
        header = process.stdout.read(4)
        if len(header)!=4 or struct.unpack('<I', header)[0]:raise RuntimeError('GLSL surface render failed')
        raw = process.stdout.read(512*512*4)
        if len(raw)!=512*512*4:raise RuntimeError('Incomplete GLSL surface capture')
        return np.frombuffer(raw, dtype=np.uint8).reshape(512,512,4)[::-1,:,:3].copy()
    def recipe(relief):
        return {'schema':1,'experimentId':'experiment-4','method':3,'viewer':'source-surface',
                'source':original['source'],'sourceSha256':original['source']['sha256'],
                'shaderSha256':digest(ROOT/'scene.frag'),'vertexSha256':digest(ROOT/'scene.vert'),
                'surfaceDataSha256':data_sha,'surfaceDataUrl':'/api/source-surface/'+data_sha+'.bin',
                'camera':[0,0,0,0,0],'relief':relief,
                'depthEvidence':'handwritten image-row/luminance hypothesis; not reconstructed',
                'appearance':'source RGB vertex attributes; no image texture'}
    try:
        baseline = render()
        comparison = {'equalPixels':int(np.all(source==baseline,axis=2).sum()),'pixels':512*512,
                      'maxByteDifference':int(np.abs(source.astype(int)-baseline.astype(int)).max()),
                      'identicalRGB':bool(np.array_equal(source, baseline))}
        (output/'pixel-proof.json').write_text(json.dumps(comparison,indent=2)+'\n')
        if not comparison['identicalRGB']:raise RuntimeError('Baseline is not pixel-identical: '+json.dumps(comparison))
        write_png(output/'baseline-512.png',baseline)
        candidates=[];views=[]
        for index,relief in enumerate((0.,.25,.75),1):
            pixels=render(relief);write_png(output/f'candidate-{index:02}.png',pixels)
            saved=recipe(relief);(output/f'candidate-{index:02}.json').write_text(json.dumps(saved,indent=2)+'\n')
            candidates.append({'id':index,'control':'source surface · relief '+str(relief),'direction':0,
                'components':literal_components(source,pixels),'image':image(output/f'candidate-{index:02}.png'),
                'recipe':saved,'viewer':'source-surface'})
        for name,camera in [('forward',(0,0,-.3,0,0)),('lateral',(.3,0,0,0,0)),('close',(0,0,-.6,0,0)),('return',(0,0,0,0,0))]:
            pixels=render(.75,camera);write_png(output/f'{name}-512.png',pixels)
            views.append({'label':name,'image':image(output/f'{name}-512.png')})
        repeat=render(.75)
        if not np.array_equal(source,repeat):raise RuntimeError('Relief arrival does not preserve source')
        run_record={'id':'method3-exp4-source-surface','experimentId':'experiment-4','method':3,
            'objectiveVersion':2,'searchSize':512,'source':original['source'],
            'shaderSha256':digest(ROOT/'scene.frag'),'status':'complete','candidates':candidates,
            'baseline':{'components':literal_components(source,baseline),'image':image(output/'baseline-512.png'),
                        'recipe':recipe(0.),'viewer':'source-surface'},
            'best':{**candidates[0]},'views':views,'route':'macOS CGL; pure GLSL instanced surface',
            'note':'Exact source-view encoding. Colors are source-derived; depth and hidden geometry remain unverified.',
            'validation':{'pixelProof':comparison},'observedAt':time.time()}
        put(run_record)
        (output/'report.json').write_text(json.dumps(run_record,indent=2)+'\n')
        study={**original,'id':'experiment-4','number':4,'label':'Experiment 4 · Source surface',
               'title':'Draa Valley · Source surface','defaultMethod':3,
               'initialization':{'strategy':'source-colored GLSL surface','depthVerified':False}}
        catalog['experiments'].append(study);catalog['defaultExperiment']='experiment-4'
        catalog_path.write_text(json.dumps(catalog,indent=2)+'\n')
        print(json.dumps(comparison),flush=True)
    finally:
        process.stdin.close()
        if process.wait(timeout=10):raise RuntimeError('Surface renderer exited with failure')


if __name__=='__main__':run()
