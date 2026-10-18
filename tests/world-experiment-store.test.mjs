import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createExperimentStore} from '../server/world-experiments.mjs';
import {worldExperimentPage} from '../server/world-experiment-pages.mjs';
test('disk-backed history retains compact summaries, loads recipes on demand, and bounds hot runs',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'world-store-'));let clock=100000;
 try{
  await mkdir(path.join(root,'experiments'));const catalogFile=path.join(root,'catalog.json');
  await writeFile(catalogFile,JSON.stringify({defaultExperiment:'one',experiments:[{id:'one',source:{sha256:'source'},searchSize:512}]}));
  const recipe={parameters:Array(848).fill(.25)},sha=createHash('sha256').update(JSON.stringify(recipe)).digest('hex');
  const image={file:'method1/run/a.png',sha256:'a'.repeat(64),url:'/a'};
  for(let i=0;i<10;i++)await writeFile(path.join(root,'experiments',`method1-${String(i).padStart(2,'0')}.json`),JSON.stringify({id:`run-${i}`,experimentId:'one',method:1,objectiveVersion:2,source:{sha256:'source'},shaderSha256:'shader',baseline:{components:{weighted_total:1},image},best:{components:{weighted_total:.5},image,recipe},candidates:[{id:1,components:{weighted_total:.5},image,recipe}]}));
  const store=createExperimentStore({root,catalogFile,now:()=>clock}),data=await store.collect();
  assert.equal(data.experiments.length,10);assert.equal(data.experiments[0].candidates,undefined);
  assert.equal(store.stats().recipeBodiesRetained,0);assert.ok(data.recipes.get(sha).trail);
  assert.deepEqual(JSON.parse(await store.readRecipe(data.recipes.get(sha),sha)),recipe);
  const page=await worldExperimentPage(data,new URLSearchParams('page=1'));
  assert.equal(page.pagination.total,10);assert.equal(page.experiment.candidates.length,10);
  assert.equal(store.stats().loadedRuns,8);assert.equal(await worldExperimentPage(data,new URLSearchParams('page=1')),page,'unchanged pages are reused');
  clock+=1500;assert.equal(await store.collect(),data,'unchanged archive reuses its index');
  const file=path.join(root,'experiments','method1-09.json');const changed={...await data.readRun('run-9'),id:'run-9',candidates:[{id:1,components:{weighted_total:.4},image,recipe},{id:2,components:{weighted_total:.3},image,recipe}]};
  await writeFile(file+'.tmp',JSON.stringify(changed));await rename(file+'.tmp',file);clock+=1500;
  const next=await store.collect();assert.notEqual(next,data);assert.equal((await worldExperimentPage(next,new URLSearchParams('page=latest'))).pagination.total,11);
 }finally{await rm(root,{recursive:true,force:true});}
});
