import json,time,urllib.request,subprocess,shutil,os
from pathlib import Path
root=Path('/workspace/artwork');saved=root/'backups/fp8-20261017';saved.mkdir(exist_ok=True)
def call(method,path,value=None):
 req=urllib.request.Request('http://127.0.0.1:18762'+path,data=json.dumps(value).encode() if value is not None else None,headers={'Content-Type':'application/json'},method=method)
 with urllib.request.urlopen(req,timeout=10) as r:return json.load(r)
def gpu():
 return subprocess.check_output(['nvidia-smi','--query-gpu=index,memory.used,memory.free','--format=csv,noheader'],text=True).strip()
start=time.time()
while not (root/'models/flux2-fp8/.download-complete.json').exists():
 if time.time()-start>1800:raise RuntimeError('FP8 download not ready; existing NF4 worker left running')
 print(json.dumps({'stage':'waiting-for-verified-download','seconds':round(time.time()-start)}),flush=True);time.sleep(20)
old=call('GET','/health');call('POST','/control',{'paused':True})
print(json.dumps({'stage':'waiting-for-current-image','health':old}),flush=True)
start=time.time()
while call('GET','/health').get('current'):
 if time.time()-start>600:raise RuntimeError('Current image still running; worker was not stopped')
 time.sleep(3)
queued=[r['id'] for r in call('GET','/jobs')['jobs'] if r['status']=='queued']
report={'startedAt':time.time(),'previouslyPaused':old['paused'],'queuedIDs':queued}
(saved/'cutover.json').write_text(json.dumps(report,indent=2))
subprocess.run(['supervisorctl','stop','artwork-flux2'],check=True)
shutil.copy2(root/'worker.fp8-staged.py',root/'worker.py')
shutil.copy2(root/'flux2.fp8-staged.sh','/opt/supervisor-scripts/artwork-flux2.sh');os.chmod('/opt/supervisor-scripts/artwork-flux2.sh',0o755)
subprocess.run(['supervisorctl','start','artwork-flux2'],check=True)
print(json.dumps({'stage':'loading-fp8','queuedIDsPreserved':queued}),flush=True)
start=time.time()
while True:
 try:
  h=call('GET','/health')
  if h['phase']=='failed':raise RuntimeError('FP8 startup failed: '+str(h.get('problem')))
  if h['phase']=='ready':break
 except urllib.error.URLError:pass
 if time.time()-start>600:raise RuntimeError('FP8 startup exceeded ten minutes')
 time.sleep(3)
report['loadedAt']=time.time();report['gpuAfterLoad']=gpu()
call('POST','/control',{'paused':old['paused']})
print(json.dumps({'stage':'fp8-loaded','gpu':report['gpuAfterLoad'],'restoredPause':old['paused']}),flush=True)
(root/'fp8-switch.json').write_text(json.dumps(report,indent=2))
if old['paused']:
 print(json.dumps({'stage':'complete','ordinaryWorkProof':'awaiting owner resume'}),flush=True);raise SystemExit(0)
start=time.time()
while True:
 for ident in queued:
  file=root/'jobs/flux2-dev-nf4'/ident/'receipt.json'
  if file.exists():
   r=json.loads(file.read_text());fp8=r.get('precision',{}).get('text_encoder_fp8')
   if fp8:
    report['ordinaryWork']={key:r.get(key) for key in ['id','width','height','parameters','generation_seconds','peak_allocated_bytes','peak_reserved_bytes','sha256']}
    report['encoder']=fp8;report['gpuAfterGeneration']=gpu();report['finishedAt']=time.time()
    (root/'fp8-switch.json').write_text(json.dumps(report,indent=2));print(json.dumps({'stage':'complete',**report}),flush=True);raise SystemExit(0)
 if time.time()-start>360:raise RuntimeError('FP8 loaded; ordinary completion has not been verified yet')
 time.sleep(3)
