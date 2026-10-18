"""Read-only worker check; executed through SSH only after explicit study start."""
import hashlib,json,socket,sys,time
from pathlib import Path
from urllib.request import urlopen
from transformers import AutoTokenizer
p=json.load(sys.stdin)
try:
 port=p.get('workerPort',18761)
 if port not in (18761,18763):raise ValueError('Unsupported FLUX1 worker')
 native_socket='/workspace/artwork-flux1-gpu1/native/flux1.sock' if port==18763 else '/workspace/artwork/native/flux1.sock'
 with urlopen('http://127.0.0.1:%d/health'%port,timeout=8) as response:health=json.load(response)
 root=Path('/workspace/artwork');manifest=json.loads((root/'models/manifest.json').read_text());revision=manifest['models']['flux1']['revision']
 with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as client:
  client.settimeout(8);client.connect(native_socket);client.sendall(b'{"op":"ping"}\n');native=json.loads(client.makefile('rb').readline(1000000))
 native_info={'gpu':native.get('gpu'),'backend':native.get('backend'),'kind':native.get('kind'),'profileHash':hashlib.sha256(json.dumps(native.get('profile'),sort_keys=True).encode()).hexdigest()}
 code_hashes={name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in ['native/source/worker.py','native_launch.py','native.py','worker.py']}
 counts={}
 for name,limit in [('tokenizer',77),('tokenizer_2',p['limit'])]:
  tokenizer=AutoTokenizer.from_pretrained(root/'models/flux1'/name,local_files_only=True)
  counts[name]={arm:len(tokenizer(prompt,truncation=False)['input_ids']) for arm,prompt in p['prompts'].items()}
  counts[name]['limit']=limit
 ready=native.get('loaded') is True and native.get('backend')=='cuda' and health.get('phase')=='ready' and not health.get('paused') and not health.get('running') and not health.get('queued') and all(counts['tokenizer_2'][arm]<=p['limit'] for arm in p['prompts'])
 print(json.dumps({'ready':ready,'retryable':all(counts['tokenizer_2'][arm]<=p['limit'] for arm in p['prompts']),'revision':revision,'native':native_info,'codeHashes':code_hashes,'observedAt':time.time(),'tokens':counts,'clipPolicy':'Record native CLIP truncation at 77 equally for both arms; do not rewrite captions.','problem':None if ready else 'Worker is busy, paused, unavailable, or the T5 caption exceeds the conditioning limit.','actualPrecisionPolicy':'Verified from every completed generation receipt, not inferred from this check.'}))
except Exception:
 print(json.dumps({'ready':False,'problem':'Read-only worker/tokenizer evidence is unavailable. No image requested.'}))
