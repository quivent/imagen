import hashlib,json,time,subprocess
from pathlib import Path
from urllib.request import Request,urlopen
root=Path('/workspace/artwork')
lanes=[('flux1-dev',18761),('flux2-dev-nf4',18762)]
def call(port,route,value=None):
 req=Request('http://127.0.0.1:'+str(port)+route,data=json.dumps(value).encode() if value is not None else None,headers={'Content-Type':'application/json'})
 with urlopen(req,timeout=15) as r:return json.load(r)
while not (root/'models/manifest.json').exists():time.sleep(10)
start=time.monotonic()
while True:
 ready=[]
 for profile,port in lanes:
  try:
   health=call(port,'/health')
   if health['phase']=='failed':raise RuntimeError(str(health))
   ready.append(health['phase']=='ready')
  except (ConnectionError,OSError):ready.append(False)
 if all(ready):break
 assert time.monotonic()-start<1800,'Worker readiness timeout'
 time.sleep(5)
proof={}
for profile,port in lanes:
 ident='migration-56453903-'+profile+'-20261017'
 spec={'model':profile,'prompt':'A quiet stone bridge crossing a river beside autumn trees, warm late afternoon light, painterly landscape, no lettering.','width':512,'height':512,'settings':{'seed':42,'steps':28,'guidance_scale':3.5,'max_sequence_length':512},'references':[]}
 print(json.dumps({'submitting':ident}),flush=True)
 call(port,'/jobs',{'id':ident,'spec':spec})
start=time.monotonic()
samples=[]
while len(proof)<2:
 for profile,port in lanes:
  ident='migration-56453903-'+profile+'-20261017'
  result=call(port,'/jobs');jobs=result if isinstance(result,list) else result['jobs']
  job=next(j for j in jobs if j['id']==ident)
  assert job['status'] not in ('failed','uncertain','error'),str(job)
  if job['status']!='done' or profile in proof:continue
  directory=root/'jobs'/profile/ident
  receipt=json.loads((directory/'receipt.json').read_text())
  assert hashlib.sha256((directory/'result.png').read_bytes()).hexdigest()==receipt['sha256']
  assert receipt['parameters']['num_inference_steps']==28
  assert receipt['precision']['transformer_dtype']=='torch.bfloat16'
  if profile=='flux2-dev-nf4':assert receipt['precision']['text_encoder_4bit']
  proof[profile]={'id':ident,'sha256':receipt['sha256'],'generation_seconds':receipt['generation_seconds'],'precision':receipt['precision'],'timings':receipt.get('timings',{}),'parameters':receipt['parameters']}
  print(json.dumps(proof[profile]),flush=True)
 result=subprocess.run(['nvidia-smi','--query-gpu=index,utilization.gpu,memory.used,power.draw,power.limit,clocks.current.sm,clocks.current.memory,temperature.gpu,clocks_event_reasons.hw_power_brake_slowdown,pcie.link.gen.current,pcie.link.width.current','--format=csv,noheader,nounits'],capture_output=True,text=True)
 
 if len(samples)==3:
  xml=subprocess.run(['nvidia-smi','-q','-x'],capture_output=True,text=True)
  (root/'migration-proof-gpu-under-load.xml').write_text(xml.stdout)
 samples.append({'elapsed_seconds':time.monotonic()-start,'csv':result.stdout,'error':result.stderr})
 assert time.monotonic()-start<900,'Proof render timeout'
 time.sleep(.5)
(root/'migration-proof.json').write_text(json.dumps({'jobs':proof,'gpu_samples':samples},indent=2)+'\n')
result=subprocess.run(['nvidia-smi','-q','-d','PERFORMANCE,POWER,CLOCK'],capture_output=True,text=True)
(root/'migration-proof-gpu.txt').write_text(result.stdout+result.stderr)
print('Both replacement concurrent proofs verified',flush=True)
