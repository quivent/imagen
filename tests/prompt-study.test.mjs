import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,rm,mkdir,writeFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {installPromptStudy} from '../server/prompt-study.mjs';
test('native study API prepares frozen JSON only and rejects generation or foreign writes',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'imagen-prompt-study-'));let middleware;
 installPromptStudy({middlewares:{use(fn){middleware=fn;}}},{root});
 const server=http.createServer((req,res)=>middleware(req,res,()=>res.writeHead(404).end()));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port,url=origin+'/api/prompt-study';
 const write=(value,from=origin)=>fetch(url,{method:'POST',headers:{Origin:from,'Content-Type':'application/json'},body:JSON.stringify(value)});
 try{
  const data=await fetch(url).then(r=>r.json());assert.equal(data.preview.plannedImages,6);assert.deepEqual(data.status.runs,[]);assert.equal(data.preview.execution.started,false);assert.deepEqual(await readdir(root),[]);
  assert.equal((await write({action:'prepare'},'https://foreign.test')).status,403);
  assert.equal((await write({action:'generate'})).status,400);
  assert.equal((await write({action:'prepare',root:'/production'})).status,400);
  const [a,b]=await Promise.all([write({action:'prepare'}).then(r=>r.json()),write({action:'prepare'}).then(r=>r.json())]);assert.equal(a.prepared.id,b.prepared.id);
  const files=await readdir(path.join(root,'runs',a.prepared.id));assert.deepEqual(files.sort(),['adapter-argv.json','package.json']);
  const saved=JSON.parse(await readFile(path.join(root,'runs',a.prepared.id,'package.json'),'utf8'));assert.equal(saved.model,'flux1-dev');assert.equal(saved.execution.started,false);
 }finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});

test('guided execution requires an explicit authorized action; guidance and pause never launch inference',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'imagen-guided-study-'));let middleware;const launches=[];
 installPromptStudy({middlewares:{use(fn){middleware=fn;}}},{root,launch:id=>launches.push(id)});
 const server=http.createServer((req,res)=>middleware(req,res,()=>res.writeHead(404).end()));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port,url=origin+'/api/prompt-study';
 const write=(value,from=origin)=>fetch(url,{method:'POST',headers:{Origin:from,'Content-Type':'application/json'},body:JSON.stringify(value)});
 try{
  const prepared=(await write({action:'prepare'}).then(r=>r.json())).prepared,id=prepared.id;
  let data=await fetch(url).then(r=>r.json());assert.equal(data.workflow.stage,'prepared');assert.equal(launches.length,0);
  assert.equal((await write({action:'start',package:id},'https://foreign.test')).status,403);
  assert.equal((await write({action:'guidance',package:id,guidance:{maxPairs:10,reviewEvery:1,focus:''}})).status,400);
  assert.equal((await write({action:'guidance',package:id,guidance:{maxPairs:1,reviewEvery:1,focus:'Spatial clarity'}})).status,200);assert.equal(launches.length,0);
  assert.equal((await write({action:'start',package:id})).status,200);assert.equal(launches[0],id);
  await write({action:'pause',package:id});data=await fetch(url).then(r=>r.json());assert.equal(data.workflow.enabled,false);assert.equal(data.workflow.stage,'paused');assert.equal(data.workflow.guidance.focus,'Spatial clarity');
  const files=await readdir(path.join(root,'runs',id));assert.ok(!files.includes('factory'));
  assert.equal((await write({action:'review',package:id,pair:'pair-01',choice:'left',continue:true})).status,400);
 }finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});


test('only registered hash-verified study originals are served and archive confirmation is read-only',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'imagen-study-images-'));let middleware,archiveReads=0;
 installPromptStudy({middlewares:{use(fn){middleware=fn;}}},{root,archive:async()=>{archiveReads++;return {jobs:[{id:'job-A',sha256:hash},{id:'job-B',sha256:hash}]};}});
 const server=http.createServer((req,res)=>middleware(req,res,()=>res.writeHead(404).end()));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port,url=origin+'/api/prompt-study';
 const prepared=await fetch(url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'prepare'})}).then(r=>r.json());const id=prepared.prepared.id;
 const directory=path.join(root,'runs',id),work=path.join(directory,'factory/work/synthetic');await mkdir(work,{recursive:true});
 const bytes=Buffer.from('89504e470d0a1a0a0000000d494844520000020000000200','hex'),hash=createHash('sha256').update(bytes).digest('hex');const file=path.join(work,'result.png');await writeFile(file,bytes);const source=await realpath(file);
 const state={schema:1,package:id,stage:'waiting-review',enabled:false,guidance:{maxPairs:3,reviewEvery:1,focus:''},pairs:{'pair-01':{arms:{A:{job:'job-A',source,sha256:hash,seconds:3},B:{job:'job-B',source,sha256:hash,seconds:3}}}},reviews:{},events:[],problem:null,updatedAt:Date.now()/1000};await writeFile(path.join(directory,'control.json'),JSON.stringify(state));
 try{
  let data=await fetch(url).then(r=>r.json());const imageURL=origin+data.workflow.pairs[0].images.left.url;assert.equal(data.workflow.pairs[0].revealedArms,null);
  let image=await fetch(imageURL);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await image.arrayBuffer()),bytes);
  data=await fetch(url).then(r=>r.json());assert.equal(data.workflow.archive.state,'verified');assert.equal(archiveReads,1);
  await writeFile(file,'Changed original');assert.equal((await fetch(imageURL)).status,404);
  const outside=path.join(root,'outside.png');await writeFile(outside,bytes);for(const result of Object.values(state.pairs['pair-01'].arms))result.source=await realpath(outside);await writeFile(path.join(directory,'control.json'),JSON.stringify(state));assert.equal((await fetch(imageURL)).status,404);
 }finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});

test('editable study settings persist without starting jobs and reject mismatched paired controls',async()=>{
 const {execFileSync}=await import('node:child_process');
 const root=await mkdtemp(path.join(tmpdir(),'imagen-settings-'));let middleware,starts=0;
 const original={width:512,height:512,steps:28,guidance_scale:3.5,max_sequence_length:512};
 const prepared=JSON.parse(execFileSync('python3',['-B','tools/artwork/prompt_clarity.py','--root',root,'prepare-corpus'],{input:JSON.stringify(original),encoding:'utf8'}));
 installPromptStudy({middlewares:{use(fn){middleware=fn;}}},{root,launch(){starts++;}});
 const server=http.createServer((req,res)=>middleware(req,res,()=>res.writeHead(404).end()));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 const save=settings=>fetch(origin+'/api/prompt-study',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'settings',package:prepared.id,settings})});
 try{
  const settings={...original,width:768,height:768,steps:16};const result=await save(settings);assert.equal(result.status,200);
  assert.deepEqual(JSON.parse(await readFile(path.join(root,'settings.json'),'utf8')).settings,settings);assert.equal(starts,0);
  assert.equal((await save({...settings,height:640})).status,400);assert.equal((await save({...settings,steps:17})).status,400);
  assert.deepEqual(JSON.parse(await readFile(path.join(root,'settings.json'),'utf8')).settings,settings);
  assert.ok(!(await readdir(path.join(root,'runs',prepared.id))).includes('factory'));
 }finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});
