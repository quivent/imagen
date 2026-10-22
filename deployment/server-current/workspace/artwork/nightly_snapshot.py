"""Run on the worker to retain setup and private recovery records on its volume."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tarfile
import time

root = Path('/workspace/artwork')
stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
output = Path('/workspace/nightly')/stamp
output.mkdir(parents=True, mode=0o700)
os.chmod(output, 0o700)
weights = {'.safetensors','.bin','.pt','.pth','.onnx','.gguf','.ckpt'}
skip = {'.venv','.download-venv','.uv-cache','__pycache__','wheelhouse','.preservation','.venv-backups'}
roots = [root,Path('/etc/supervisor'),Path('/etc/supervisord.conf'),Path('/opt/supervisor-scripts'),Path('/opt/instance-tools'),Path('/etc/vast-agents-guide.md')]
roots += [p for p in Path('/root').iterdir() if p.is_file() and p.suffix in {'.py','.sh'}]
entries=[];excluded=[]
archive=output/'setup-and-state.tar.gz'
with tarfile.open(archive,'w:gz',dereference=False) as tar:
 def capture(path):
  if path.name in skip:return
  if path.is_symlink():tar.add(path,arcname=str(path).lstrip('/'),recursive=False);return
  if path.is_dir():
   for child in sorted(path.iterdir()):capture(child)
   return
  if not path.is_file():return
  if path.suffix in weights or path.stat().st_size>30_000_000:
   excluded.append({'path':str(path),'bytes':path.stat().st_size,'reason':'model/binary bytes remain on volume'});return
  if path.suffix.lower() in {'.png','.jpg','.jpeg','.webp','.rgba'}:
   excluded.append({'path':str(path),'reason':'original/captured image bytes remain on volume and archive; separate metadata retained'});return
  tar.add(path,arcname=str(path).lstrip('/'),recursive=False)
  entries.append({'path':str(path),'bytes':path.stat().st_size})
 for path in roots:
  if path.exists():capture(path)
os.chmod(archive,0o600)
for name,command in [('system-packages.txt',['dpkg-query','-W']),('supervisor-status.txt',['supervisorctl','status']),('mounts.txt',['findmnt','-T','/workspace']),('gpu-driver.txt',['nvidia-smi','--query-gpu=index,name,driver_version,memory.total','--format=csv'])]:
 result=subprocess.run(command,capture_output=True,text=True)
 (output/name).write_text(result.stdout);os.chmod(output/name,0o600)
for label,path in [('generation','/workspace/artwork/.venv'),('download','/workspace/artwork/.download-venv'),('judges','/workspace/artwork/judges/.venv')]:
 python=Path(path)/'bin/python'
 if python.exists():
  code='import importlib.metadata,json;print(json.dumps(sorted((d.metadata["Name"],d.version) for d in importlib.metadata.distributions())))'
  result=subprocess.run([str(python),'-c',code],capture_output=True,text=True)
  (output/(label+'-packages.json')).write_text(result.stdout);os.chmod(output/(label+'-packages.json'),0o600)
model_paths=[root/'models/flux1',root/'models/flux2',root/'models/flux2-nf4',root/'models/flux2-fp8',root/'judges/models']
report={'schema':1,'createdAt':stamp,'archive':str(archive),'archiveBytes':archive.stat().st_size,'archiveSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'sourceAndStateFiles':len(entries),'entries':entries,'excluded':excluded,'modelLocations':[{'path':str(p),'resolved':str(p.resolve()),'exists':p.exists()} for p in model_paths],'environmentsPreservedOnVolume':True,'scope':'Private source/config/journal recovery snapshot; weights and installed environments stay on persistent /workspace. No deletion or model transfer.','warning':'Control secrets may exist in private archive: keep mode0600, ignored, never publish or commit.'}
(output/'snapshot.json').write_text(json.dumps(report,indent=2));os.chmod(output/'snapshot.json',0o600)
print(json.dumps({k:report[k] for k in ['createdAt','archive','archiveBytes','archiveSha256','sourceAndStateFiles','modelLocations']}))
