#!/usr/bin/env python3
"""Pull bounded live source/configuration, never model data or credentials."""
import hashlib,json,pathlib,re,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[2]
PROGRAM=r'''
import pathlib,json,re,subprocess
roots=[pathlib.Path('/workspace/artwork'),pathlib.Path('/workspace/artwork-flux1-gpu1')]
files=set()
for root in roots:
 for pattern in ['*.py','*.sh','native/*.py','native/source/*.py','judges/*.py','judges/*.sh','r2/*.py','control/*.py','requirements*.txt','*lock*.txt','judges/requirements*.txt','judges/*lock*.txt','r2/requirements*.txt','r2/*lock*.txt','models/pins.json','models/manifest.json','native/source.json','native/profile.json','profile.json']:
  files.update(root.glob(pattern))
files.update(pathlib.Path('/etc/supervisor/conf.d').glob('artwork*.conf'))
files.update(pathlib.Path('/opt/supervisor-scripts').glob('artwork*.sh'))
secrets=[]
for p in [pathlib.Path('/workspace/artwork/r2/credentials.json')]:
 if p.exists():
  for key,value in json.loads(p.read_text()).items():
   if isinstance(value,str) and len(value)>12 and any(s in key.upper() for s in ['SECRET','TOKEN','PASSWORD','ACCESS_KEY']):secrets.append(value)
entries=[]
for p in sorted(files):
 if not p.is_file() or p.is_symlink() or p.stat().st_size>1000000:continue
 text=p.read_text()
 for value in secrets:text=text.replace(value,'REDACTED_PRIVATE_VALUE')
 text=re.sub(r'hf_[A-Za-z0-9]{20,}','REDACTED_HF_TOKEN',text)
 # Preserve variable references; redact literal sensitive assignments.
 lines=[]
 for line in text.splitlines():
  if re.match(r'^\s*(?:export\s+)?(?:[A-Z0-9_]*(?:TOKEN|PASSWORD|SECRET|ACCESS_KEY)[A-Z0-9_]*)\s*=',line):
   name,value=line.split('=',1)
   if '$' not in value and not value.strip().startswith(('os.environ','environ')):line=name+'=REDACTED_PRIVATE_VALUE'
  lines.append(line)
 text='\n'.join(lines)+'\n'
 if 'PRIVATE KEY-----' in text:raise ValueError('Private key material unexpectedly found')
 entries.append({'path':str(p),'text':text,'mode':p.stat().st_mode&511})
links={str(p):str(p.readlink()) for root in roots for p in root.rglob('*') if p.is_symlink() and not any(x in p.parts for x in ['.venv','.hf_home','node_modules'])}
print(json.dumps({'symlinks':links,'files':entries,'supervisorStatus':subprocess.run(['supervisorctl','status'],text=True,capture_output=True).stdout}))
'''
result=subprocess.run(['ssh','-T','-o','BatchMode=yes','-o','ConnectTimeout=5','-p','11012','root@184.186.104.194','python3','-'],input=PROGRAM,text=True,capture_output=True,check=True,timeout=60)
data=json.loads(result.stdout);target=ROOT/'deployment/server-current';target.mkdir(parents=True,exist_ok=True);manifest={}
for item in data['files']:
 relative=pathlib.PurePosixPath(item['path']).relative_to('/');p=target/relative;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(item['text']);p.chmod(item['mode']);manifest[str(relative)]=hashlib.sha256(p.read_bytes()).hexdigest()
(target/'SOURCE-HASHES.json').write_text(json.dumps(manifest,indent=2)+'\n')
(target/'SERVICE-STATUS.txt').write_text(data['supervisorStatus'])
(target/'SYMLINKS.json').write_text(json.dumps(data.get('symlinks',{}),indent=2)+'\n')
print(json.dumps({'preservedSourceFiles':len(manifest),'destination':str(target),'credentialsExcluded':True}))
