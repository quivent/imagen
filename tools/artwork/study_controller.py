#!/usr/bin/env python3
"""Durable bounded FLUX.1 study control. Inference requires an explicit start."""
import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import shutil
import statistics
import subprocess
import sys
import threading
import time

import prompt_clarity as study

DEFAULT_GUIDANCE={'maxPairs':3,'reviewEvery':1,'focus':'Composition, spatial coherence, materials and artistic appeal.'}

def validate_guidance(value):
    if not isinstance(value,dict) or set(value)!=set(DEFAULT_GUIDANCE):raise ValueError('Incomplete guidance')
    if any(type(value[k]) is not int or not 1<=value[k]<=3 for k in ('maxPairs','reviewEvery')):raise ValueError('Choose one to three pairs')
    if not isinstance(value['focus'],str) or len(value['focus'])>2000:raise ValueError('Guidance is too long')
    return dict(value)

def atomic(file,value):
    temporary=file.with_name(file.name+'.'+str(os.getpid())+'.tmp')
    with temporary.open('w') as f:json.dump(value,f,ensure_ascii=False,indent=2);f.flush();os.fsync(f.fileno())
    temporary.chmod(0o600);temporary.replace(file)

class Controller:
    def __init__(self,identity,root=study.DEFAULT_ROOT):
        self.root=Path(root).resolve();self.package=study.load_package(identity,self.root)
        self.directory=self.root/'runs'/identity;self.identity=identity
    @contextmanager
    def lock(self,name='control.lock',blocking=True):
        with (self.directory/name).open('a') as f:
            os.fchmod(f.fileno(),0o600)
            fcntl.flock(f,fcntl.LOCK_EX|(0 if blocking else fcntl.LOCK_NB))
            try:yield
            finally:fcntl.flock(f,fcntl.LOCK_UN)
    def initial(self):
        guidance={**DEFAULT_GUIDANCE,'maxPairs':min(DEFAULT_GUIDANCE['maxPairs'],len(self.package['pairs']))}
        return {'schema':1,'package':self.identity,'stage':'prepared','enabled':False,'guidance':guidance,'pairs':{},'reviews':{},'events':[],'problem':None,'updatedAt':time.time(),'expiresAt':None}
    def read(self):
        try:return json.loads((self.directory/'control.json').read_text())
        except FileNotFoundError:return self.initial()
    def update(self,fn,event=None):
        with self.lock():
            state=self.read();fn(state);state['updatedAt']=time.time()
            if event:state['events']=(state['events']+[{'at':time.time(),'event':event}])[-100:]
            atomic(self.directory/'control.json',state)
            if state['stage']=='complete':atomic(self.directory/'report.json',self.report(state))
            return state
    def status(self):
        state=self.read()
        try:
            with self.lock('runner.lock',False):alive=False
        except BlockingIOError:alive=True
        if (state['stage'] in ('running','pausing') or state['stage']=='checking' and time.time()-state['updatedAt']>60) and not alive:
            state={**state,'stage':'needs-attention','problem':'The runner stopped. Reconcile saved receipts before continuing.','enabled':False}
        state['runnerAlive']=alive
        return state
    def guidance(self,value):
        value=validate_guidance(value)
        if value['maxPairs']>len(self.package['pairs']):raise ValueError('Pair limit exceeds the prepared scene package')
        return self.update(lambda s:s.update(guidance=value),'Guidance saved; applies before the next image')
    def pause(self):
        return self.update(lambda s:s.update(enabled=False,stage='pausing' if s['stage']=='running' else 'paused'),'Pause requested before the next image')
    def arm(self):
        s=self.status()
        if s['enabled']:return s
        if s['stage'] in ('needs-attention','waiting-review'):raise ValueError('Resolve the recorded checkpoint first')
        if len(s['pairs'])>=s['guidance']['maxPairs']:raise ValueError('The configured pair budget is complete')
        return self.update(lambda s:s.update(enabled=True,stage='checking',problem=None,expiresAt=time.time()+1200),'Start requested; bounded to 20 minutes and the configured pair limit')
    def review(self,pair,choice,note='',resume=False):
        if choice not in ('left','right','tie','neither') or not isinstance(note,str) or len(note)>2000:raise ValueError('Choose a review outcome')
        if type(resume) is not bool:raise ValueError('Invalid continuation')
        def change(s):
            if pair not in s['pairs'] or pair in s['reviews']:raise ValueError('Review is unavailable or already recorded')
            s['reviews'][pair]={'choice':choice,'note':note,'savedAt':time.time()}
            pending=[p for p in s['pairs'] if p not in s['reviews']]
            if resume and pending:raise ValueError('Review the remaining checkpoint pairs first')
            finished=not pending and len(s['pairs'])>=s['guidance']['maxPairs']
            s.update(enabled=resume and not finished,stage='complete' if finished else 'checking' if resume else 'paused',problem=None)
            if resume and not finished:s['expiresAt']=time.time()+1200
        return self.update(change,'Blind review saved'+(' and continuation requested' if resume else '; paused'))
    def store(self):
        sys.path.insert(0,str(study.REPO/'deployment/controller/tools/artwork'))
        from store import Store
        return Store(self.directory/'factory')
    def check_receipt(self,receipt,request,job,source,work):
        if not isinstance(receipt,dict):raise ValueError('Missing generation receipt')
        actual=receipt.get('generation',{})
        if actual.get('id')!=job or actual.get('profile')!='flux1-dev' or actual.get('prompt')!=request['prompt']:raise ValueError('Receipt identity or prompt mismatch')
        if source.is_symlink() or not work.resolve().is_relative_to((self.directory/'factory/work').resolve()) or not source.resolve().is_relative_to(work.resolve()) or source.stat().st_size>25_000_000:raise ValueError('Original is outside the assigned work directory')
        with source.open('rb') as f:signature=f.read(24)
        if signature[:8]!=b'\x89PNG\r\n\x1a\n' or [int.from_bytes(signature[i:i+4],'big') for i in (16,20)]!=[request['width'],request['height']]:raise ValueError('Original dimensions differ')
        with source.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
        if digest!=actual.get('sha256'):raise ValueError('Original hash differs')
        settings=request['settings'];parameters=actual.get('parameters',{})
        checks={'width':request['width'],'height':request['height'],'num_inference_steps':settings['steps'],'guidance_scale':settings['guidance_scale'],'max_sequence_length':settings['max_sequence_length']}
        if any(parameters.get(k)!=v for k,v in checks.items()) or actual.get('seed')!=settings['seed']:raise ValueError('Generation controls differ')
        precision=actual.get('precision',{})
        if precision.get('transformer_dtype') not in ('torch.bfloat16','bfloat16') or precision.get('text_encoder_4bit') is not False:raise ValueError('Actual precision does not match BF16 controls')
        if actual.get('profiling',{}).get('enabled'):raise ValueError('Profiling changes the timing condition')
        seconds=actual.get('generation_seconds')
        if type(seconds) not in (float,int) or not math.isfinite(seconds) or seconds<0:raise ValueError('Generation time is missing')
        manifest=actual.get('model_manifest',{}).get('models',{}).get('flux1',{})
        expected=json.loads((study.REPO/'deployment/worker/models/pins.json').read_text())['models']['flux1']['revision']
        if manifest.get('revision')!=expected:raise ValueError('Checkpoint revision differs')
        identity={'revision':manifest['revision'],'precision':precision,'packages':actual.get('packages',{}),'engine':actual.get('engine'),'source':actual.get('native_source')}
        if not identity['packages']:raise ValueError('Runtime versions are missing')
        return {'job':job,'sha256':digest,'source':str(source.resolve()),'seconds':seconds,'timings':actual.get('timings',{}),'identity':identity}
    def existing_result(self,store,job,request):
        with store.db() as db:row=db.execute('SELECT * FROM jobs WHERE id=?',(job,)).fetchone()
        if not row:return None
        if row['state'] in ('active','submitted','uncertain','failed','cancelled'):raise ValueError('An existing request needs reconciliation; no replay was attempted')
        if row['state']!='generated':return None
        receipt_path=store.root/'work'/row['attempt']/'generation.json'
        receipt=json.loads(receipt_path.read_text());source=Path(receipt['source'])
        return self.check_receipt(receipt,request,job,source,receipt_path.parent)
    def generate(self,store,job,request,adapter):
        existing=self.existing_result(store,job,request)
        if existing:return existing
        row=store.claim('command','prompt-study-'+str(os.getpid()),model='flux1-dev')
        if not row or row['id']!=job:raise ValueError('Unexpected factory claim; no image requested')
        token=row['token'];work=store.root/'work'/row['attempt'];work.mkdir(parents=True,exist_ok=True)
        done=threading.Event()
        def beat():
            while not done.wait(20):
                try:store.beat(job,token)
                except ValueError:return
        thread=threading.Thread(target=beat,daemon=True);thread.start()
        try:
            receipt=adapter({'job':job,'attempt':row['attempt'],'spec':json.loads(row['spec']),'outputDirectory':str(work)})
            atomic(work/'generation.json',receipt)
            source=Path(receipt['source']);result=self.check_receipt(receipt,request,job,source,work)
            store.complete(job,token,source)
            return result
        except Exception:
            store.fail(job,token,'Study request needs receipt reconciliation; no automatic replay',uncertain=True)
            raise
        finally:done.set();thread.join(timeout=1)
    def run(self,preflight,adapter):
        try:
            with self.lock('runner.lock',False):return self._run(preflight,adapter)
        except BlockingIOError:return self.status()
    def _run(self,preflight,adapter):
        try:
            state=self.read()
            if not state['enabled']:return self.status()
            while True:
                state=self.read()
                if not state['enabled']:return self.update(lambda s:s.update(stage='paused'),'Paused while waiting for the worker')
                if time.time()>=state['expiresAt']:raise ValueError('The bounded run window expired')
                proof=preflight(self.package)
                if proof.get('ready') is True:break
                if not proof.get('retryable'):raise ValueError(proof.get('problem','Worker preflight is not ready'))
                self.update(lambda s:s.update(stage='waiting-worker',problem=proof.get('problem')),'Waiting for the current worker to become available')
                time.sleep(2)
            previous=self.read().get('preflight')
            native_identity=lambda value:{k:v for k,v in (value or {}).items() if k!='profileHash'}
            if previous and (any(previous.get(k)!=proof.get(k) for k in ('revision','codeHashes')) or native_identity(previous.get('native'))!=native_identity(proof.get('native'))):raise ValueError('Worker model, device or source changed since the prior batch')
            self.update(lambda s:s.update(preflight=proof,stage='running'),'Read-only preflight passed')
            store=self.store()
            for i,pair in enumerate(self.package['pairs']):
                state=self.read()
                if pair['id'] in state['pairs']:continue
                if not state['enabled']:break
                if i>=state['guidance']['maxPairs']:break
                if time.time()>=state['expiresAt']:raise ValueError('The bounded run window expired')
                if i and i%state['guidance']['reviewEvery']==0 and any(p not in state['reviews'] for p in state['pairs']):
                    return self.update(lambda s:s.update(stage='waiting-review',enabled=False),'Ready for a light review checkpoint')
                results={}
                for arm,request in zip(pair['submissionOrder'],self.package['requests'][i*2:i*2+2]):
                    state=self.read()
                    if not state['enabled']:return self.update(lambda s:s.update(stage='paused'),'Paused before the next image')
                    if time.time()>=state['expiresAt']:raise ValueError('The bounded run window expired')
                    job=store.enqueue(request)['id']
                    result=self.generate(store,job,request,adapter)
                    pinned=state.get('runtimeIdentity')
                    if pinned and pinned!=result['identity']:raise ValueError('Runtime identity drifted within the study')
                    if not pinned:self.update(lambda s:s.update(runtimeIdentity=result['identity']),'Actual receipt runtime identity pinned')
                    results[arm]=result
                    self.update(lambda s:s.setdefault('verifiedJobs',{}).update({job:True}),'Verified one original and its receipt')
                if results['A']['identity']!=results['B']['identity']:raise ValueError('Pair runtime identities differ')
                self.update(lambda s:s['pairs'].update({pair['id']:{'seed':pair['seed'],'arms':results,'completedAt':time.time()}}),'Pair imported into the study')
            state=self.read();complete=len(state['pairs'])>=state['guidance']['maxPairs']
            return self.update(lambda s:s.update(stage='waiting-review' if any(p not in s['reviews'] for p in s['pairs']) else 'complete' if complete else 'paused',enabled=False),'Batch finished within its configured budget')
        except Exception as error:
            # Deliberately omit arbitrary adapter/remote exception text, which can contain private data.
            problem=str(error) if type(error) is ValueError else 'Worker connection or processing failed; reconcile the recorded request ID.'
            return self.update(lambda s:s.update(stage='needs-attention',enabled=False,problem=problem),'Stopped for attention without replay')
    def reconcile(self):
        with self.lock('runner.lock',False):
            if not (self.directory/'factory/queue.sqlite3').exists():return self.update(lambda s:s.update(enabled=False,stage='paused',problem=None),'No requests were submitted; safe to start after fixing preflight')
            store=self.store()
            with store.db() as db:rows=[dict(row) for row in db.execute('SELECT * FROM jobs')]
            results={};verified={};identity=self.read().get('runtimeIdentity')
            for i,pair in enumerate(self.package['pairs']):
                arms={}
                for arm,request in zip(pair['submissionOrder'],self.package['requests'][i*2:i*2+2]):
                    matches=[row for row in rows if json.loads(row['spec']).get('variant')==request['variant'] and json.loads(row['spec']).get('scene')==request['scene']]
                    if not matches:continue
                    if len(matches)!=1:raise ValueError('Conflicting recorded requests need attention')
                    row=matches[0]
                    if row['state']=='queued':continue
                    receipt_file=store.root/'work'/str(row['attempt'])/'generation.json'
                    if row['state'] not in ('generated','active','uncertain') or not receipt_file.is_file():raise ValueError('A request has no durable completion receipt; do not regenerate it')
                    receipt=json.loads(receipt_file.read_text());result=self.check_receipt(receipt,request,row['id'],Path(receipt['source']),receipt_file.parent)
                    if identity and result['identity']!=identity:raise ValueError('Runtime mismatch retained for investigation')
                    identity=result['identity']
                    if row['state']!='generated':store.complete(row['id'],row['token'],Path(receipt['source']))
                    arms[arm]=result;verified[row['id']]=True
                if len(arms)==2:results[pair['id']]={'seed':pair['seed'],'arms':arms,'completedAt':time.time()}
            def change(s):
                s['pairs'].update(results);s.setdefault('verifiedJobs',{}).update(verified)
                if identity:s['runtimeIdentity']=identity
                pending=any(p not in s['reviews'] for p in s['pairs'])
                s.update(enabled=False,stage='waiting-review' if pending else 'complete' if len(s['pairs'])>=s['guidance']['maxPairs'] else 'paused',problem=None)
            return self.update(change,'Reconciled durable receipts locally; no image requested')
    def report(self,state):
        preferences={'A':0,'B':0,'tie':0,'neither':0};timings={'A':[],'B':[]};pairs=[]
        for pair in self.package['pairs']:
            complete=state['pairs'].get(pair['id']);review=state['reviews'].get(pair['id'])
            if not complete or not review:continue
            choice=review['choice'];outcome=pair['reviewSlots'][choice] if choice in ('left','right') else choice;preferences[outcome]+=1
            for arm in ('A','B'):timings[arm].append(complete['arms'][arm]['seconds'])
            a,b=(complete['arms'][arm]['seconds'] for arm in ('A','B'))
            pairs.append({'id':pair['id'],'seed':pair['seed'],'preference':outcome,'note':review['note'],'workerSeconds':{'A':a,'B':b},'bTimeDeltaPercent':100*(b-a)/a if a else None})
        return {'schema':1,'package':self.identity,'study':self.package['study'],'reviewedPairs':len(pairs),'preferences':preferences,'medianWorkerSeconds':{arm:statistics.median(values) if values else None for arm,values in timings.items()},'pairs':pairs,'interpretation':'Exploratory paired pilot. Preferences come from saved human choices; this is not a general model-quality ranking.'}
    def public(self):
        state=self.status();pairs=[]
        for pair in self.package['pairs']:
            complete=state['pairs'].get(pair['id'])
            if not complete:continue
            images={}
            for slot,arm in pair['reviewSlots'].items():
                result=complete['arms'][arm];images[slot]={'sha256':result['sha256'],'url':f'/api/prompt-study/image/{self.identity}/{pair["id"]}/{slot}/{result["sha256"]}.png','seconds':result['seconds']}
            review=state['reviews'].get(pair['id'])
            pairs.append({'id':pair['id'],'seed':pair['seed'],'images':images,'review':review,'revealedArms':pair['reviewSlots'] if review else None})
        return {'package':self.identity,'study':self.package['study'],'plannedPairs':len(self.package['pairs']),'stage':state['stage'],'enabled':state['enabled'],'runnerAlive':state['runnerAlive'],'guidance':state['guidance'],'pairs':pairs,'problem':state.get('problem'),'events':state['events'][-8:],'preflight':state.get('preflight'),'completedPairs':len(pairs),'remainingPairs':max(0,state['guidance']['maxPairs']-len(pairs)),'verifiedImages':len(state.get('verifiedJobs',{})),'report':self.report(state) if state['stage']=='complete' else None}

def remote_preflight(package):
    if not shutil.which('cwebp') or not shutil.which('dwebp'):return {'ready':False,'problem':'Local image processing tools are unavailable.'}
    host=os.environ.get('ARTWORK_SSH_HOST','');port=os.environ.get('ARTWORK_SSH_PORT','')
    if not re.fullmatch(r'(?:[A-Za-z0-9_.-]+@)?[A-Za-z0-9.-]+',host) or not port.isdigit():return {'ready':False,'problem':'The private worker endpoint is not configured.'}
    program=Path(__file__).with_name('study_preflight_remote.py').read_text()
    import shlex
    worker_port=int(os.environ.get('ARTWORK_FLUX1_PORT','18761'))
    if worker_port not in (18761,18763):return {'ready':False,'problem':'Unsupported FLUX1 worker port.'}
    result=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=8','-p',port,host,'/workspace/artwork/.venv/bin/python','-c',shlex.quote(program)],input=json.dumps({'prompts':package['prompts'],'limit':package['settings']['max_sequence_length'],'workerPort':worker_port}),capture_output=True,text=True,timeout=45)
    if result.returncode:return {'ready':False,'problem':'The read-only worker check could not complete. No image was requested.'}
    proof=json.loads(result.stdout)
    expected=json.loads((study.REPO/'deployment/worker/models/pins.json').read_text())['models']['flux1']['revision']
    if proof.get('revision')!=expected:return {'ready':False,'problem':'Worker checkpoint revision does not match the frozen model pin.'}
    return proof

def native_adapter(packet):
    file=study.REPO/'deployment/controller/tools/artwork/remote/adapter.py'
    spec=importlib.util.spec_from_file_location('study_native_adapter',file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module.run(packet)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',type=Path,default=study.DEFAULT_ROOT);parser.add_argument('action',choices=['status','guidance','pause','start','review','reconcile','advance']);parser.add_argument('package');args=parser.parse_args();c=Controller(args.package,args.root)
    payload=json.loads(sys.stdin.read() or '{}') if args.action in ('guidance','review') else {}
    if args.action=='guidance':c.guidance(payload)
    elif args.action=='pause':c.pause()
    elif args.action=='start':c.arm()
    elif args.action=='review':c.review(payload['pair'],payload['choice'],payload.get('note',''),payload.get('continue',False))
    elif args.action=='reconcile':c.reconcile()
    elif args.action=='advance':c.run(remote_preflight,native_adapter)
    print(json.dumps(c.public()))
if __name__=='__main__':
    try:main()
    except (ValueError,KeyError,OSError,json.JSONDecodeError):print('Study control stopped; existing records retained.',file=sys.stderr);sys.exit(1)
