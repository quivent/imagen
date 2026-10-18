import test from 'node:test';
import assert from 'node:assert/strict';
import {researchPipelines,pipelinePlan} from '../src/research-pipelines.js';
import {validateResearchChange} from '../server/research-notes.mjs';
test('ten distinct pipeline plans preserve execution gates and evaluation contract',()=>{
 assert.equal(researchPipelines.length,10);
 assert.equal(new Set(researchPipelines.map(p=>p.id)).size,10);
 for(const recipe of researchPipelines){
  const plan=pipelinePlan(recipe.id);
  assert.equal(plan.status,'planned');
  assert.deepEqual(Object.values(plan.execution),[false,false,false,false]);
  assert.ok(recipe.stages.length>=3&&recipe.stages.every(s=>s.name&&s.hardware&&s.output));
  assert.ok(recipe.gap&&recipe.trial&&recipe.model);
  assert.equal(plan.contract.evaluation.length,5);
  assert.equal(validateResearchChange({type:'note',id:'pipeline-'+recipe.id,note:'',shortlisted:true}).shortlisted,true);
  assert.deepEqual(JSON.parse(JSON.stringify(plan)).recipe,recipe);
 }
 assert.throws(()=>pipelinePlan('../not-a-pipeline'));
});
