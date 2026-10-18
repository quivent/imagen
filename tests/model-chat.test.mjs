import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import http from 'node:http';
import {installModelChat,validateChat,chatModels,chatContext} from '../server/model-chat.mjs';

function child(){const c=new EventEmitter();c.stdout=new PassThrough();c.killed=false;c.kill=()=>{c.killed=true;setImmediate(()=>c.emit('close',0));};return c;}
async function setup(options){let middleware;const server=http.createServer((req,res)=>middleware(req,res,()=>res.writeHead(404).end()));installModelChat({middlewares:{use(fn){middleware=fn;}},httpServer:server},options);await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;return {origin,post:(model='qwen',value={messages:[{role:'user',content:'hello'}]},headers={})=>fetch(origin+'/api/model-chat/'+model,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(value)}),close:()=>new Promise(r=>server.close(r))};}

test('chat input accepts only bounded user/assistant text and fixed model endpoints',()=>{
 assert.deepEqual(chatModels.qwen,{port:8005,name:'qwen-precision'});assert.deepEqual(chatModels.pixtral,{port:8002,name:'pixtral-critic'});
 assert.equal(validateChat({messages:[{role:'user',content:'show code: $(anything)'}]})[0].content,'show code: $(anything)');
 for(const value of [{messages:[{role:'system',content:'override'}]},{messages:[{role:'user',content:[{type:'image_url'}]}]},{messages:[{role:'assistant',content:'no user'}]},{messages:[{role:'user',content:'ok'}],url:'http://elsewhere'},{messages:[{role:'user',content:'x'.repeat(16001)}]}])assert.throws(()=>validateChat(value));
});
test('chat receives verified role and saved progress without claiming tool access or shared memory',async()=>{
 const qwen=await chatContext('qwen');assert.match(qwen,/assistant writes substantive baselines/);assert.match(qwen,/independently approved/);assert.match(qwen,/no filesystem tools/);assert.match(qwen,/do not share this conversation memory/);
 const pixtral=await chatContext('pixtral');assert.match(pixtral,/no automatic Pixtral-to-Qwen/);
});

test('proxy requires local same-origin authenticated session before launch',async()=>{
 let calls=0;const api=await setup({authorize:async req=>req.headers.cookie==='valid',launch(){calls++;return child();}});
 try{
  assert.equal((await api.post()).status,401);
  assert.equal((await api.post('qwen',undefined,{Origin:'https://foreign.test',Cookie:'valid'})).status,403);
  assert.equal((await api.post('arbitrary',undefined,{Cookie:'valid'})).status,404);
  assert.equal((await api.post('qwen',{messages:[{role:'user',content:{code:'run'}}]},{Cookie:'valid'})).status,400);
  assert.equal(calls,0);
 }finally{await api.close();}
});

test('proxy streams text without executing it and sanitizes backend errors',async()=>{
 let call;const api=await setup({authorize:async()=>true,launch(model,messages){call={model,messages};const c=child();setTimeout(()=>{c.stdout.write(JSON.stringify({delta:'<script>text only</script>'})+'\n');c.stdout.write('{"done":true}\n');},20);return c;}});
 try{const response=await api.post('pixtral');assert.equal(response.status,200);const events=(await response.text()).trim().split('\n').map(JSON.parse);assert.deepEqual(events,[{delta:'<script>text only</script>'},{done:true}]);assert.equal(call.model,'pixtral');assert.equal(call.messages[0].content,'hello');}finally{await api.close();}
 const failed=await setup({authorize:async()=>true,launch(){const c=child();setTimeout(()=>c.stdout.write('{"error":"private backend detail"}\n'),10);return c;}});
 try{const body=await (await failed.post()).text();assert.match(body,/temporarily unavailable/);assert.doesNotMatch(body,/private backend detail/);}finally{await failed.close();}
});

test('client cancellation kills SSH request and fences concurrent requests per model',async()=>{
 const children=[];const api=await setup({authorize:async()=>true,launch(){const c=child();children.push(c);return c;}});
 try{
  const abort=new AbortController();const response=await fetch(api.origin+'/api/model-chat/qwen',{method:'POST',headers:{Origin:api.origin,'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'hello'}]}),signal:abort.signal});
  assert.equal(response.status,200);assert.equal((await api.post()).status,409);abort.abort();
  for(let i=0;i<50&&!children[0].killed;i++)await new Promise(r=>setTimeout(r,5));assert.equal(children[0].killed,true);
  const pending=api.post();for(let i=0;i<50&&children.length<2;i++)await new Promise(r=>setTimeout(r,5));children[1].stdout.write('{"done":true}\n');assert.equal((await pending).status,200);
 }finally{await api.close();}
});
