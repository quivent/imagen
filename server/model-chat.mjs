import {spawn} from 'node:child_process';
import {authorized} from './native-live.mjs';
import {localWorkstationRequest} from './workstation-session.mjs';

export const chatModels=Object.freeze({qwen:{port:8005,name:'qwen-precision'},pixtral:{port:8002,name:'pixtral-critic'}});
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
// User messages travel as JSON over stdin. Only this fixed program is executed.
const program=String.raw`import json,sys,urllib.request
def emit(value):
 print(json.dumps(value,ensure_ascii=False),flush=True)
try:
 data=json.load(sys.stdin)
 models={'qwen':(8005,'qwen-precision'),'pixtral':(8002,'pixtral-critic')}
 port,name=models[data['model']]
 payload={'model':name,'messages':data['messages'],'stream':True,'max_tokens':1024,'temperature':0.35}
 if data['model']=='qwen': payload['chat_template_kwargs']={'enable_thinking':False}
 request=urllib.request.Request('http://127.0.0.1:'+str(port)+'/v1/chat/completions',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
 with urllib.request.urlopen(request,timeout=180) as response:
  for raw in response:
   line=raw.decode('utf-8').strip()
   if not line.startswith('data:'): continue
   text=line[5:].strip()
   if text=='[DONE]':
    emit({'done':True});break
   value=json.loads(text)
   for choice in value.get('choices',[]):
    delta=choice.get('delta',{}).get('content')
    if isinstance(delta,str) and delta: emit({'delta':delta})
  else: emit({'done':True})
except BrokenPipeError:
 pass
except Exception:
 try: emit({'error':'The model is temporarily unavailable or could not accept this conversation. Try a shorter message or wait for startup to finish.'})
 except BrokenPipeError: pass
`;

export function validateChat(value){
 if(!value||Object.keys(value).some(key=>key!=='messages')||!Array.isArray(value.messages)||!value.messages.length||value.messages.length>32)throw Error('Invalid conversation');
 let size=0;
 const messages=value.messages.map(message=>{
  if(!message||Object.keys(message).some(key=>!['role','content'].includes(key))||!['user','assistant'].includes(message.role)||typeof message.content!=='string'||!message.content.trim()||message.content.length>16000)throw Error('Invalid message');
  size+=Buffer.byteLength(message.content);return {role:message.role,content:message.content};
 });
 if(size>24000||messages.at(-1).role!=='user')throw Error('Conversation is too long');
 return messages;
}

function remote(model,messages){
 const host=process.env.ARTWORK_SSH_HOST||'root@184.186.104.194',port=process.env.ARTWORK_SSH_PORT||'11012';
 if(!/^(?:root@)?[A-Za-z0-9.-]+$/.test(host)||!/^\d{1,5}$/.test(port)||Number(port)>65535||Number(port)<1)throw Error('Invalid worker endpoint');
 const child=spawn('ssh',['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=5','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2','-p',port,host.includes('@')?host:'root@'+host,'python3 -u -c '+quote(program)],{stdio:['pipe','pipe','ignore']});
 child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({model,messages}));return child;
}

export function installModelChat(server,{authorize=authorized,launch=remote}={}){
 const children=new Set(),busy=new Map();
 server.middlewares.use((req,res,next)=>{
  const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/api/model-chat/'))return next();
  const fail=(status,message)=>{if(!res.headersSent)res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(JSON.stringify({ok:false,error:message}));};
  if(req.method!=='POST'){fail(405,'Use POST to send a message.');return;}
  if(!localWorkstationRequest(req)){fail(403,'Local workstation access required.');return;}
  const model=url.pathname.slice('/api/model-chat/'.length);if(!Object.hasOwn(chatModels,model)){fail(404,'Unknown model.');return;}
  void(async()=>{
   if(!await authorize(req)){fail(401,'Workstation session required.');return;}
   if(!String(req.headers['content-type']||'').startsWith('application/json')){fail(415,'JSON required.');return;}
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>65536){fail(413,'Conversation is too long.');return;}}
   let messages;try{messages=validateChat(JSON.parse(raw));}catch{fail(400,'Use text messages and keep the conversation short.');return;}
   if(busy.has(model)){fail(409,'This model is already answering. Stop or wait for that reply.');return;}
   if(res.destroyed)return;
   busy.set(model,null);let child;
   try{child=launch(model,messages);}catch{busy.delete(model);fail(503,'The model connection is unavailable.');return;}
   busy.set(model,child);children.add(child);res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Accel-Buffering':'no'});res.flushHeaders?.();
   let buffer='',bytes=0,finished=false;
   const send=value=>{if(!res.destroyed&&!res.writableEnded)res.write(JSON.stringify(value)+'\n');};
   const cleanup=()=>{clearTimeout(timer);children.delete(child);if(busy.get(model)===child)busy.delete(model);};
   const abort=()=>{if(!finished){finished=true;child.kill();cleanup();}};
   const timer=setTimeout(()=>{send({error:'The reply timed out. You can try again.'});abort();res.end();},190000);timer.unref?.();
   res.once('close',abort);
   child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
    bytes+=Buffer.byteLength(chunk);if(bytes>2*1024*1024||res.writableLength>256*1024){send({error:'The reply exceeded the output limit.'});abort();res.end();return;}
    buffer+=chunk;let at;while((at=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);try{const event=JSON.parse(line);if(typeof event.delta==='string')send({delta:event.delta});else if(event.done===true){send({done:true});finished=true;cleanup();res.end();child.kill();return;}else if(typeof event.error==='string'){send({error:'The model is temporarily unavailable or could not accept this conversation. Try a shorter message or wait for startup to finish.'});abort();res.end();return;}}catch{send({error:'The model returned an unreadable reply.'});abort();res.end();return;}}
   });
   child.once('error',()=>{if(finished)return;send({error:'The model connection is unavailable.'});abort();res.end();});
   child.once('close',()=>{cleanup();if(!finished){finished=true;send({error:'The model connection ended before the reply completed.'});res.end();}});
  })().catch(()=>fail(503,'The model connection is unavailable.'));
 });
 server.httpServer?.once('close',()=>{for(const child of children)child.kill();children.clear();busy.clear();});
}
