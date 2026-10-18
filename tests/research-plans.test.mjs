import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {validateExperimentPlan,freezeExperimentPlan} from '../server/research-plans.mjs';
import {installResearchNotes} from '../server/research-notes.mjs';
const request={type:'experiment',pipelineId:'depth-surface',sourceExperiment:'experiment-4',title:'Depth without source drift',hypothesis:'Depth improves parallax',change:'Replace luminance relief with depth',controls:'Same pixels and camera',success:'Fewer holes on fixed path'};
const catalog={experiments:[{id:'experiment-4',title:'Source surface',number:4,source:{sha256:'a'.repeat(64),width:512,height:512,profile:'flux1-dev'}}]};
test('designs require known pipelines and complete controlled comparisons',()=>{
 assert.throws(()=>validateExperimentPlan({...request,pipelineId:'uninstalled-magic'}));
 for(const field of ['title','hypothesis','change','controls','success']){
  assert.throws(()=>validateExperimentPlan({...request,[field]:' '}));
  assert.throws(()=>validateExperimentPlan({...request,[field]:'x'.repeat(2001)}));
 }
 assert.throws(()=>freezeExperimentPlan({...request,sourceExperiment:'experiment-99'},catalog,{id:'test'}));
 const plan=freezeExperimentPlan({...request,source:{sha256:'b'.repeat(64)},status:'complete'},catalog,{id:'plan-test',now:123});
 assert.equal(plan.source.sha256,'a'.repeat(64));assert.equal(plan.status,'planned');assert.equal(plan.conclusion,null);assert.deepEqual(plan.evidence,[]);
 assert.equal(plan.pipeline.execution.enabled,false);assert.equal(plan.createdAt,123);
 catalog.experiments[0].source.width=1024;assert.equal(plan.source.width,512);
 catalog.experiments[0].source.width=512;
});
test('plans migrate old notebooks, persist immutable source snapshots, and retain notes',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'imagen-plans-')),catalogFile=path.join(root,'catalog.json');
 await writeFile(catalogFile,JSON.stringify(catalog));await writeFile(path.join(root,'notes.json'),JSON.stringify({notes:{'method-01':{note:'Keep me',shortlisted:true}},ideas:[]}));
 let middleware;installResearchNotes({middlewares:{use(fn){middleware=fn;}}},{root,catalogFile});
 const server=http.createServer((req,res)=>middleware(req,res,()=>res.writeHead(404).end()));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port,url=origin+'/api/research-notes';
 const write=(value,from=origin)=>fetch(url,{method:'POST',headers:{Origin:from,'Content-Type':'application/json'},body:JSON.stringify(value)});
 try{
  assert.equal((await write(request,'https://foreign.test')).status,403);
  assert.equal((await write({...request,sourceExperiment:'experiment-99'})).status,400);
  const created=await write(request).then(r=>r.json());assert.equal(created.plans.length,1);assert.equal(created.notes['method-01'].note,'Keep me');
  await write({type:'note',id:'pipeline-depth-surface',note:'Next test',shortlisted:true});
  let disk=JSON.parse(await readFile(path.join(root,'notes.json'),'utf8'));assert.equal(disk.plans[0].source.sha256,'a'.repeat(64));
  assert.equal(disk.plans[0].pipeline.execution.startGPU,false);
  // Reinstall the middleware as a new process would, then read the persisted design.
  installResearchNotes({middlewares:{use(fn){middleware=fn;}}},{root,catalogFile});
  const restored=await fetch(url).then(r=>r.json());assert.equal(restored.plans[0].id,created.plans[0].id);assert.equal(restored.notes['pipeline-depth-surface'].note,'Next test');
 }finally{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});
