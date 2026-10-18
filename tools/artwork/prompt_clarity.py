#!/usr/bin/env python3
"""Prepare the frozen FLUX.1 prompt A/B. No command starts inference."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import sys

REPO=Path(__file__).resolve().parents[2]
DEFAULT_ROOT=REPO/'.runtime/research/flux1-prompt-clarity'
PLAN=REPO/'research/studies/flux1-prompt-clarity/plan.json'
CATALOG=REPO/'public/worlds/experiments.json'
CORPUS=REPO/'research/studies/art-direction-held-constant/corpus.json'

def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False)

def sha(value):
    return hashlib.sha256(value.encode()).hexdigest()

def compile_package(plan=None,catalog=None):
    plan=plan if plan is not None else json.loads(PLAN.read_text())
    catalog=catalog if catalog is not None else json.loads(CATALOG.read_text())
    source=next(row['source'] for row in catalog['experiments'] if row['id']==plan['sourceExperiment'])
    if source['id']!=plan['sourceJobId'] or source['profile']!='flux1-dev' or plan['model']!='flux1-dev':
        raise ValueError('Historical source/model identity changed')
    settings=plan['settings']
    if set(settings)!={'width','height','steps','guidance_scale','max_sequence_length'}:
        raise ValueError('Unexpected generation controls')
    expected={'width':source['width'],'height':source['height'],**{k:v for k,v in source['settings'].items() if k!='seed'}}
    if settings!=expected:
        raise ValueError('Replication controls differ from the historical baseline; design a separate revision')
    seeds=plan['seeds']
    if not seeds or len(seeds)>10 or len(set(seeds))!=len(seeds) or any(type(s) is not int or not 0<=s<2**32 for s in seeds):
        raise ValueError('Use one to ten distinct paired seeds')
    prompts={'A':source['prompt'],'B':plan['arms']['B']['prompt']}
    if any(not isinstance(p,str) or not 1<=len(p)<=20000 for p in prompts.values()) or prompts['A']==prompts['B']:
        raise ValueError('Two distinct frozen prompts are required')
    design={'schema':1,'study':plan['id'],'sourceExperiment':plan['sourceExperiment'],'sourceJobId':source['id'],'model':'flux1-dev','precisionPolicy':plan['precisionPolicy'],'settings':settings,'seeds':seeds,'prompts':prompts,'promptHashes':{k:sha(v) for k,v in prompts.items()},'knownDiscrepancies':plan['knownDiscrepancies']}
    identity=sha(canonical(design))
    pairs=[]
    for i,seed in enumerate(seeds):
        arms=['A','B'] if i%2==0 else ['B','A']
        left='A' if int(sha(identity+':'+str(seed))[0],16)%2==0 else 'B'
        pairs.append({'id':f'pair-{i+1:02d}','seed':seed,'submissionOrder':arms,'reviewSlots':{'left':left,'right':'B' if left=='A' else 'A'}})
    requests=[]
    for pair in pairs:
        for arm in pair['submissionOrder']:
            requests.append({'scene':f'fpc-{identity[:12]}-{pair["id"]}','name':f'Prompt Clarity · {pair["id"]} · {arm}','backend':'command','model':'flux1-dev','prompt':prompts[arm],'width':settings['width'],'height':settings['height'],'settings':{k:v for k,v in settings.items() if k not in ('width','height')}|{'seed':pair['seed']},'variant':identity+'-'+arm,'family':'landscape'})
    return {'id':identity,**design,'status':'prepared','execution':{'started':False,'backend':'command','concurrency':1,'liveIdentityVerified':False,'tokenizationVerified':False},'pairs':pairs,'requests':requests,'plannedImages':len(requests)}

def compile_corpus_package(settings,scene_id='scene-001',corpus=None,seed=42):
    """Freeze one exact production scene and its saved precision rewrite, offline."""
    if corpus is None:
        corpus=json.loads(CORPUS.read_text())
        source=(REPO/corpus['source']).read_bytes()
        if hashlib.sha256(source).hexdigest()!=corpus['sourceSha256']:
            raise ValueError('Production catalog changed; reconcile the frozen corpus')
        original=next((row for row in json.loads(source)['scenes'] if row['id']==scene_id),None)
        frozen=next((row for row in corpus['scenes'] if row['id']==scene_id),None)
        if original is None or frozen is None or any(frozen.get(k)!=v for k,v in original.items()):
            raise ValueError('Production scene changed')
    if set(settings)!={'width','height','steps','guidance_scale','max_sequence_length'}:
        raise ValueError('Supply all five explicit generation controls')
    if type(seed) is not int or not 0<=seed<2**32:raise ValueError('Invalid paired seed')
    settings=dict(settings)
    for key in ('width','height'):
        if type(settings[key]) is not int or not 64<=settings[key]<=4096 or settings[key]%8:
            raise ValueError('Dimensions must be supported positive multiples of eight')
    for key,maximum in (('steps',200),('max_sequence_length',512)):
        if type(settings[key]) is not int or not 1<=settings[key]<=maximum:
            raise ValueError('Invalid generation control')
    guidance=settings['guidance_scale']
    if type(guidance) not in (int,float) or not math.isfinite(guidance) or not 0<=guidance<=100:
        raise ValueError('Invalid guidance')
    scene=next((row for row in corpus['scenes'] if row['id']==scene_id),None)
    if scene is None:raise ValueError('Unknown production scene')
    prompts={'A':scene['prompt'],'B':scene.get('precisionPrompt')}
    if any(not isinstance(p,str) or not p.strip() or len(p)>20000 for p in prompts.values()) or prompts['A']==prompts['B']:
        raise ValueError('A saved distinct precision draft is required')
    if sha(prompts['A'])!=scene['productionPromptSha256'] or not scene.get('precisionAuthor') or scene.get('precisionStatus') not in ('draft','ready','approved'):
        raise ValueError('Production source or precision authorship invalid')
    if not re.fullmatch('[a-f0-9]{64}',corpus['sourceSha256']):raise ValueError('Invalid corpus source identity')
    # Copy through JSON so callers cannot mutate the returned frozen source indirectly.
    frozen_scene=json.loads(canonical(scene))
    design={'schema':2,'study':'ADHC-001','model':'flux1-dev',
        'sourceCorpus':{'source':corpus['source'],'sourceSha256':corpus['sourceSha256'],'scene':frozen_scene},
        'precisionPolicy':'Hold the actual checkpoint and runtime precision identical within the pair; verify live identity before execution.',
        'settings':settings,'seeds':[seed],'prompts':prompts,'promptHashes':{k:sha(v) for k,v in prompts.items()},
        'knownDiscrepancies':['Production and precision prompts retain the original 1536x1024 prose; explicit runtime dimensions apply equally.']}
    identity=sha(canonical(design));left='A' if int(sha(identity+':'+str(seed))[0],16)%2==0 else 'B'
    pair={'id':'pair-01','sceneId':scene_id,'seed':seed,'submissionOrder':['A','B'],'reviewSlots':{'left':left,'right':'B' if left=='A' else 'A'}}
    requests=[{'scene':f'adhc-{identity[:12]}-{scene_id}','name':f'Production parity · {scene["name"]} · {arm}',
        'backend':'command','model':'flux1-dev','prompt':prompts[arm],'width':settings['width'],'height':settings['height'],
        'settings':{k:v for k,v in settings.items() if k not in ('width','height')}|{'seed':seed},
        'variant':identity+'-'+arm,'family':'landscape'} for arm in pair['submissionOrder']]
    return {'id':identity,**design,'status':'prepared','execution':{'started':False,'backend':'command','concurrency':1,'liveIdentityVerified':False,'tokenizationVerified':False},'pairs':[pair],'requests':requests,'plannedImages':2}

def _save_package(package,root):
    directory=Path(root)/'runs'/package['id'];directory.mkdir(parents=True,exist_ok=True)
    content=json.dumps(package,ensure_ascii=False,indent=2)+'\n';file=directory/'package.json'
    if file.exists():
        if file.read_text()!=content:raise ValueError('Existing package changed; preserve and reconcile it')
    else:
        with file.open('x') as target:target.write(content)
    argv=[sys.executable,'-B',str(REPO/'deployment/controller/tools/artwork/remote/adapter.py')]
    arguments=directory/'adapter-argv.json'
    if not arguments.exists():
        with arguments.open('x') as target:json.dump(argv,target)
    return package

def prepare(root=DEFAULT_ROOT):
    return _save_package(compile_package(),root)

def prepare_corpus(root=DEFAULT_ROOT,settings=None,scene_id='scene-001',seed=42):
    if settings is None:raise ValueError('Explicit runtime settings are required')
    return _save_package(compile_corpus_package(settings,scene_id,seed=seed),root)

def load_package(identity,root=DEFAULT_ROOT):
    if not re.fullmatch('[a-f0-9]{64}',identity):raise ValueError('Invalid package identity')
    file=Path(root)/'runs'/identity/'package.json';package=json.loads(file.read_text())
    if package.get('schema')==2:
        source=package['sourceCorpus']
        rebuilt=compile_corpus_package(package['settings'],source['scene']['id'],
            {'source':source['source'],'sourceSha256':source['sourceSha256'],'scenes':[source['scene']]},seed=package['seeds'][0])
        if package['id']!=identity or rebuilt!=package:raise ValueError('Corpus package integrity mismatch')
        return package
    keys=('schema','study','sourceExperiment','sourceJobId','model','precisionPolicy','settings','seeds','prompts','promptHashes','knownDiscrepancies')
    if package['id']!=identity or sha(canonical({k:package[k] for k in keys}))!=identity:raise ValueError('Package integrity mismatch')
    # Rebuild derived requests from frozen data, so editing a packet cannot change execution.
    source={'id':package['sourceJobId'],'profile':'flux1-dev','prompt':package['prompts']['A'],'width':package['settings']['width'],'height':package['settings']['height'],'settings':{k:v for k,v in package['settings'].items() if k not in ('width','height')}|{'seed':package['seeds'][0]}}
    plan={'id':package['study'],'sourceExperiment':package['sourceExperiment'],'sourceJobId':source['id'],'model':'flux1-dev','precisionPolicy':package['precisionPolicy'],'settings':package['settings'],'seeds':package['seeds'],'arms':{'B':{'prompt':package['prompts']['B']}},'knownDiscrepancies':package['knownDiscrepancies']}
    if compile_package(plan,{'experiments':[{'id':package['sourceExperiment'],'source':source}]})!=package:raise ValueError('Derived package data changed')
    return package

def enqueue(identity,root=DEFAULT_ROOT):
    package=load_package(identity,root);directory=Path(root)/'runs'/identity
    sys.path.insert(0,str(REPO/'deployment/controller/tools/artwork'))
    from store import Store
    store=Store(directory/'factory')
    jobs=[store.enqueue(request) for request in package['requests']]
    return {'package':identity,'enqueued':len(jobs),'jobs':jobs,'factory':str((directory/'factory').resolve()),'adapterArguments':str((directory/'adapter-argv.json').resolve()),'inferenceStarted':False}

def status(root=DEFAULT_ROOT):
    base=Path(root)/'runs';rows=[]
    if base.exists():
        for directory in sorted(base.iterdir(),key=lambda p:p.stat().st_mtime,reverse=True)[:50]:
            if directory.is_dir() and re.fullmatch('[a-f0-9]{64}',directory.name):
                p=load_package(directory.name,root)
                try:control=json.loads((directory/'control.json').read_text())
                except FileNotFoundError:control={}
                rows.append({'id':p['id'],'study':p['study'],'sceneId':p.get('sourceCorpus',{}).get('scene',{}).get('id'),'plannedImages':p['plannedImages'],'status':control.get('stage','prepared'),'completedPairs':len(control.get('pairs',{})),'enqueued':(directory/'factory/queue.sqlite3').exists()})
    return {'study':'FPC-001','runs':rows,'completedPairs':sum(row['completedPairs'] for row in rows),'generationStartedByPreparation':False}

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',type=Path,default=DEFAULT_ROOT)
    commands=parser.add_subparsers(dest='action',required=True)
    commands.add_parser('preview');commands.add_parser('prepare');commands.add_parser('status');p=commands.add_parser('enqueue');p.add_argument('package')
    p=commands.add_parser('prepare-corpus');p.add_argument('--scene',default='scene-001');p.add_argument('--seed',type=int,default=42)
    args=parser.parse_args()
    if args.action=='preview':value=compile_package()
    elif args.action=='prepare':value=prepare(args.root)
    elif args.action=='prepare-corpus':value=prepare_corpus(args.root,json.load(sys.stdin),args.scene,args.seed)
    elif args.action=='status':value=status(args.root)
    else:value=enqueue(args.package,args.root)
    print(json.dumps(value,ensure_ascii=False))
if __name__=='__main__':
    try:main()
    except (ValueError,KeyError,StopIteration,OSError):
        print('Study operation stopped; verify the frozen package and reconcile existing records.',file=sys.stderr);sys.exit(1)
