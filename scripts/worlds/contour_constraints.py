"""Method 2: attributed screen constraints and a separate geometry-only proposal.

No image display or inference service is used. Recorded boxes remain hypotheses;
measured gradients are contrast contours, never semantic segmentation or depth.
"""
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import struct
import zlib

import numpy as np


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read_png(raw):
    """Decode bounded 8-bit, non-interlaced RGB/RGBA PNGs without image viewers."""
    if raw[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('PNG signature required')
    pos, compressed, header = 8, bytearray(), None
    while pos < len(raw):
        size = struct.unpack_from('>I', raw, pos)[0]
        tag, data = raw[pos + 4:pos + 8], raw[pos + 8:pos + 8 + size]
        if len(data) != size or pos + 12 + size > len(raw):
            raise ValueError('truncated PNG chunk')
        crc = struct.unpack_from('>I', raw, pos + 8 + size)[0]
        if zlib.crc32(tag + data) & 0xffffffff != crc:
            raise ValueError('PNG CRC mismatch')
        if tag == b'IHDR':
            header = struct.unpack('>IIBBBBB', data)
        elif tag == b'IDAT':
            compressed.extend(data)
        elif tag == b'IEND':
            break
        pos += size + 12
    if header is None:
        raise ValueError('missing PNG header')
    width, height, bits, kind, compression, filtering, interlace = header
    if bits != 8 or kind not in (2, 6) or compression or filtering or interlace:
        raise ValueError('requires non-interlaced 8-bit RGB/RGBA PNG')
    if width * height > 16_777_216 or not width or not height:
        raise ValueError('unsupported PNG dimensions')
    channels = 3 if kind == 2 else 4
    stride = width * channels
    expected = (stride + 1) * height
    dec = zlib.decompressobj()
    scan = dec.decompress(compressed, expected + 1)
    if len(scan) != expected or not dec.eof:
        raise ValueError('invalid PNG scanline length')
    pixels = np.empty((height, stride), dtype=np.uint8)
    for y in range(height):
        mode, row = scan[y * (stride + 1)], scan[y * (stride + 1) + 1:(y + 1) * (stride + 1)]
        prior = pixels[y - 1] if y else np.zeros(stride, dtype=np.uint8)
        for x, value in enumerate(row):
            a = int(pixels[y, x - channels]) if x >= channels else 0
            b = int(prior[x])
            c = int(prior[x - channels]) if x >= channels else 0
            if mode == 0:
                predictor = 0
            elif mode == 1:
                predictor = a
            elif mode == 2:
                predictor = b
            elif mode == 3:
                predictor = (a + b) // 2
            elif mode == 4:
                p = a + b - c
                distances = (abs(p - a), abs(p - b), abs(p - c))
                predictor = (a, b, c)[distances.index(min(distances))]
            else:
                raise ValueError('invalid PNG filter')
            pixels[y, x] = (value + predictor) & 255
    return pixels.reshape(height, width, channels)[:, :, :3]


def normalise_box(box, width, height):
    if len(box) != 4 or not all(isinstance(v, (float, int)) and math.isfinite(v) for v in box):
        raise ValueError('four finite box coordinates required')
    if box[0] >= box[2] or box[1] >= box[3] or min(box) < 0:
        raise ValueError('invalid ordered box')
    if max(box) <= 1:
        return list(box), {'convention': 'reported_normalized', 'ambiguity': False, 'weightMultiplier': .5}
    pixel = [box[0] / width, box[1] / height, box[2] / width, box[3] / height]
    if max(pixel) > 1:
        raise ValueError('pixel-like box exceeds source dimensions')
    return pixel, {
        'convention': 'pixel_hypothesis', 'ambiguity': True,
        'weightMultiplier': .25,
        'alternative1000Grid': [v / 1000 for v in box] if max(box) <= 1000 else None,
        'reason': 'Model supplied integers without declaring pixel or 0–1000 coordinate convention; no silent resolution.'}


def evidence(analysis, source):
    constraints, warnings = [], []
    for model, review in analysis['reviews'].items():
        inventory = review.get('passes', {}).get('spatial_inventory', {}).get('structured', {})
        for element in inventory.get('elements', []):
            raw_box = element.get('bbox')
            try:
                box, coordinate = normalise_box(raw_box, source['width'], source['height'])
            except (ValueError, TypeError) as err:
                warnings.append({'model': model, 'id': element.get('id'), 'error': str(err)})
                continue
            confidence = max(0., min(1., float(element.get('confidence', .5))))
            constraints.append({
                'id': f'{model.lower()}-{element["id"]}', 'kind': 'model_bbox_hypothesis',
                'model': model, 'label': element.get('type'), 'rawEvidence': copy.deepcopy(element),
                'boxTopLeft01': box, 'coordinates': coordinate,
                'modelReportedConfidence': confidence,
                'fitWeight': confidence * coordinate['weightMultiplier'],
                'uncertainty': 'Approximate reported bounding box; no segmentation, verified outline or recovered depth.',
                'occlusion': {'occludes': element.get('occludes_ids', element.get('occludes', [])),
                              'occludedBy': element.get('occluded_by_ids', element.get('occluded_by', []))}})
    return constraints, warnings


def edge_measurements(rgb, size=128):
    """Average source pixels then extract gradients with top-left coordinates."""
    height, width = rgb.shape[:2]
    ys = np.linspace(0, height, min(size, height) + 1).astype(int)
    xs = np.linspace(0, width, min(size, width) + 1).astype(int)
    gray = rgb.astype(float) @ np.array([.2126, .7152, .0722]) / 255
    grid = np.array([[gray[ys[y]:ys[y+1], xs[x]:xs[x+1]].mean()
                      for x in range(len(xs)-1)] for y in range(len(ys)-1)])
    dy, dx = np.gradient(grid)
    magnitude = np.hypot(dx, dy)
    threshold = max(1e-6, float(np.quantile(magnitude, .85)))
    points = []
    # One strongest vertical contrast in each column inside the model-supported
    # mountain/roofline band. This is a proposal trace, not a labelled skyline.
    start, stop = max(1, int(len(grid)*.12)), max(2, int(len(grid)*.5))
    for x in range(0, grid.shape[1], 2):
        y = start + int(np.argmax(np.abs(dy[start:stop, x])))
        strength = float(abs(dy[y, x]))
        points.append({'xy': [(x+.5)/grid.shape[1], (y+.5)/grid.shape[0]],
                       'strength': strength, 'fitWeight': .2 if strength >= threshold else (0. if strength < 1e-6 else .05),
                       'semanticLabel': None})
    return {'kind': 'numerical_luminance_contrast', 'gridShape': list(grid.shape),
            'luminanceConvention': 'sRGB code-value luma; not physical radiance',
            'gradientMagnitude': magnitude.tolist(), 'threshold85Percentile': threshold,
            'strongPixelCount': int((magnitude >= threshold).sum()),
            'upperBandContrastTrace': points,
            'semanticLabels': False, 'segmentation': False, 'depthRecovered': False,
            'limitations': 'Edges may be texture, shadow, reflection or geometry. Trace is not a verified ridge outline.'}


def groups(parameters):
    return {g['id']: g for g in parameters['groups']}


def scalar(parameters, name):
    for group in parameters['groups']:
        if name in group['fields']:
            return group['values'][0][group['fields'].index(name)]
    raise KeyError(name)


def terrain(parameters, x, z):
    """Double-precision surrogate of existing terrain GLSL for projection only."""
    g = groups(parameters)
    def fract(v): return v - math.floor(v)
    def noise(x, y):
        ix, iy = math.floor(x), math.floor(y)
        fx, fy = fract(x), fract(y)
        fx, fy = fx*fx*(3-2*fx), fy*fy*(3-2*fy)
        def h(x,y): return fract(math.sin(x*127.1+y*311.7)*43758.5453)
        return (h(ix,iy)*(1-fx)+h(ix+1,iy)*fx)*(1-fy)+(h(ix,iy+1)*(1-fx)+h(ix+1,iy+1)*fx)*fy
    def fbm(x,y):
        return .55*noise(x,y)+scalar(parameters,'terrain.octaveWeight')*noise(x*2.03,y*2.03)+.14*noise(x*4.09,y*4.09)
    weights = [math.exp(-((z-row[0])/max(row[3],.1))**2) for row in g['banks-0']['values']]
    total = max(sum(weights), .0001)
    section = [sum(w * (a[1],a[2],b[0],b[1])[i] for w,a,b in zip(weights,g['banks-0']['values'],g['banks-1']['values']))/total for i in range(4)]
    channel = scalar(parameters,'channel.bendAmplitude')*math.sin(z*scalar(parameters,'channel.bendFrequency'))+scalar(parameters,'channel.secondaryBend')*math.sin(z*.13)+section[1]
    hills = max(0,abs(x)*scalar(parameters,'terrain.slope')-.75)**1.35*6
    t = max(0,min(1,(-z-scalar(parameters,'foothill.start'))/38))
    hills += t*t*(3-2*t)*scalar(parameters,'foothill.height')*.2
    for a,b in zip(g['ridges-0']['values'],g['ridges-1']['values']):
        qx,qz = x-a[0],z-a[1]
        c,s = math.cos(b[1]), math.sin(b[1])
        qx,qz = c*qx-s*qz,(s*qx+c*qz)*b[0]
        freq=scalar(parameters,'terrain.noiseFrequency')
        hills += math.exp(-(qx*qx+qz*qz)/max(a[3],.2)**2)*a[2]*(.7+b[2]*.25*fbm(x*freq,z*freq))
    edge=abs(x-channel)-(scalar(parameters,'channel.halfWidth')*section[0]+section[3]*noise(x*4,z*4))
    t=max(0,min(1,edge/scalar(parameters,'bank.transitionWidth')))
    t=t*t*(3-2*t)
    return -scalar(parameters,'channel.depth')*(1-t)+(scalar(parameters,'bank.height')+section[2]+hills+.1*noise(x*.7,z*.7))*t


def project(parameters, point, camera):
    x,z=camera['position']; yaw,pitch=camera['look']
    eye=np.array([x,terrain(parameters,x,z)+scalar(parameters,'camera.eyeHeight'),z])
    forward=np.array([math.sin(yaw)*math.cos(pitch),math.sin(pitch),-math.cos(yaw)*math.cos(pitch)])
    right=np.cross(forward,[0,1,0]);right/=np.linalg.norm(right)
    up=np.cross(right,forward)
    delta=np.array(point)-eye
    depth=float(delta@forward)
    if depth<=.01:return None
    focal=scalar(parameters,'camera.focalLength')
    return [.5+focal*float(delta@right)/depth,.5-focal*float(delta@up)/depth]


def projected_box(parameters, kind, index, camera):
    g=groups(parameters)
    if kind=='tower':
        a,b=g['buildings-0']['values'][index],g['buildings-1']['values'][index]
        x,z=a[:2]; radius=a[2]/2;depth=a[3]/2; base=terrain(parameters,x,z);top=base+b[0]+b[2]
    else:
        a,b=g['palms-0']['values'][index],g['palms-1']['values'][index]
        x,z=a[:2];radius=b[2];depth=b[2];base=terrain(parameters,x,z);top=base+a[2]+b[3]
    points=[project(parameters,[x+sx*radius,y,z+sz*depth],camera) for sx in [-1,1] for sz in [-1,1] for y in [base,top]]
    if any(p is None for p in points):return [-10,-10,10,10]
    return [min(p[0] for p in points),min(p[1] for p in points),max(p[0] for p in points),max(p[1] for p in points)]


def make_candidate(parameters, constraints, seed=42, iterations=600):
    """Fit only supported projected boxes, retaining authored depths as fixed priors."""
    candidate=copy.deepcopy(parameters)
    camera={'position':[2.3,20.], 'look':[-.06,-.06]}
    by_id={c['id']:c for c in constraints}
    targets=[('tower',0,['pixtral-7','gemma-8']),('palm',0,['pixtral-2','gemma-1']),('palm',1,['pixtral-3','gemma-2'])]
    # Select the two closest palms as framing hypotheses; immutable shader forms.
    variables=[('buildings-0',0,0),('buildings-0',0,2),('buildings-1',0,0),
               ('palms-0',0,0),('palms-0',0,2),('palms-1',0,2),
               ('palms-0',1,0),('palms-0',1,2),('palms-1',1,2)]
    initial=groups(parameters)
    regularisation=[]
    for key,row,col in variables:
        low,high=initial[key]['limits'][col]
        regularisation.append((initial[key]['values'][row][col],high-low))
    def score(p):
        terms=[]
        for kind,index,ids in targets:
            prediction=np.array(projected_box(p,kind,index,camera))
            for cid in ids:
                if cid in by_id:
                    c=by_id[cid]
                    # Huber-like soft L1 prevents one unverified box dominating.
                    delta=np.abs(prediction-np.array(c['boxTopLeft01']))
                    terms.append(c['fitWeight']*float(np.sum(np.where(delta<.1,delta*delta/.2,delta-.05))))
        pg=groups(p)
        prior=sum(((pg[k]['values'][r][c]-v)/span)**2 for (k,r,c),(v,span) in zip(variables,regularisation))
        return sum(terms)+.02*prior
    before=score(candidate);best=before; rng=np.random.default_rng(seed)
    history=[]
    for i in range(iterations):
        proposal=copy.deepcopy(candidate);pg=groups(proposal)
        k,r,c=variables[i%len(variables)];low,high=pg[k]['limits'][c]
        step=(high-low)*(.045 if i<iterations//2 else .012)
        pg[k]['values'][r][c]=max(low,min(high,pg[k]['values'][r][c]+float(rng.normal())*step))
        loss=score(proposal)
        if loss<best:
            candidate,best=proposal,loss;history.append({'iteration':i+1,'loss':loss})
    changes=[]
    for k,r,c in variables:
        old=initial[k]['values'][r][c];new=groups(candidate)[k]['values'][r][c]
        if old!=new:changes.append({'group':k,'row':r,'field':initial[k]['fields'][c],'before':old,'after':new})
    diagnostics=[]
    for kind,index,ids in targets:
        diagnostics.append({'kind':kind,'instance':index,'targets':ids,'projectedBefore':projected_box(parameters,kind,index,camera),'projectedAfter':projected_box(candidate,kind,index,camera)})
    return candidate, {'method':2,'name':'recorded-box geometry surrogate fit','seed':seed,'iterations':iterations,
        'camera':camera,'scoreBefore':before,'scoreAfter':best,'acceptedProposals':len(history),'history':history,
        'changedParameters':changes,'projectedBounds':diagnostics,
        'depthPolicy':'Original object z positions held fixed as authored priors; no recovered depth.',
        'limitations':['Fits coarse attributed boxes, not true silhouettes.',
        'Palm envelope includes empty corner space; exact frond silhouettes require shader renders.',
        'CPU terrain uses double precision; GLSL float procedural noise may differ.',
        'No image-space fidelity or translated-view acceptance claimed until actual GLSL render validation.']}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,default=Path('public/worlds/draa-valley/source.json'))
    parser.add_argument('--analysis',type=Path,default=Path('public/worlds/draa-valley/analysis.json'))
    parser.add_argument('--parameters',type=Path,default=Path('public/worlds/draa-valley/parameters.json'))
    parser.add_argument('--image',type=Path,required=True)
    parser.add_argument('--output',type=Path,default=Path('.runtime/worlds/method2'))
    parser.add_argument('--iterations',type=int,default=600)
    args=parser.parse_args()
    source_raw=args.source.read_bytes();analysis_raw=args.analysis.read_bytes();parameter_raw=args.parameters.read_bytes();image_raw=args.image.read_bytes()
    source=json.loads(source_raw);analysis=json.loads(analysis_raw);parameters=json.loads(parameter_raw)
    if sha(image_raw)!=source['sha256']:raise ValueError('source image hash mismatch')
    if analysis['source']['id']!=source['id'] or analysis['source']['sha256']!=source['sha256']:raise ValueError('analysis source identity mismatch')
    rgb=read_png(image_raw)
    if list(rgb.shape[:2])!=[source['height'],source['width']]:raise ValueError('source dimensions mismatch')
    constraints,warnings=evidence(analysis,source)
    edges=edge_measurements(rgb)
    candidate,fit=make_candidate(parameters,constraints,iterations=args.iterations)
    lineage={'sourceId':source['id'],'sourceSha256':source['sha256'],'analysisSha256':sha(analysis_raw),
             'baselineParametersSha256':sha(parameter_raw),'shaderSha256':sha((args.parameters.parent/'scene.frag').read_bytes()),
             'imageViewedByAgent':False,'modelRequestsMade':False,'pureGLSLRuntime':True}
    report={'schema':1,'method':2,'lineage':lineage,'coordinateConvention':'top-left xyxy normalized 0–1',
        'constraints':constraints,'warnings':warnings,'numericalEdges':edges,
        'policy':'Recorded model hypotheses and numerical contrast only. No new semantic observations fabricated.'}
    fit['lineage']=lineage
    args.output.mkdir(parents=True,exist_ok=True)
    proposal={'schema':1,'method':2,'parameters':candidate,'camera':fit['camera'],
              'evidence':{'constraints':'constraints.json','fit':'candidate.fit.json','lineage':lineage}}
    for name,value in [('constraints.json',report),('candidate.parameters.json',candidate),('candidate.fit.json',fit),('candidate.json',proposal)]:
        (args.output/name).write_text(json.dumps(value,indent=2)+'\n')
    print(json.dumps({'constraints':len(constraints),'ambiguousBoxes':sum(c['coordinates']['ambiguity'] for c in constraints),
        'numericalContrastPoints':len(edges['upperBandContrastTrace']),'changedScalars':len(fit['changedParameters']),
        'surrogateBefore':fit['scoreBefore'],'surrogateAfter':fit['scoreAfter'],'output':str(args.output)}))


if __name__=='__main__':main()
