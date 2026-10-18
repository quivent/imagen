import test from 'node:test';
import assert from 'node:assert/strict';
import {recordWorkspace,recordStudyId,belongsToStudy,scopeAgentView} from '../src/workspace-scope.js';
import {agentView,taskAssignment} from '../src/agent-state.js';
test('workspace membership follows explicit assignments without guessing from prose',()=>{
 assert.equal(recordWorkspace({task:'Workbench something'}),'production');
 const snapshot={agents:{ok:true,live:true,observedAt:new Date().toISOString(),coordinator:'running',coordinatorWorkspace:'workbench',agents:[{id:'/root/site',status:'running',workspace:'production'},{id:'/root/fitter',status:'running',workspace:'workbench',currentTaskId:'WB-test'},{id:'/root/legacy',status:'done'}]}};
 const view=agentView(snapshot),production=scopeAgentView(view,'production'),workbench=scopeAgentView(view,'workbench');
 assert.deepEqual(production.agents.map(a=>a.id),['/root/site','/root/legacy']);assert.equal(production.coordinator,null);
 assert.deepEqual(workbench.agents.map(a=>a.id),['/root/fitter']);assert.equal(workbench.coordinator.id,'/root');
 assert.equal(workbench.running,1);assert.equal(production.available,1);assert.equal(view.agents.length,3);
 assert.equal(taskAssignment(production,{id:'not-assigned',status:'working'}),null);
 assert.equal(taskAssignment(workbench,{id:'WB-test',status:'working'}).id,'/root/fitter');
});
test('studies share rendering helpers without sharing records or assignments',()=>{
 const records=[{id:'legacy'},{id:'old',studyId:'production'},{id:'adhc',studyId:'flux1-prompt-clarity'},{id:'glsl',workspace:'workbench'},{id:'wb-adhc',workspace:'workbench',studyId:'flux1-prompt-clarity'},{id:'future',studyId:'unknown'}];
 const ids=(workspace,study)=>records.filter(row=>belongsToStudy(row,workspace,study)).map(row=>row.id);
 assert.deepEqual(ids('production','production'),['legacy','old']);
 assert.deepEqual(ids('production','flux1-prompt-clarity'),['adhc']);
 assert.deepEqual(ids('workbench','glsl-worlds'),['glsl']);
 assert.deepEqual(ids('workbench','flux1-prompt-clarity'),['wb-adhc']);
 assert.equal(recordStudyId({title:'ADHC precision production'}),'production');
 const view={agents:records.map(row=>({...row,status:'running'})),coordinator:null};
 assert.deepEqual(scopeAgentView(view,'production','flux1-prompt-clarity').agents.map(row=>row.id),['adhc']);
 assert.equal(scopeAgentView(view,'workbench','glsl-worlds').running,1);
});
