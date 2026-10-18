import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {belongsToStudy,scopeAgentView} from '../src/workspace-scope.js';

// Run the actual panel controller with numerical DOM stubs; no browser or images.
const source=(await readFile(new URL('../src/workbench-tasks.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('export function mountWorkbenchTasks','function mountWorkbenchTasks');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('changing Workbench study clears old rows, scopes writes and ignores late responses',async()=>{
 let study='glsl-worlds',listener,hiddenListener;const requests=[],renders=[];
 const nodes=new Map(['status','updated','list'].map(key=>[key,{textContent:'',append(){},querySelectorAll(){return [];}}]));
 const button={disabled:false},form={elements:{title:{value:'New precision task'},detail:{value:''}},querySelector:()=>button,reset(){}};
 const root={querySelector(selector){return selector==='form'?form:nodes.get(selector.match(/"(.*?)"/)[1]);}};
 const document={hidden:false,createElement:()=>({}),addEventListener(event,callback){hiddenListener=callback;},removeEventListener(){}};
 const fetch=(url,options)=>new Promise(resolve=>requests.push({url,options,resolve:data=>resolve({ok:true,json:async()=>data})}));
 const mount=new Function('renderTaskBoard','taskStates','agentView','belongsToStudy','scopeAgentView','selectedStudy','observeStudy','studioLive','document','fetch',source+'\nreturn mountWorkbenchTasks;')(
  (_root,rows)=>renders.push(rows.map(row=>row.id)),{},()=>({agents:[],coordinator:null}),belongsToStudy,scopeAgentView,()=>study,callback=>{listener=callback;return()=>{listener=null;};},{subscribe:()=>()=>{}},document,fetch);
 const panel=mount({root});
 try{
  panel.setActive(true);assert.equal(requests[0].url,'/api/workbench-tasks?study=glsl-worlds');
  requests[0].resolve({tasks:[{id:'glsl',workspace:'workbench',studyId:'glsl-worlds'}]});await flush();assert.deepEqual(renders.at(-1),['glsl']);
  study='flux1-prompt-clarity';listener(study);assert.deepEqual(renders.at(-1),[]);
  assert.equal(requests[1].url,'/api/workbench-tasks?study=flux1-prompt-clarity');
  study='glsl-worlds';listener(study);assert.equal(requests[1].options.signal.aborted,true);
  requests[1].resolve({tasks:[{id:'wrong-study',workspace:'workbench',studyId:'flux1-prompt-clarity'}]});await flush();assert.deepEqual(renders.at(-1),[]);
  requests[2].resolve({tasks:[{id:'glsl',workspace:'workbench',studyId:'glsl-worlds'}]});await flush();
  study='flux1-prompt-clarity';listener(study);
  form.onsubmit({preventDefault(){}});assert.equal(requests[3].options.signal.aborted,true);
  assert.equal(requests[4].options.method,'POST');assert.equal(requests[4].url,'/api/workbench-tasks?study=flux1-prompt-clarity');
  study='glsl-worlds';listener(study);requests[4].resolve({tasks:[{id:'created-adhc',workspace:'workbench',studyId:'flux1-prompt-clarity'}]});await flush();
  assert.deepEqual(renders.at(-1),[]);assert.equal(requests[5].url,'/api/workbench-tasks?study=glsl-worlds');
  document.hidden=true;hiddenListener();assert.equal(requests[5].options.signal.aborted,true);
 }finally{panel.destroy();}
 assert.equal(listener,null);
});

test('Production task refresh switches study immediately even when the task payload is unchanged',async()=>{
 const app=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
 const controller=app.slice(app.indexOf('function renderTasks(rows) {'),app.indexOf('\nfunction setAuthorized(value)'));
 const nodes=new Map(),renders=[];
 const payload={schemaVersion:1,tasks:[{id:'legacy',title:'Legacy',status:'next'},{id:'adhc',title:'ADHC',status:'next',studyId:'flux1-prompt-clarity'},{id:'wb',title:'Workbench',status:'next',workspace:'workbench',studyId:'flux1-prompt-clarity'}]};
 const runtime={agents:[],coordinator:null};
 const create=new Function('renderTaskBoard','belongsToStudy','scopeAgentView','recordWorkspace','agentView','studioLive','$','taskStates','document',`
 let study='production',taskRows=[],tasksLoading=false,tasksSignature='',activeTab='tasks',taskMonitorSnapshot=null,taskRuntimeConnected=false;
 const selectedProductionStudy=()=>study;
 ${controller}
 return {refreshTasks,setStudy(value){study=value;}};
 `);
 const {recordWorkspace}=await import('../src/workspace-scope.js');
 const api=create((_root,rows)=>renders.push(rows.map(row=>row.id)),belongsToStudy,scopeAgentView,recordWorkspace,()=>runtime,{read:async()=>payload},id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);},{next:'Next'},{hidden:false});
 await api.refreshTasks();assert.deepEqual(renders.at(-1),['legacy']);
 api.setStudy('flux1-prompt-clarity');const refresh=api.refreshTasks();assert.deepEqual(renders.at(-1),['adhc']);await refresh;
 api.setStudy('production');await api.refreshTasks();assert.deepEqual(renders.at(-1),['legacy']);
});
