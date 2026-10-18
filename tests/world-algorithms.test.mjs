import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installWorldAlgorithms, defaults, validateSettings } from '../server/world-algorithms.mjs';

test('settings reject invalid families, step sizes and batch counts',()=>{
 for(const patch of [{families:[]},{families:['unknown']},{proposals:9},{intervalSeconds:1.5},{stepFraction:NaN},{paused:1}])assert.throws(()=>validateSettings({...defaults,...patch}));
 assert.deepEqual(validateSettings(defaults),defaults);
});
test('live algorithm API persists authenticated changes and exposes only public state',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'imagen-algorithms-'));
 let handler;installWorldAlgorithms({middlewares:{use:value=>{handler=value;}}},{directory,authorize:async req=>req.headers['x-test-auth']==='yes'});
 const server=createServer((req,res)=>handler(req,res,()=>res.writeHead(404).end()));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const endpoint='http://127.0.0.1:'+server.address().port+'/api/world-algorithms';
 const post=(settings,headers={})=>fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://artwork.influx.vision',...headers},body:JSON.stringify(settings)});
 try{
  assert.equal((await post(defaults)).status,403);
  assert.equal((await post(defaults,{'x-test-auth':'yes',Origin:'https://foreign.example'})).status,403);
  assert.equal((await post({...defaults,proposals:9},{'x-test-auth':'yes'})).status,400);
  const settings={...defaults,paused:true,families:['terrain'],stepFraction:.08};
  const response=await post(settings,{'x-test-auth':'yes'});assert.equal(response.status,200);
  const written=JSON.parse(await readFile(directory+'/fit-settings.json','utf8'));assert.deepEqual(written.settings,settings);
  await writeFile(directory+'/fit-loop.json',JSON.stringify({status:'paused',pid:process.pid,seed:'/private/seed',run:'/private/run',cycle:7,revision:written.revision}));
  const view=await(await fetch(endpoint)).json();assert.equal(view.canEdit,false);assert.equal(view.state.alive,true);assert.equal(view.state.cycle,7);assert.ok(!('seed' in view.state));assert.ok(!('run' in view.state));assert.equal(view.revision,written.revision);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
});
