"""Method2 run2: bounded real-GLSL refinement, retaining every trial.

Recorded boxes supply soft ROI weights, not segmentation or projected-truth loss.
Source contrast supplies a separate numerical contour objective. Selection rejects
pixel regressions against the baseline; no live scene state is modified.
"""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import shutil
import time
import numpy as np

from fit_parameters import ROOT, REPO, Renderer, digest, set_value
from pixels import read_png, write_png, resize_area, components


def gradient64(image):
    gray=resize_area(np.asarray(image,dtype=float)/255,64) @ np.array([.2126,.7152,.0722])
    dy,dx=np.gradient(gray)
    return np.hypot(dy,dx)


def soft_regions(constraints,size=64):
    weights=np.full((size,size),.25,dtype=float)
    for constraint in constraints:
        x0,y0,x1,y1=constraint['boxTopLeft01']
        left,top=max(0,int(x0*size)),max(0,int(y0*size))
        right,bottom=min(size,int(np.ceil(x1*size))),min(size,int(np.ceil(y1*size)))
        weights[top:bottom,left:right]+=float(constraint['fitWeight'])
    # Bounding boxes express spatial attention only; overlapping hypotheses must
    # not overwhelm the global frame or turn into masks.
    return weights/weights.mean()


def contour_metrics(source,candidate,regions):
    a,b=gradient64(source),gradient64(candidate)
    # Independent upper quantiles compare boundary placement instead of energy.
    # A positive floor prevents a constant image fabricating every pixel as edge.
    source_mask=a>=max(float(np.quantile(a,.85)),1e-6)
    candidate_mask=b>=max(float(np.quantile(b,.85)),1e-6)
    ap,bp=np.argwhere(source_mask),np.argwhere(candidate_mask)
    def directed(points,others):
        if not len(points):return 0. if not len(others) else 1.
        if not len(others):return 1.
        distance=np.sqrt(((points[:,None,:]-others[None,:,:])**2).sum(axis=2)).min(axis=1)/(63*np.sqrt(2))
        weights=regions[points[:,0],points[:,1]]
        return float(np.average(distance,weights=weights))
    source_to_candidate=directed(ap,bp);candidate_to_source=directed(bp,ap)
    chamfer=.5*(source_to_candidate+candidate_to_source)
    density=abs(len(ap)-len(bp))/4096
    return {'weighted_chamfer01':chamfer,'source_to_candidate':source_to_candidate,
            'candidate_to_source':candidate_to_source,'edge_density_difference':density,
            'source_edge_pixels':len(ap),'candidate_edge_pixels':len(bp),
            'contour_total':.9*chamfer+.1*density}


def blend_parameters(baseline,proposal,group_ids,amount):
    result=deepcopy(baseline)
    target={g['id']:g for g in proposal['groups']}
    for group in result['groups']:
        if group['id'] not in group_ids:continue
        for row_index,row in enumerate(group['values']):
            for column,value in enumerate(row):
                end=target[group['id']]['values'][row_index][column]
                row[column]=value+(end-value)*amount
    return result


def run(output,source_path,budget=24):
    if not 1<=budget<=24:raise ValueError('Render budget must be1–24')
    output=Path(output)
    if output.exists() and any(output.iterdir()):raise ValueError('Refuse to overwrite an existing run')
    output.mkdir(parents=True,exist_ok=True)
    source_meta=json.loads((ROOT/'source.json').read_text())
    if digest(source_path)!=source_meta['sha256']:raise ValueError('Source SHA256 mismatch')
    source=resize_area(read_png(source_path),256)
    baseline=json.loads((ROOT/'parameters.json').read_text())
    previous=json.loads((REPO/'.runtime/worlds/method2/candidate.json').read_text())
    evidence=json.loads((REPO/'.runtime/worlds/method2/constraints.json').read_text())
    if previous['evidence']['lineage']['baselineParametersSha256']!=digest(ROOT/'parameters.json'):raise ValueError('Baseline lineage changed')
    camera={'position':[2.3,20.],'look':[-.06,-.06],'clock':0.}
    regions=soft_regions(evidence['constraints'])
    baseline_path=REPO/'.runtime/worlds/method1/run1/baseline-256.png'
    source_report=json.loads((REPO/'.runtime/worlds/method1/run1/report.json').read_text())
    if source_report['shaderSha256']!=digest(ROOT/'scene.frag') or source_report['baselineParameterSha256']!=digest(ROOT/'parameters.json'):raise ValueError('Reused baseline artifact is stale')
    shutil.copyfile(baseline_path,output/'baseline.png')
    base_image=read_png(baseline_path)
    base_pixel=components(source,base_image);base_contour=contour_metrics(source,base_image,regions)
    best=deepcopy(baseline);best_pixel=base_pixel;best_contour=base_contour
    best_joint=.9*base_pixel['weighted_total']+.1*base_contour['contour_total']
    report={'schema':1,'method':2,'run':2,'startedAt':time.time(),'source':source_meta,
            'shaderSha256':digest(ROOT/'scene.frag'),'baselineParameterSha256':digest(ROOT/'parameters.json'),
            'budget':budget,'reusedBaselineRender':str(baseline_path),'visualInspectionByAgent':False,
            'baseline':{'components':base_pixel,'contour':base_contour},'candidates':[],
            'objective':'0.9 parent pixel total +0.1 numerical contour total; eligible only if pixel loss <= baseline.',
            'contourDefinition':'Symmetric nearest-neighbour distance between top15% luminance-gradient pixels at64square, softly ROI weighted by attributed boxes, +0.1 edge-density difference. No segmentation or depth.',
            'coordinateAmbiguity':'Gemma integer boxes retain pixel/1000-grid ambiguity; pixel hypothesis downweighted; no hard projection fitting.',
            'route':'macOS persistent CGL; unchanged pureGLSL scene; no model/service startup'}
    (output/'baseline.json').write_text(json.dumps({'parameters':baseline,'camera':camera,'components':base_pixel,'contour':base_contour},indent=2)+'\n')
    proposals=[]
    for amount in [.15,.35,.65,1.]:proposals.append(('tower blend '+str(amount),{'buildings-0','buildings-1'},amount))
    # Previous proposal alters only the closest instance on each side. Per-side
    # trials change only that instance, avoiding a coupled-palm shrink assumption.
    for side in [0,1]:
        for amount in [.03,.08,.15]:proposals.append((f'palm{side} blend {amount}',{'palms-0','palms-1'},amount,side))
    for amount in [.03,.08,.15,.3]:proposals.append(('all surrogate blend '+str(amount),None,amount))
    controls=[('channel.width','world-11',0,0,.2),('channel.bend','world-11',0,1,.25),
              ('bank.height','world-12',0,2,.12),('foothill.height','world-13',0,2,2.),
              ('tower.x','buildings-0',0,0,1.)]
    for control in controls:
        for direction in [-1,1]:proposals.append((control[0],control,direction))
    if len(proposals)!=24 or budget>24:raise ValueError('Maximum24 actual proposal renders')
    with Renderer(width=256,height=256) as renderer:
        for index,proposal in enumerate(proposals[:budget],1):
            label=proposal[0]
            if isinstance(proposal[1],tuple):
                candidate=deepcopy(best);_,key,row,col,step=proposal[1]
                group=next(g for g in candidate['groups'] if g['id']==key)
                set_value(candidate,key,row,col,group['values'][row][col]+proposal[2]*step)
                label+=' '+str(proposal[2])
            else:
                ids=proposal[1] or {g['id'] for g in baseline['groups']}
                candidate=blend_parameters(baseline,previous['parameters'],ids,proposal[2])
                if len(proposal)==4:
                    side=proposal[3]
                    bg={g['id']:g for g in baseline['groups']}
                    for group in candidate['groups']:
                        if group['id'] in ids:
                            for row in range(len(group['values'])):
                                if row!=side:group['values'][row]=deepcopy(bg[group['id']]['values'][row])
            image=renderer.render(candidate,camera)
            pixel=components(source,image);contour=contour_metrics(source,image,regions)
            joint=.9*pixel['weighted_total']+.1*contour['contour_total']
            eligible=pixel['weighted_total']<=base_pixel['weighted_total']
            selected=eligible and joint<best_joint
            filename=f'candidate-{index:02}.png';state=f'candidate-{index:02}.json'
            write_png(output/filename,image)
            record={'id':index,'label':label,'render':filename,'parameters':state,'sha256':digest(output/filename),
                    'components':pixel,'contour':contour,'joint':joint,'eligible':eligible,'newBest':selected,'camera':camera}
            full={'schema':1,'method':2,'run':2,'parameters':candidate,'camera':camera,'evaluation':record,
                  'sourceSha256':source_meta['sha256'],'shaderSha256':report['shaderSha256']}
            (output/state).write_text(json.dumps(full,indent=2)+'\n')
            report['candidates'].append(record)
            if selected:
                best,best_pixel,best_contour,best_joint=candidate,pixel,contour,joint
                shutil.copyfile(output/filename,output/'best.png')
                report['bestId']=index
            report.update(best={'components':best_pixel,'contour':best_contour,'joint':best_joint})
            (output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
            print(json.dumps({'candidate':index,'label':label,'pixel':pixel['weighted_total'],
                'contour':contour['contour_total'],'eligible':eligible,'selected':selected}),flush=True)
    if not (output/'best.png').exists():shutil.copyfile(output/'baseline.png',output/'best.png')
    report['bestPixelId']=min(report['candidates'],key=lambda c:c['components']['weighted_total'])['id']
    report['bestContourId']=min(report['candidates'],key=lambda c:c['contour']['contour_total'])['id']
    report['finishedAt']=time.time();report['actualProposalRenders']=len(report['candidates'])
    report['acceptance']='Pending Jay visual/traversal acceptance; no live scene changed.'
    (output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    (output/'candidate.json').write_text(json.dumps({'schema':1,'method':2,'run':2,'parameters':best,'camera':camera,
        'evidence':{'report':'report.json','constraints':'../constraints.json'},'sourceSha256':source_meta['sha256'],
        'shaderSha256':report['shaderSha256']},indent=2)+'\n')
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,default=REPO/'.runtime/worlds/method2/run2');parser.add_argument('--source',type=Path,default=REPO/'.runtime/worlds/method2/source.png');parser.add_argument('--budget',type=int,default=24)
    args=parser.parse_args();result=run(args.output,args.source,args.budget)
    print(json.dumps({'complete':True,'renders':result['actualProposalRenders'],'baseline':result['baseline'],'best':result['best']}))
