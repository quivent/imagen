import concurrent.futures,hashlib,json,os,time
from pathlib import Path
from urllib.request import Request,urlopen
root=Path('/workspace/artwork/wheelhouse');root.mkdir(exist_ok=True)
packages=[('nvidia-cublas','13.1.1.3'),('nvidia-cudnn-cu13','9.24.0.43'),('nvidia-nccl-cu13','2.30.7'),('nvidia-cusparse','12.6.3.3')]
def package(item):
 name,version=item
 with urlopen('https://pypi.org/pypi/'+name+'/'+version+'/json',timeout=15) as r:v=json.load(r)
 wheel=next(x for x in v['urls'] if 'manylinux' in x['filename'] and 'x86_64' in x['filename'])
 path=root/wheel['filename'];partial=path.with_suffix('.partial');fd=os.open(partial,os.O_RDWR|os.O_CREAT,0o600);os.ftruncate(fd,wheel['size'])
 block=8*1024*1024
 def part(start):
  end=min(start+block,wheel['size'])-1
  for attempt in range(4):
   try:
    req=Request(wheel['url'],headers={'Range':'bytes='+str(start)+'-'+str(end)})
    with urlopen(req,timeout=45) as r:
     assert r.status==206
     data=r.read()
    assert len(data)==end-start+1
    os.pwrite(fd,data,start);return
   except Exception:
    if attempt==3:raise
    time.sleep(1)
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:list(pool.map(part,range(0,wheel['size'],block)))
 os.close(fd)
 h=hashlib.sha256()
 with partial.open('rb') as f:
  while data:=f.read(8*1024*1024):h.update(data)
 assert h.hexdigest()==wheel['digests']['sha256']
 partial.replace(path)
 print(json.dumps({'wheel':name,'version':version,'bytes':wheel['size'],'sha256':h.hexdigest()}),flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(package,packages))
(root/'complete').touch()
