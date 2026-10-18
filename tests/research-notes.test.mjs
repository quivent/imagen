import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {installResearchNotes,validateResearchChange} from '../server/research-notes.mjs';
import {researchCatalog} from '../src/research-catalog.js';
test('research covers distinct layers and rejects malformed writes',()=>{
 assert.ok(researchCatalog.length>=30);assert.equal(new Set(researchCatalog.map(item=>item.id)).size,researchCatalog.length);
 for(const kind of ['Model','Representation','Renderer','Proposal'])assert.ok(researchCatalog.some(item=>item.kind===kind));
 for(const row of researchCatalog)assert.ok(row.trial&&row.glsl&&row.tradeoff);
 assert.throws(()=>validateResearchChange({type:'note',id:'../escape',note:'x',shortlisted:true}));
 assert.throws(()=>validateResearchChange({type:'idea',title:'',description:'x'}));
});
test('workstation notes and custom ideas persist, while foreign origins cannot write',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'imagen-research-'));let middleware;
 installResearchNotes({middlewares:{use(fn){middleware=fn;}}},{root});
 const server=http.createServer((req,res)=>middleware(req,res,()=>{res.writeHead(404).end();}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port,url=origin+'/api/research-notes';
 const write=(value,requestOrigin=origin)=>fetch(url,{method:'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json'},body:JSON.stringify(value)});
 try{
  assert.equal((await write({type:'note',id:'method-01',note:'test near views',shortlisted:true},'https://foreign.test')).status,403);
  assert.equal((await write({type:'note',id:'method-01',note:'test near views',shortlisted:true})).status,200);
  assert.equal((await write({type:'idea',title:'Shared test','description':'A measurable hypothesis'})).status,200);
  const state=await fetch(url).then(r=>r.json());assert.equal(state.notes['method-01'].note,'test near views');assert.equal(state.ideas[0].name,'Shared test');
 }finally{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});
