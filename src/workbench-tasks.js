import {renderTaskBoard,taskStates} from './task-board.js';
import {agentView} from './agent-state.js';
import {belongsToStudy,scopeAgentView} from './workspace-scope.js';
import {selectedStudy,observeStudy} from './study-context.js';
import {studioLive} from './live-store.js';
import './workbench-tasks.css';
export function mountWorkbenchTasks({root,isActive=()=>true}){
 const $=id=>root.querySelector('[data-workbench-tasks="'+id+'"]'),form=root.querySelector('form');
 let version=0,studyId=selectedStudy(),request=null;
 let enabled=false,disposed=false,snapshot=null,connected=false,release=null,poll=null,saving=false,record={tasks:[]};
 const status=text=>{$('status').textContent=text;};
 const endpoint=id=>'/api/workbench-tasks?study='+encodeURIComponent(id);
 function render(){
  if(disposed||!enabled)return;
  const runtime=scopeAgentView(agentView(snapshot,connected),'workbench',studyId);
  const tasks=record.tasks.filter(task=>belongsToStudy(task,'workbench',studyId));
  renderTaskBoard($('list'),tasks,runtime);
  if(!tasks.length){const empty=document.createElement('p');empty.textContent='No tasks recorded for this study yet.';$('list').append(empty);}
  // Status buttons are local records, never worker start/stop commands.
  for(const card of $('list').querySelectorAll('.task-card')){
   const id=card.querySelector('.task-id').textContent,task=tasks.find(t=>t.id===id),actions=document.createElement('div');actions.className='workbench-task-actions';
   for(const [value,label] of Object.entries(taskStates)){const b=document.createElement('button');b.type='button';b.textContent=label;b.disabled=saving;b.setAttribute('aria-pressed',String(task.status===value));b.onclick=()=>void write({type:'status',id,status:value});actions.append(b);}card.append(actions);
  }
  $('updated').textContent=record.updatedAt?'Study record · '+new Date(record.updatedAt).toLocaleString():'';
 }
 function cancelRefresh(){request?.abort();request=null;}
 async function refresh(){
  if(disposed||!enabled||document.hidden||!isActive()||request||saving)return;
  const controller=new AbortController(),observedVersion=version,requestedStudy=studyId;request=controller;
  try{const response=await fetch(endpoint(requestedStudy),{cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error();const data=await response.json();if(observedVersion===version&&requestedStudy===studyId&&!controller.signal.aborted){record=data;render();}}
  catch(error){if(error.name!=='AbortError'&&observedVersion===version)status('Workbench tasks unavailable. Saved records remain on disk.');}
  finally{if(request===controller)request=null;}
 }
 async function write(value){
  if(saving||disposed)return;
  const requestedStudy=studyId;saving=true;version++;cancelRefresh();const observedVersion=version;
  form.querySelector('button').disabled=true;render();
  try{const response=await fetch(endpoint(requestedStudy),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});if(!response.ok)throw new Error();const data=await response.json();if(observedVersion===version&&requestedStudy===studyId){record=data;if(value.type==='create')form.reset();status('Saved to this study’s Workbench record.');}}
  catch{if(observedVersion===version)status('Could not save this task. Your input is retained.');}
  finally{saving=false;form.querySelector('button').disabled=false;render();if(requestedStudy!==studyId)void refresh();}
 }
 form.onsubmit=event=>{event.preventDefault();void write({type:'create',title:form.elements.title.value,detail:form.elements.detail.value});};
 const sync=()=>{const active=enabled&&!document.hidden&&!disposed&&isActive();if(active&&!release){release=studioLive.subscribe('monitor',incoming=>{connected=incoming.available===true;snapshot=incoming.data;render();});poll=setInterval(()=>void refresh(),5000);void refresh();}else if(!active){cancelRefresh();if(release){release();release=null;clearInterval(poll);}}};
 const releaseStudy=observeStudy(id=>{studyId=id;version++;cancelRefresh();record={tasks:[]};status('');render();void refresh();});
 document.addEventListener('visibilitychange',sync);
 return {setActive(value){enabled=value;sync();if(enabled)render();},destroy(){disposed=true;enabled=false;sync();releaseStudy();document.removeEventListener('visibilitychange',sync);}};
}
