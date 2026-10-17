import { spawn } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const apiPrefix = '/api/native-live/';
const legacyState = path.join(os.homedir(), 'kinship-of-cancer/tools/artwork/.state');
const factoryState = process.env.ARTWORK_FACTORY_STATE || (existsSync(legacyState) ? legacyState :
  fileURLToPath(new URL('../deployment/controller/tools/artwork/.state/', import.meta.url)));
const tokenFile = process.env.ARTWORK_CONTROL_TOKEN_FILE || path.join(factoryState, 'control/token');
const host = process.env.ARTWORK_SSH_HOST || 'root@184.186.104.194';
const port = process.env.ARTWORK_SSH_PORT || '11012';
const liveFields = new Map(Object.entries({ guidance: [0, 20], steps: [1, 120], batch_size: [1, 64],
  shell_scale: [.01, 4], shell_coupling: [-16, 16], seed_lock: [0, .95], arc: [-8, 8],
  amp: [-8, 8], spin: [-32, 32], base: [-8, 8], orbit: [-32, 32] }));
const integerFields = new Set(['steps', 'batch_size']);
const idPattern = /^[A-Za-z0-9_-]{1,100}$/;

// Fixed remote program; request values travel over stdin, never shell interpolation.
// Source inspection reads the deployed worker's declared fields without importing/loading a model.
const remoteProgram = String.raw`import ast,json,math,re,socket,sys,time
from pathlib import Path
NATIVE='/workspace/artwork/native/flux1.sock'
PIPER='/tmp/piper.sock'
FIELD_CACHE=None
def connect(path,payload):
 s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);s.settimeout(8);s.connect(path)
 s.sendall((json.dumps(payload)+'\n').encode());return s
def request(path,payload):
 s=connect(path,payload)
 try:
  raw=s.makefile('rb').readline(32*1024*1024+1)
  if len(raw)>32*1024*1024:raise ValueError('oversized worker response')
  return json.loads(raw)
 finally:s.close()
def fields():
 global FIELD_CACHE
 if FIELD_CACHE is not None:return FIELD_CACHE
 tree=ast.parse(Path('/workspace/artwork/native/source/worker.py').read_text())
 for node in tree.body:
  if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='LIVE_JOB_FIELDS' for t in node.targets):
   result={}
   for key,value in zip(node.value.keys,node.value.values):
    cast,low,high,target=value.elts
    result[ast.literal_eval(key)]={'type':'integer' if cast.id=='int' else 'number','min':ast.literal_eval(low),'max':ast.literal_eval(high),'jobKey':ast.literal_eval(target)}
   FIELD_CACHE=result;return result
 return {}
def public(job):
 result={key:job.get(key) for key in ('id','kind','status','phase','step','total_steps','created','started','finished','width','height','piper_asset_ready')}
 match=re.fullmatch(r'factory/([A-Za-z0-9_-]{1,100})\.png',str(job.get('filename') or ''))
 result['factoryJobId']=match.group(1) if match else None
 result['parameters']={key:job[rule['jobKey']] for key,rule in fields().items() if rule['jobKey'] in job and isinstance(job[rule['jobKey']],(int,float))}
 result['editable']=job.get('kind')=='atlas_sphere' and job.get('status') in ('queued','running')
 result['parameterChanges']=(job.get('parameter_changes') or [])[-20:]
 return result
def emit(value):print(json.dumps(value,separators=(',',':')),flush=True)
def main():
 raw=sys.stdin.buffer.read(8193)
 if len(raw)>8192:raise ValueError('oversized request')
 value=json.loads(raw);action=value.get('action')
 if action=='events':
  s=connect(PIPER,{'type':'asset.subscribe','consumer':'imagen-native-live'});s.settimeout(None)
  stream=s.makefile('rb');ack=json.loads(stream.readline(65537))
  if ack.get('status')!='subscribed':raise ValueError('subscription failed')
  emit({'type':'ready','source':'original-worker-asset-publish'})
  while True:
   line=stream.readline(65537)
   if not line or len(line)>65536:return
   event=json.loads(line);asset=event.get('asset') or {}
   match=re.fullmatch(r'/outputs/factory/([A-Za-z0-9_-]{1,100})\.png',str(asset.get('access_url') or ''))
   if event.get('event')!='ASSET_READY' or not match:continue
   emit({'type':'asset','nativeJobId':event.get('job_id'),'jobId':match.group(1),'index':asset.get('index'),'total':asset.get('total'),'created':event.get('ts')})
  return
 jobs=request(NATIVE,{'op':'jobs'}).get('jobs',[])
 if action=='state':
  health=request(NATIVE,{'op':'ping'})
  try:piper=request(PIPER,{'type':'health'})
  except Exception:piper={'ok':False,'status':'unavailable'}
  ordered=sorted(jobs,key=lambda j:j.get('created') or 0,reverse=True)
  active=[j for j in ordered if j.get('status') in ('queued','running')]
  selected=(active+[j for j in ordered if j.get('status') not in ('queued','running')][:20])[:100]
  emit({'ok':True,'observedAt':time.time(),'profile':'flux1-dev','worker':{key:health.get(key) for key in ('loaded','gpu','backend','img2img_loaded')},
   'assetBroker':{key:piper.get(key) for key in ('ok','status','published','subscribers')},
   'capabilities':{'liveUpdateScope':'next_atlas_batch','ordinaryImageLiveUpdates':False,'fields':fields()},'jobs':[public(j) for j in selected]})
  return
 if action!='update':raise ValueError('unsupported action')
 ident=value.get('id');changes=value.get('fields')
 if not isinstance(ident,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',ident):raise ValueError('invalid job ID')
 supported=fields()
 if not isinstance(changes,dict) or not changes or len(changes)>len(supported):raise ValueError('invalid update fields')
 for key,number in changes.items():
  rule=supported.get(key)
  if not rule or type(number) not in (int,float) or not math.isfinite(number) or not rule['min']<=number<=rule['max']:raise ValueError('invalid live field')
  if rule['type']=='integer' and type(number) is not int:raise ValueError('integer required')
 job=next((j for j in jobs if j.get('id')==ident),None)
 if not job:emit({'ok':False,'status':404,'problem':'That native job is not available.'});return
 if job.get('kind')!='atlas_sphere':
  emit({'ok':False,'status':409,'problem':'Live changes apply to atlas batches. Single images retain their submitted settings.'});return
 if job.get('status') not in ('queued','running'):
  emit({'ok':False,'status':409,'problem':'This job has finished accepting live changes.'});return
 result=request(NATIVE,{'op':'update','id':ident,'fields':changes})
 emit({'ok':result.get('ok') is True,'job':public(result.get('job',job)),'changed':result.get('changed',{}),'rejected':result.get('rejected',{})})
try:main()
except ValueError:emit({'ok':False,'status':400,'problem':'The native request could not be read.'})
except Exception:emit({'ok':False,'status':503,'problem':'The native worker connection is unavailable.'})
`;

function startRemote(payload) {
  if (!/^(?:root@)?[A-Za-z0-9.-]+$/.test(host) || !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid configured worker endpoint');
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  const child = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5',
    '-p', port, host.includes('@') ? host : 'root@' + host, 'python3 -c ' + quote(remoteProgram)], { stdio: ['pipe', 'pipe', 'ignore'] });
  child.stdin.on('error', () => {});
  child.stdin.end(JSON.stringify(payload));
  return child;
}

async function callNative(payload) {
  return new Promise((resolve, reject) => {
    const child = startRemote(payload);
    const chunks = [];
    let bytes = 0;
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Native worker timeout')); }, 12000);
    child.on('error', reject);
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 256 * 1024) { child.kill(); reject(new Error('Native response too large')); }
      else chunks.push(chunk);
    });
    child.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0) { reject(new Error('Native connection failed')); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (error) { reject(error); }
    });
  });
}

export async function authorized(request) {
  try {
    const cookies = String(request.headers.cookie || '').split(';').map(value => value.trim());
    const cookie = cookies.find(value => value.startsWith('__Host-artwork-control=')) || cookies.find(value => value.startsWith('artwork-dev-control=')) || '';
    const [expires, nonce, signature] = cookie.slice(cookie.indexOf('=') + 1).split('.');
    const now = Date.now() / 1000;
    if (!/^\d+$/.test(expires || '') || Number(expires) <= now || Number(expires) >= now + 43260 || !/^[A-Za-z0-9_-]{24}$/.test(nonce || '') || !/^[A-Za-z0-9_-]{43}$/.test(signature || '')) return false;
    let token = process.env.ARTWORK_CONTROL_TOKEN;
    if (!token) {
      const info = await stat(tokenFile);
      if (!info.isFile() || info.size > 4096 || info.mode & 0o077) return false;
      token = await readFile(tokenFile, 'utf8');
    }
    if (!token) return false;
    const expected = createHmac('sha256', token).update(expires + '.' + nonce).digest('base64url');
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch { return false; }
}

function allowedOrigin(origin, server) {
  if (origin === 'https://artwork.influx.vision') return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) &&
      [server.config.server.port, server.config.preview.port].map(String).includes(url.port);
  } catch { return false; }
}

function body(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    request.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 4096) reject(new Error('Request too large'));
      else chunks.push(chunk);
    });
    request.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (error) { reject(error); } });
    request.on('error', reject);
    request.on('aborted', () => reject(new Error('Request interrupted')));
  });
}

export async function collectNativeLiveState() { return callNative({ action: 'state' }); }

export function installNativeLive(server) {
  let activeStreams = 0;
  const children = new Set();
  server.httpServer?.once('close', () => { for (const child of children) child.kill(); });
  server.middlewares.use((request, response, next) => {
    let pathname;
    try { pathname = new URL(request.url, 'http://localhost').pathname; } catch { return next(); }
    if (!pathname.startsWith(apiPrefix)) return next();
    const action = pathname.slice(apiPrefix.length);
    const send = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(value));
    };
    void (async () => {
      if (!['state', 'update', 'events'].includes(action)) { send(404, { ok: false }); return; }
      if (request.method !== (action === 'update' ? 'POST' : 'GET')) { send(405, { ok: false }); return; }
      if (!await authorized(request)) { send(403, { ok: false, problem: 'Open Controls with your access key.' }); return; }
      if (action === 'update' && !allowedOrigin(request.headers.origin, server)) { send(403, { ok: false }); return; }
      if (action === 'state') {
        const result = await collectNativeLiveState(); send(result.ok ? 200 : 503, result); return;
      }
      if (action === 'update') {
        let value;
        try { value = await body(request); } catch { send(400, { ok: false }); return; }
        if (!value || Array.isArray(value) || !idPattern.test(value.id || '') || Object.keys(value).some(key => !['id', 'fields'].includes(key)) ||
            !value.fields || Array.isArray(value.fields) || typeof value.fields !== 'object' || !Object.keys(value.fields).length ||
            Object.entries(value.fields).some(([key, number]) => !liveFields.has(key) || !Number.isFinite(number) ||
              number < liveFields.get(key)[0] || number > liveFields.get(key)[1] || integerFields.has(key) && !Number.isInteger(number))) {
          send(400, { ok: false, problem: 'Choose supported live fields within their limits.' }); return;
        }
        const result = await callNative({ action: 'update', id: value.id, fields: value.fields });
        send(result.ok ? 200 : result.status || 503, result); return;
      }
      if (activeStreams >= 4) { send(429, { ok: false }); return; }
      const child = startRemote({ action: 'events' }); children.add(child); activeStreams++;
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
      response.write(': Native worker events\n\n');
      const heartbeat = setInterval(async () => {
        if (!await authorized(request)) { response.end(); return; }
        response.write(': keepalive\n\n');
      }, 15000);
      let buffered = '';
      child.stdout.on('data', chunk => {
        buffered += chunk.toString('utf8');
        if (buffered.length > 65536) { child.kill(); return; }
        for (;;) {
          const index = buffered.indexOf('\n'); if (index < 0) break;
          const line = buffered.slice(0, index); buffered = buffered.slice(index + 1);
          try {
            const event = JSON.parse(line);
            if (response.writableLength > 65536) { child.kill(); return; }
            response.write('event: ' + (event.type === 'asset' ? 'asset' : event.type === 'ready' ? 'ready' : 'unavailable') + '\ndata: ' + JSON.stringify(event) + '\n\n');
          } catch { child.kill(); }
        }
      });
      child.on('error', () => response.end());
      child.once('close', () => { clearInterval(heartbeat); children.delete(child); activeStreams--; response.end(); });
      response.once('close', () => { clearInterval(heartbeat); child.kill(); });
    })().catch(() => { if (!response.headersSent) send(503, { ok: false, problem: 'The native worker connection is unavailable.' }); else response.end(); });
  });
}
