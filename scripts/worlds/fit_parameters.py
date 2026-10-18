"""Bounded Method1 pixel fitting of a fixed pure GLSL scene."""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import time
import numpy as np
from pixels import read_png, write_png, resize_area, components, literal_components
from experiment_store import publish_method1

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
ROOT = REPO/'public/worlds/draa-valley'


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class Renderer:
    def __init__(self, root=ROOT, width=256, height=256):
        self.root = Path(root)
        self.width,self.height = width,height
        build = REPO/'.runtime/worlds/bin'
        build.mkdir(parents=True,exist_ok=True)
        binary = build/('offscreen-'+digest(HERE/'offscreen_glsl.c')[:12])
        if not binary.exists():
            subprocess.run(['clang','-O2',str(HERE/'offscreen_glsl.c'),'-framework','OpenGL','-o',str(binary)],check=True)
        self.process = subprocess.Popen([str(binary),str(self.root/'scene.vert'),str(self.root/'scene.frag'),str(width),str(height)],stdin=subprocess.PIPE,stdout=subprocess.PIPE)

    def render(self, parameters, camera):
        values = [float(value) for group in parameters['groups'] for row in group['values'] for value in row]
        if len(values) != 848 or not np.isfinite(values).all():
            raise ValueError('848 finite scalar parameters expected')
        for group in parameters['groups']:
            for row in group['values']:
                for value,(low,high) in zip(row,group['limits']):
                    if not low<=value<=high:
                        raise ValueError('Parameter out of bounds: '+group['id'])
        values.extend([*camera['position'],*camera['look'],float(camera.get('clock',0.))])
        if len(values)!=853 or not np.isfinite(values).all():
            raise ValueError('Invalid camera')
        self.process.stdin.write(struct.pack('<853f',*values))
        self.process.stdin.flush()
        header=self.process.stdout.read(4)
        if len(header)!=4:
            raise RuntimeError('GLSL renderer stopped before capture')
        error=struct.unpack('<I',header)[0]
        pixels=self.process.stdout.read(self.width*self.height*4)
        if error or len(pixels)!=self.width*self.height*4:
            raise RuntimeError('GLSL capture failed: '+str(error))
        return np.frombuffer(pixels,dtype=np.uint8).reshape(self.height,self.width,4)[::-1,:,:3].copy()

    def close(self):
        if self.process.stdin:
            self.process.stdin.close()
        if self.process.wait(timeout=10):
            raise RuntimeError('GLSL renderer exited with failure')

    def __enter__(self):
        return self

    def __exit__(self,*args):
        self.close()


def set_value(parameters, group_id, row, component, value):
    group=next(group for group in parameters['groups'] if group['id']==group_id)
    low,high=group['limits'][component]
    group['values'][row][component]=max(low,min(high,value))


def adjustments(parameters,camera):
    return [
        ('camera.x',None,0,0,1.5),('camera.z',None,0,1,5.),
        ('camera.yaw',None,1,0,.12),('camera.pitch',None,1,1,.12),
        ('camera.focalLength','world-15',0,1,.25),
        ('channel.halfWidth','world-11',0,0,.4),
        ('tower.x','buildings-0',0,0,3.),('tower.z','buildings-0',0,1,6.),
        ('tower.height','buildings-1',0,0,2.),
        ('sun.elevation','world-00',0,1,.13),
        ('ambient.intensity','world-01',0,3,.12),
        ('foothill.height','world-13',0,2,5.),
    ]


def propose(parameters,camera,adjustment,direction):
    label,group_id,row,component,step=adjustment
    parameters,camera=deepcopy(parameters),deepcopy(camera)
    if group_id is None:
        key='position' if row==0 else 'look'
        camera[key][component]+=direction*step
        if key=='look':
            camera[key][component]=max(-1.1,min(1.1,camera[key][component])) if component==1 else camera[key][component]
    else:
        group=next(group for group in parameters['groups'] if group['id']==group_id)
        set_value(parameters,group_id,row,component,group['values'][row][component]+direction*step)
    return parameters,camera


def run(source_path, output, initial=None, step_scale=1., search_adjustments=None, search_metadata=None, objective_version=1, source_metadata=None, experiment_id="experiment-1", search_size=256):
    if objective_version not in (1,2):
        raise ValueError('Unknown objective version')
    measure = literal_components if objective_version == 2 else components
    output=Path(output)
    if (output/'report.json').exists():
        raise FileExistsError('Preserve the existing run; choose a new output directory')
    if not 0 < step_scale <= 2:
        raise ValueError('step scale must be positive and no greater than2')
    output.mkdir(parents=True,exist_ok=True)
    if search_size not in (256,512):
        raise ValueError('Search size must be 256 or 512')
    source_meta=source_metadata or json.loads((ROOT/'source.json').read_text())
    if digest(source_path)!=source_meta['sha256']:
        raise ValueError('Immutable source hash mismatch')
    source=read_png(source_path)
    if source.shape!=(source_meta['height'],source_meta['width'],3):
        raise ValueError('Source dimensions mismatch')
    source_search=resize_area(source,search_size)
    parameters=json.loads((ROOT/'parameters.json').read_text())
    camera={'position':[2.3,20.],'look':[-.06,-.06],'clock':0.}
    if initial:
        seed=json.loads(Path(initial).read_text())
        if seed.get('sourceSha256')!=source_meta['sha256'] or seed.get('shaderSha256')!=digest(ROOT/'scene.frag'):
            raise ValueError('Initial recipe does not match source/shader')
        parameters=seed['parameters'];camera=seed['camera']
    baseline_parameters,baseline_camera=deepcopy(parameters),deepcopy(camera)
    report={'schema':1,'experimentId':experiment_id,'searchSize':search_size,'objectiveVersion':objective_version,'method':1,'source':source_meta,'shaderSha256':digest(ROOT/'scene.frag'),
            'vertexSha256':digest(ROOT/'scene.vert'),'baselineParameterSha256':hashlib.sha256(json.dumps(baseline_parameters,sort_keys=True,separators=(',',':')).encode()).hexdigest(),
            'route':'macOS CGL core; version300es->410 and precision qualifier omitted for validation only',
            'pixelSpace':'normalized display RGB bytes; same square framing, no reference tone/exposure adjustment',
            'weights':({'pixel_mismatch_10pct':.5,'local_structure_delta':.35,'full_rgb_rms':.15} if objective_version==2 else {'coarse_rgb_l1':.6,'edge_magnitude_l1':.25,'fine_rgb_l1':.15}),
            'scope':str(2*len(search_adjustments or adjustments(parameters,camera)))+' bounded coordinate proposals',
            'search':search_metadata or {'version':1,'controls':12},
            'automaticPixelFitting':True,'visualInspectionByAgent':False,'startedAt':time.time(),'candidates':[]}
    with Renderer(width=search_size,height=search_size) as renderer:
        image=renderer.render(parameters,camera)
        score=measure(source_search,image)
        write_png(output/f'baseline-{search_size}.png',image)
        report['baseline']=score;best=score['weighted_total']
        for adjustment in (search_adjustments if search_adjustments is not None else adjustments(parameters,camera)):
            adjustment=(*adjustment[:4],adjustment[4]*step_scale)
            origin_parameters,origin_camera=deepcopy(parameters),deepcopy(camera)
            selected=None
            for direction in (-1,1):
                candidate,candidate_camera=propose(origin_parameters,origin_camera,adjustment,direction)
                rendered=renderer.render(candidate,candidate_camera)
                measures=measure(source_search,rendered)
                index=len(report['candidates'])+1
                filename=f'candidate-{index:02}.png';write_png(output/filename,rendered)
                record={'id':index,'control':adjustment[0],'direction':direction,'components':measures,'render':filename,'sha256':digest(output/filename),'camera':candidate_camera,'newBest':measures['weighted_total']<best}
                recipe={'schema':1,'experimentId':experiment_id,'source':source_meta,'method':1,'parameters':candidate,'camera':candidate_camera,'sourceSha256':source_meta['sha256'],'shaderSha256':report['shaderSha256'],'control':adjustment[0],'direction':direction}
                (output/f'candidate-{index:02}.json').write_text(json.dumps(recipe,indent=2)+'\n')
                report['candidates'].append(record)
                if measures['weighted_total']<best:
                    best=measures['weighted_total'];selected=(candidate,candidate_camera)
                (output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
                publish_method1(output)
                print(json.dumps({'candidate':index,'control':adjustment[0],'loss':round(measures['weighted_total'],6),'best':round(best,6)}),flush=True)
            if selected:
                parameters,camera=selected
        final=renderer.render(parameters,camera);write_png(output/f'best-{search_size}.png',final)
        repeat=renderer.render(parameters,camera)
        if not np.array_equal(final,repeat):
            raise RuntimeError('Fixed-clock capture was not deterministic')
    validation={}
    with Renderer(width=512,height=512) as renderer:
        base=renderer.render(baseline_parameters,baseline_camera);write_png(output/'baseline-512.png',base)
        final=renderer.render(parameters,camera);write_png(output/'best-512.png',final)
        validation['baseline512']=measure(resize_area(source,512),base)
        validation['best512']=measure(resize_area(source,512),final)
        for name,dx,dz in [('forward',0,-12),('lateral',5,0),('close',0,-24),('return',0,0)]:
            view=deepcopy(camera);view['position'][0]+=dx;view['position'][1]+=dz
            pixels=renderer.render(parameters,view);write_png(output/(name+'-512.png'),pixels)
            validation[name]={'camera':view,'sha256':digest(output/(name+'-512.png')),'changedFromArrival':not np.array_equal(final,pixels)}
        if validation['return']['changedFromArrival']:
            raise RuntimeError('Return capture changed fixed state')
    result={'schema':1,'experimentId':experiment_id,'source':source_meta,'method':1,'parameters':parameters,'camera':camera,'sourceSha256':source_meta['sha256'],'shaderSha256':report['shaderSha256']}
    (output/'candidate.json').write_text(json.dumps(result,indent=2)+'\n')
    report.update(best=measure(source_search,read_png(output/f'best-{search_size}.png')),validation=validation,finishedAt=time.time(),acceptance='Pending Jay visual and exploration acceptance',limitations=['Pixel objective does not establish perceptual improvement or correct geometry.','No collision/interior or hidden-geometry recovery claim.','No browser rendering parity or Seer review of this candidate yet.'])
    (output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    publish_method1(output)
    print(json.dumps({'complete':True,'baseline':report['baseline'],'best':report['best'],'validation':validation}),flush=True)
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source',type=Path,default=REPO/'.runtime/worlds/method1/source.png');parser.add_argument('--output',type=Path,default=REPO/'.runtime/worlds/method1/run1');parser.add_argument('--initial',type=Path);parser.add_argument('--step-scale',type=float,default=1.);parser.add_argument('--objective-version',type=int,choices=[1,2],default=1);args=parser.parse_args();run(args.source,args.output,args.initial,args.step_scale,objective_version=args.objective_version)
