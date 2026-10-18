import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('hashed source and render images are reused; failed images are never stored', async () => {
 const handlers = {}, stored = new Map();
 let requests = 0;
 const cache = { keys:async()=>[...stored.keys()].map(url=>new Request(url)),delete:async r=>stored.delete(r.url),match: async r => stored.get(r.url)?.clone(), put: async (r, response) => stored.set(r.url, response) };
 const context = { URL, Headers, Response, self: { location: { origin: 'https://studio.test' }, addEventListener: (name, fn) => { handlers[name] = fn; } }, caches: { open: async () => cache }, fetch: async request => { requests++; return new Response('pixels', { status: request.url.includes('missing') ? 404 : 200, headers: { 'Content-Type': 'image/png' } }); } };
 vm.runInNewContext(await readFile(new URL('../public/image-cache-sw.js', import.meta.url), 'utf8'), context);
 async function load(path) {
  let response, lifetime;
  handlers.fetch({ request: new Request('https://studio.test'+path), respondWith: value => { response = value; }, waitUntil: value => { lifetime = value; } });
  assert.ok(response, 'image route is intercepted');
  await response; await lifetime;
 }
 const sha = 'a'.repeat(64);
 for (const path of ['/api/gallery/image?key=source&sha256='+sha, '/api/world-experiments/image/'+sha+'.png']) {
  const before = requests;
  await load(path); await load(path);
  assert.equal(requests-before, 1, 'second image load uses the immutable cache');
 }
 const failed = '/api/gallery/image?key=missing&sha256='+sha;
 await load(failed); await load(failed);
 assert.equal(stored.has('https://studio.test'+failed), false);
 assert.equal(requests, 4);
});

test('image cache evicts oldest entries when its byte or entry budget is exceeded',async()=>{
 const handlers={},stored=new Map();let bytes=30;
 const cache={match:async request=>stored.get(request.url)?.clone(),put:async(request,response)=>stored.set(request.url,response),keys:async()=>[...stored.keys()].map(url=>new Request(url)),delete:async request=>stored.delete(request.url)};
 const context={URL,Headers,Response,self:{location:{origin:'https://studio.test'},addEventListener:(name,handler)=>handlers[name]=handler},caches:{open:async()=>cache},fetch:async()=>new Response('x'.repeat(bytes),{headers:{'Content-Type':'image/png'}})};
 const source=(await readFile(new URL('../public/image-cache-sw.js',import.meta.url),'utf8')).replace('MAX_ENTRIES=384,MAX_BYTES=128*1024*1024','MAX_ENTRIES=2,MAX_BYTES=100');
 vm.runInNewContext(source,context);
 async function load(index){let response,lifetime;handlers.fetch({request:new Request('https://studio.test/api/world-experiments/image/'+String(index).repeat(64)+'.png'),respondWith:value=>response=value,waitUntil:value=>lifetime=value});await response;await lifetime;}
 await load(1);await load(2);await load(3);assert.equal(stored.size,2);assert.ok([...stored.keys()].every(key=>!key.includes('/'+'1'.repeat(64))));
 bytes=80;await load(4);assert.equal(stored.size,1,'byte budget also evicts otherwise eligible entries');
});
