import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {installWorkbenchTasks,validateWorkbenchTask} from '../server/workbench-tasks.mjs';
test('independent Workbench ledger persists tasks and statuses with local write authorization',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'imagen-workbench-tasks-'));let middleware;
 installWorkbenchTasks({middlewares:{use(fn){middleware=fn;}}},{root});
 const server=http.createServer((req,res)=>middleware(req,res,()=>res.writeHead(404).end()));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port,url=origin+'/api/workbench-tasks';
 const write=(value,from=origin)=>fetch(url,{method:'POST',headers:{Origin:from,'Content-Type':'application/json'},body:JSON.stringify(value)});
 try{
  const empty=await fetch(url).then(r=>r.json());assert.deepEqual(empty.tasks,[]);
  assert.equal((await write({type:'create',title:'Test','detail':''},'https://foreign.test')).status,403);
  assert.throws(()=>validateWorkbenchTask({type:'create',title:' ',detail:''}));
  const first=await write({type:'create',title:'Test fitting','detail':'Same source'}).then(r=>r.json());
  const id=first.tasks[0].id;assert.equal(first.tasks[0].workspace,'workbench');
  assert.equal((await write({type:'status',id:'../production',status:'done'})).status,400);
  await write({type:'status',id,status:'done'});
  installWorkbenchTasks({middlewares:{use(fn){middleware=fn;}}},{root});
  const restored=await fetch(url).then(r=>r.json());assert.equal(restored.tasks[0].status,'done');
  assert.equal(JSON.parse(await readFile(path.join(root,'tasks.json'),'utf8')).tasks[0].title,'Test fitting');
 }finally{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});
test('Workbench study requests isolate legacy records, writes and cross-study task IDs',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'imagen-study-tasks-'));let middleware;
 const legacyId='WB-00000000-0000-0000-0000-000000000000';
 await writeFile(path.join(root,'tasks.json'),JSON.stringify({schemaVersion:1,workspace:'workbench',tasks:[{id:legacyId,title:'Legacy GLSL',workspace:'workbench',status:'next'}]}));
 installWorkbenchTasks({middlewares:{use(fn){middleware=fn;}}},{root});
 const server=http.createServer((req,res)=>middleware(req,res,()=>res.writeHead(404).end()));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const url=study=>origin+'/api/workbench-tasks'+(study===undefined?'':'?study='+encodeURIComponent(study));
 const get=study=>fetch(url(study)).then(response=>response.json());
 const write=(study,value)=>fetch(url(study),{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(value)});
 try{
  assert.equal((await get()).tasks[0].studyId,'glsl-worlds');
  assert.deepEqual((await get('flux1-prompt-clarity')).tasks,[]);
  for(const invalid of ['production','unknown','../glsl-worlds',''])assert.equal((await fetch(url(invalid))).status,400);
  assert.equal((await write('flux1-prompt-clarity',{type:'status',id:legacyId,status:'done'})).status,400);
  const responses=await Promise.all(['glsl-worlds','flux1-prompt-clarity'].map(study=>write(study,{type:'create',title:study,detail:''})));
  assert.deepEqual(responses.map(response=>response.status),[200,200]);
  const glsl=await get('glsl-worlds'),adhc=await get('flux1-prompt-clarity');
  assert.equal(glsl.tasks.length,2);assert.equal(adhc.tasks.length,1);
  assert.equal(adhc.tasks[0].studyId,'flux1-prompt-clarity');
  assert.equal((await write('glsl-worlds',{type:'status',id:adhc.tasks[0].id,status:'done'})).status,400);
  assert.equal((await get('flux1-prompt-clarity')).tasks[0].status,'next');
  const disk=JSON.parse(await readFile(path.join(root,'tasks.json'),'utf8'));
  assert.equal(disk.tasks.length,3);assert.equal(disk.tasks.find(task=>task.id===legacyId).studyId,'glsl-worlds');
  installWorkbenchTasks({middlewares:{use(fn){middleware=fn;}}},{root});
  assert.equal((await get('flux1-prompt-clarity')).tasks.length,1);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});
