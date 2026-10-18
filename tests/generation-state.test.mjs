import assert from 'node:assert/strict';
import test from 'node:test';
import { generationIsActive } from '../src/generation-state.js';
import { modelCategory } from '../src/model-categories.js';
test('public Active reflects fresh current work and closes on idle or stale evidence',()=>{
 const now=Date.now(),observation={available:true,data:{generation:{ok:true,observedAt:new Date(now).toISOString(),workers:[{phase:'ready',running:1}]}}};
 assert.equal(generationIsActive(observation,now),true);
 assert.equal(generationIsActive(observation,now+13000),false);
 observation.data.generation.workers[0].running=0;
 assert.equal(generationIsActive(observation,now),false);
 observation.data.generation.workers[0].current='job';
 assert.equal(generationIsActive(observation,now),true);
 observation.available=false;
 assert.equal(generationIsActive(observation,now),false);
});
test('encoders and drafters are classified before their parent model families',()=>{
 for(const [id,category] of [['flux1','generators'],['flux2','generators'],['flux2-nf4','encoders'],['flux2-fp8','encoders'],['gemma','critics'],['pixtral','critics'],['dinov2','features'],['gemma-4-assistant','drafters']])assert.equal(modelCategory({id}),category);
});
