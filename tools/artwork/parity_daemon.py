#!/usr/bin/env python3
"""Continuously alternate production/precision on one worker; reviews never gate work."""
import argparse
from contextlib import contextmanager, closing
import fcntl
import json
import os
from pathlib import Path
import plistlib
import re
import sqlite3
import subprocess
import sys
import threading
import time

import prompt_clarity as study
import study_settings
from study_controller import Controller, atomic, remote_preflight, native_adapter

DEFAULT_ROOT=study.REPO/'.runtime/research/production-parity-daemon'
LABEL='vision.influx.imagen.parity'
TEMPLATE=study.REPO/'deployment/launchd/vision.influx.imagen.parity.plist.in'

def lane_config(config):
    count=config.get('laneCount',1);index=config.get('laneIndex',0)
    if type(count) is not int or count not in (1,2) or type(index) is not int or not 0<=index<count:
        raise ValueError('Use one or two lanes with a valid lane index')
    port=str(config.get('workerPort',18761))
    if port not in ('18761','18763'):raise ValueError('Use a configured FLUX1 worker port')
    interval=config.get('initialRange')
    if interval is not None and (not isinstance(interval,list) or len(interval)!=2 or any(type(n) is not int for n in interval) or not 0<=interval[0]<interval[1]<=150):
        raise ValueError('Initial range must be zero-based start inclusive, stop exclusive')
    socket='/workspace/artwork/native/flux1.sock' if port=='18761' else '/workspace/artwork-flux1-gpu1/native/flux1.sock'
    return {'laneCount':count,'laneIndex':index,'workerPort':int(port),'nativeSocket':socket,**({'initialRange':interval} if interval is not None else {})}

def lane_indices(config,pass_number,total=150):
    lane=lane_config(config)
    if pass_number==1 and lane.get('initialRange') is not None:return list(range(*lane['initialRange']))
    return list(range(lane['laneIndex'],total,lane['laneCount']))

class ParityDaemon:
    def __init__(self,root=DEFAULT_ROOT,study_root=study.DEFAULT_ROOT,controller=Controller,prepare=study.prepare_corpus,preflight=remote_preflight,adapter=native_adapter):
        self.root=Path(root).resolve();self.root.mkdir(parents=True,exist_ok=True)
        self.study_root=Path(study_root).resolve();self.controller=controller;self.prepare=prepare;self.preflight=preflight;self.adapter=adapter
    @contextmanager
    def lock(self,name='state.lock',blocking=True):
        with (self.root/name).open('a') as f:
            os.fchmod(f.fileno(),0o600);fcntl.flock(f,fcntl.LOCK_EX|(0 if blocking else fcntl.LOCK_NB))
            try:yield
            finally:fcntl.flock(f,fcntl.LOCK_UN)
    def read(self):
        try:return json.loads((self.root/'state.json').read_text())
        except FileNotFoundError:return {'schema':1,'study':'ADHC-001','enabled':False,'stage':'paused','currentPackage':None,'sceneId':None,'sceneIndex':0,'pass':1,'seed':42,'completedPairs':0,'problem':None,'heartbeatAt':None}
    def update(self,**values):
        with self.lock():
            state=self.read();state.update(values);state['updatedAt']=time.time();atomic(self.root/'state.json',state);return state
    def status(self):
        state=self.read()
        try:
            with self.lock('runner.lock',False):alive=False
        except BlockingIOError:alive=True
        return {**state,'runnerAlive':alive}
    def config(self):return json.loads((self.root/'config.json').read_text())
    def label(self):
        lane=lane_config(self.config());return LABEL if lane['laneIndex']==0 else LABEL+'.gpu1'
    @contextmanager
    def reservation(self,scene_index,seed):
        directory=self.study_root/'parity-reservations';directory.mkdir(parents=True,exist_ok=True)
        key=f'{seed}-scene-{scene_index+1:03d}'
        with (directory/(key+'.lock')).open('a') as lock:
            os.fchmod(lock.fileno(),0o600);fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            try:
                atomic(directory/(key+'.json'),{'sceneIndex':scene_index,'seed':seed,'daemonRoot':str(self.root),'workerPort':lane_config(self.config())['workerPort'],'reservedAt':time.time()})
                yield
            finally:fcntl.flock(lock,fcntl.LOCK_UN)
    def enable(self):
        s=self.read()
        if s['stage']=='needs-attention':raise ValueError('Resolve the recorded worker request before resuming')
        return self.update(enabled=True,stage='checking',problem=None)
    def pause(self):
        s=self.update(enabled=False,stage='paused')
        if s['currentPackage']:
            c=self.controller(s['currentPackage'],self.study_root)
            if c.status().get('enabled'):c.pause()
        return self.status()
    def attention(self,problem):return self.update(enabled=False,stage='needs-attention',problem=problem)
    def retry_unsubmitted_preflight(self,c,control):
        """Retry transport checks only when no generation was ever submitted."""
        retryable=control.get('problem') in (
            'The read-only worker check could not complete. No image was requested.',
            'Worker connection or processing failed; reconcile the recorded request ID.',
            'The bounded run window expired')
        if not retryable:return False
        database=c.directory/'factory/queue.sqlite3'
        if database.exists():
            with closing(sqlite3.connect(database.as_uri()+'?mode=ro',uri=True)) as db:
                if db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0]:return False
        c.reconcile()
        self.update(stage='waiting-worker',problem='Waiting for the worker connection; no image was submitted')
        return True
    def tick(self):
        state=self.read()
        if not state['enabled']:return state
        indices=lane_indices(self.config(),state['pass'])
        if state['sceneIndex'] not in indices:
            if state.get('currentPackage'):return self.attention('The active pair is outside this lane assignment; retain its original lane')
            eligible=[index for index in indices if index>=state['sceneIndex']]
            if not eligible:return self.attention('Lane cursor is outside its assigned scene range')
            state=self.update(sceneIndex=eligible[0])
        try:
            with self.reservation(state['sceneIndex'],state['seed']):return self._tick_reserved()
        except BlockingIOError:return self.update(stage='waiting-worker',problem='This scene and seed are reserved by another lane')
    def _tick_reserved(self):
        state=self.read()
        if not state['enabled']:return state
        corpus=json.loads(study.CORPUS.read_text());scenes=corpus['scenes']
        if len(scenes)!=150:raise ValueError('The production corpus must retain all 150 scenes')
        index=state['sceneIndex'];scene=scenes[index]
        self.update(sceneId=scene['id'])
        if not scene.get('precisionPrompt'):
            return self.update(stage='waiting-draft',problem=None)
        settings=study_settings.read(self.study_root,self.config()['settings'])['settings']
        if state.get('currentPackage') and (self.study_root/'runs'/state['currentPackage']/'package.json').is_file():
            settings=study.load_package(state['currentPackage'],self.study_root)['settings']
        # Prompt revisions may arrive while A/B is in flight. Finish the exact
        # saved package before considering any new wording for the next pair.
        package=study.load_package(state['currentPackage'],self.study_root) if state.get('currentPackage') and (self.study_root/'runs'/state['currentPackage']/'package.json').is_file() else self.prepare(self.study_root,settings,scene['id'],state['seed'])
        if state['currentPackage'] and state['currentPackage']!=package['id']:
            return self.attention('Current frozen scene changed; existing work retained without replay')
        self.update(currentPackage=package['id'],stage='running',problem=None,activeSettings=settings,activePromptRevision=package.get('promptRevision','historical-production'))
        c=self.controller(package['id'],self.study_root);control=c.status()
        # A complete pair is a durable scheduling checkpoint, regardless of its review state.
        if len(control.get('pairs',{}))<len(package['pairs']):
            if control['stage']=='needs-attention':
                if self.retry_unsubmitted_preflight(c,control):return self.read()
                return self.attention(control.get('problem') or 'Worker request needs attention')
            if control.get('runnerAlive'):return self.update(stage='waiting-worker')
            if not self.read()['enabled']:return self.read()
            if not control.get('enabled'):c.arm()
            if not self.read()['enabled']:
                c.pause();return self.read()
            c.run(self.preflight,self.adapter)
            control=c.status()
        if control['stage']=='needs-attention':
            if self.retry_unsubmitted_preflight(c,control):return self.read()
            return self.attention(control.get('problem') or 'Worker request needs attention')
        if len(control.get('pairs',{}))==len(package['pairs']):
            next_pass=state['pass'];seed=state['seed'];config=self.config()
            remaining=[candidate for candidate in lane_indices(config,next_pass,len(scenes)) if candidate>index]
            if remaining:next_index=remaining[0]
            else:
                next_pass+=1;seed+=1;next_index=lane_indices(config,next_pass,len(scenes))[0]
            if seed>=2**32:return self.attention('Paired seed range exhausted')
            with self.lock():
                latest=self.read();latest.update(currentPackage=None,sceneId=None,sceneIndex=next_index,**{'pass':next_pass},seed=seed,completedPairs=latest['completedPairs']+1,stage='checking' if latest['enabled'] else 'paused',problem=None,updatedAt=time.time())
                atomic(self.root/'state.json',latest)
            return self.read()
        if not self.read()['enabled']:return self.read()
        return self.update(stage='waiting-worker')
    def heartbeat(self,stop):
        while not stop.wait(2):
            try:
                self.update(heartbeatAt=time.time())
                s=self.read()
                if not s['enabled'] and s['currentPackage']:
                    c=self.controller(s['currentPackage'],self.study_root)
                    if c.status().get('enabled'):c.pause()
            except Exception:
                # Main loop records actionable failures; heartbeat must not kill a live image.
                pass
    def run(self,stop=None):
        stop=stop or threading.Event()
        try:
            with self.lock('runner.lock',False):
                cfg=self.config()
                for env,key in (('ARTWORK_SSH_HOST','sshHost'),('ARTWORK_SSH_PORT','sshPort')):
                    if cfg.get(key):os.environ[env]=str(cfg[key])
                lane=lane_config(cfg);os.environ['ARTWORK_FLUX1_PORT']=str(lane['workerPort']);os.environ['ARTWORK_FLUX1_SOCKET']=lane['nativeSocket']
                self.update(heartbeatAt=time.time())
                heartbeat=threading.Thread(target=self.heartbeat,args=(stop,),daemon=True);heartbeat.start()
                try:
                    while not stop.is_set():
                        try:self.tick()
                        except Exception as error:
                            self.attention(str(error) if type(error) is ValueError else 'Daemon operation failed; saved work retained without replay')
                        stop.wait(2)
                finally:stop.set();heartbeat.join(timeout=3)
        except BlockingIOError:return self.status()
        return self.status()
    def install(self,payload):
        settings=payload['settings'];study.compile_corpus_package(settings)
        host=payload.get('sshHost',os.environ.get('ARTWORK_SSH_HOST',''));port=str(payload.get('sshPort',os.environ.get('ARTWORK_SSH_PORT','')))
        if not re.fullmatch(r'(?:[A-Za-z0-9_.-]+@)?[A-Za-z0-9.-]+',host) or not port.isdigit() or not 1<=int(port)<=65535:
            raise ValueError('Configure the worker SSH endpoint')
        previous=self.config() if (self.root/'config.json').exists() else {}
        config={'settings':settings,'sshHost':host,'sshPort':port,'studyRoot':str(self.study_root),**lane_config({**previous,**payload})}
        if (self.root/'config.json').exists() and self.read().get('currentPackage'):
            old=self.config()
            if any(old.get(key)!=config.get(key) for key in ('settings','sshHost','sshPort')) or lane_config(old)['workerPort']!=config['workerPort']:
                raise ValueError('Do not change runtime settings during a frozen pair')
        atomic(self.root/'config.json',config)
        import html
        replacements={'PYTHON':sys.executable,'REPO':str(study.REPO),'DAEMON_ROOT':str(self.root),'STUDY_ROOT':str(self.study_root),'SSH_HOST':host,'SSH_PORT':port,'PATH':os.environ.get('PATH','/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin')}
        text=TEMPLATE.read_text()
        for key,value in replacements.items():text=text.replace('{{'+key+'}}',html.escape(value,quote=True))
        label=self.label();text=text.replace('<string>'+LABEL+'</string>','<string>'+label+'</string>')
        plistlib.loads(text.encode())
        destination=Path.home()/'Library/LaunchAgents'/f'{label}.plist';destination.parent.mkdir(parents=True,exist_ok=True)
        destination.write_text(text);destination.chmod(0o600)
        self.update(stage=self.read()['stage'])
        return {'installed':True,'enabled':self.read()['enabled'],'plist':str(destination)}
    def start(self):
        label=self.label();destination=Path.home()/'Library/LaunchAgents'/f'{label}.plist'
        if not destination.is_file():raise ValueError('Install the daemon before starting')
        self.config();self.enable();domain=f'gui/{os.getuid()}'
        loaded=subprocess.run(['launchctl','print',domain+'/'+label],capture_output=True).returncode==0
        command=['launchctl','kickstart',domain+'/'+label] if loaded else ['launchctl','bootstrap',domain,str(destination)]
        result=subprocess.run(command,capture_output=True)
        if result.returncode:
            self.attention('launchd could not start the study daemon');raise ValueError('launchd could not start the study daemon')
        return self.status()

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,default=DEFAULT_ROOT);p.add_argument('--study-root',type=Path,default=study.DEFAULT_ROOT)
    p.add_argument('action',choices=['status','install','start','pause','resume','run']);args=p.parse_args();d=ParityDaemon(args.root,args.study_root)
    if args.action=='status':value=d.status()
    elif args.action=='install':value=d.install(json.load(sys.stdin))
    elif args.action in ('start','resume'):value=d.start()
    elif args.action=='pause':value=d.pause()
    else:value=d.run()
    print(json.dumps(value))
if __name__=='__main__':
    try:main()
    except (ValueError,KeyError,OSError,json.JSONDecodeError):
        print('Parity daemon stopped; inspect status. Existing images and jobs remain in place.',file=sys.stderr);sys.exit(1)
