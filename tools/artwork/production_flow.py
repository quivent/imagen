#!/usr/bin/env python3
"""Serial production/precision flow, with optional human review."""
import argparse
import fcntl
import json
from pathlib import Path
import time
import prompt_clarity as study
from study_controller import Controller, atomic, remote_preflight, native_adapter
SETTINGS={'width':512,'height':512,'steps':28,'guidance_scale':3.5,'max_sequence_length':512}
def read_flow(root):
    try:return json.loads((Path(root)/'production-flow.json').read_text())
    except FileNotFoundError:return None
def save_flow(root,state):
    state['updatedAt']=time.time();Path(root).mkdir(parents=True,exist_ok=True);atomic(Path(root)/'production-flow.json',state)
def configure(root):
    corpus=json.loads(study.CORPUS.read_text())
    if any(not s.get('precisionPrompt') for s in corpus['scenes']):raise ValueError('Freeze every precision draft first')
    old=read_flow(root)
    if old:
        if old['corpusHash']!=study.sha(study.canonical(corpus)) or old['settings']!=SETTINGS:raise ValueError('Flow inputs changed; preserve the existing run')
        old.update(enabled=True,stage='running',problem=None);save_flow(root,old);return old
    state={'schema':1,'study':'ADHC-001','enabled':True,'stage':'running','settings':SETTINGS,'corpusHash':study.sha(study.canonical(corpus)),'scenes':[s['id'] for s in corpus['scenes']],'completed':[],'activePackage':None,'problem':None,'createdAt':time.time()}
    save_flow(root,state);return state
def pause(root):
    state=read_flow(root)
    if state:
        state.update(enabled=False,stage='paused');save_flow(root,state)
        if state.get('activePackage'):Controller(state['activePackage'],root).pause()
    return state
def run(root,preflight=remote_preflight,adapter=native_adapter):
    root=Path(root);root.mkdir(parents=True,exist_ok=True)
    with (root/'production-flow.lock').open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:return read_flow(root)
        state=read_flow(root)
        if not state or not state['enabled']:return state
        try:
            for scene_id in state['scenes']:
                state=read_flow(root)
                if not state['enabled']:return state
                if scene_id in state['completed']:continue
                if study.sha(study.canonical(json.loads(study.CORPUS.read_text())))!=state['corpusHash']:raise ValueError('Frozen scene drafts changed; flow stopped before the next request')
                package=study.prepare_corpus(root,state['settings'],scene_id);controller=Controller(package['id'],root);current=controller.status()
                state.update(activePackage=package['id'],activeScene=scene_id);save_flow(root,state)
                if state.get('runtimeIdentity') and current.get('runtimeIdentity') and state['runtimeIdentity']!=current['runtimeIdentity']:raise ValueError('Runtime identity changed between scenes')
                if not current['pairs']:
                    if current['stage']=='needs-attention':raise ValueError('Scene requires receipt reconciliation; no automatic replay')
                    if state.get('runtimeIdentity'):controller.update(lambda s:s.update(runtimeIdentity=state['runtimeIdentity'],preflight=state['preflight']))
                    controller.arm();current=controller.run(preflight,adapter)
                    if current['stage']=='needs-attention':raise ValueError(current.get('problem') or 'Scene needs attention')
                if not current['pairs']:
                    state=read_flow(root);state.update(enabled=False,stage='paused');save_flow(root,state);return state
                latest=read_flow(root)
                if latest.get('runtimeIdentity') and latest['runtimeIdentity']!=current.get('runtimeIdentity'):raise ValueError('Runtime identity changed between scenes')
                latest.setdefault('runtimeIdentity',current.get('runtimeIdentity'));latest.setdefault('preflight',current.get('preflight'));latest['completed'].append(scene_id);save_flow(root,latest)
            state=read_flow(root);state.update(enabled=False,stage='complete',activePackage=None);save_flow(root,state)
        except Exception as error:
            state=read_flow(root);state.update(enabled=False,stage='needs-attention',problem=str(error) if type(error) is ValueError else 'Generation interrupted; reconcile the saved request before resuming.');save_flow(root,state)
        return state
def feed(root):
    state=read_flow(root)
    if not state:return None
    pairs=[];current=None
    for directory in (Path(root)/'runs').iterdir():
        if not (directory/'package.json').is_file():continue
        package=study.load_package(directory.name,root)
        if package['study']!='ADHC-001':continue
        workflow=Controller(package['id'],root).public()
        if package['id']==state.get('activePackage'):current=workflow
        for pair in workflow['pairs']:
            pairs.append({**pair,'id':package['sourceCorpus']['scene']['id'],'requestPair':pair['id'],'package':package['id'],'sceneName':package['sourceCorpus']['scene']['name']})
            if current is None:current=workflow
    pairs.sort(key=lambda p:p['id'],reverse=True)
    flow={**{k:state.get(k) for k in ['enabled','stage','problem','activeScene']},'completedScenes':len(state['completed']),'totalScenes':len(state['scenes'])}
    return {'flow':flow,'workflow':{**current,'pairs':pairs,'completedPairs':len(pairs),'remainingPairs':len(state['scenes'])-len(pairs),'enabled':state['enabled'],'stage':state['stage'],'problem':state.get('problem'),'report':None} if current else None}
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',type=Path,default=study.DEFAULT_ROOT);parser.add_argument('action',choices=['configure','advance','pause','feed']);args=parser.parse_args();print(json.dumps({'configure':configure,'advance':run,'pause':pause,'feed':feed}[args.action](args.root)))
if __name__=='__main__':main()
