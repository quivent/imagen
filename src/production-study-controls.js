import {createControlChoice} from './control-choice.js';
// Editable shared settings apply to the next pair, preserving in-flight parity.
export function mountProductionStudyControls({root,post,document=globalThis.document}){
 const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(cls)node.className=cls;return node;};
 const panel=el('section',null,'production-study-controls');panel.setAttribute('aria-label','Active production study');
 const protocol=el('p',null,'production-study-protocol'),settings=el('section',null,'setting-library'),lanes=el('div',null,'production-study-lanes');
 const header=el('header',null,'production-control-header');header.append(el('span','FLUX.1 dev','production-control-eyebrow'),el('h2','Production parameters'),el('p','One paired comparison. The same parameters for both prompts.'));
 const heading=el('h3','Image & sampling'),choices=el('div',null,'parameter-choices'),apply=el('button','Apply parameters'),reset=el('button','Reset changes'),note=el('p',null,'production-study-status'),dimensions=el('p',null,'production-control-dimensions'),toolbar=el('div',null,'production-control-toolbar');apply.type=reset.type='button';toolbar.append(apply,reset);settings.append(heading,choices,dimensions,toolbar,note);
 let draft=null,saved=null,dirty=false,pending=false;const fields=[];
 const shape=()=>draft.width===draft.height?'Square':draft.width>draft.height?'Landscape':'Portrait';
 const selection=key=>key==='format'?shape():key==='width'?Math.min(draft.width,draft.height):draft[key];
 const refresh=()=>{for(const item of fields)item.field.update(selection(item.key),pending);apply.disabled=pending||!dirty;reset.disabled=pending||!dirty;dimensions.textContent=draft.width+' × '+draft.height+' px · '+(draft.width*draft.height/1e6).toFixed(2)+' MP';};
 for(const [key,label,values,suffix] of [['format','Frame',['Square','Landscape','Portrait'],''],['width','Resolution',[512,768,1024],' px'],['steps','Steps',[16,28,36],''],['guidance_scale','Guidance',[2,3.5,5],'']]){
  const field=createControlChoice({document,key,label,values,suffix,onChoose:value=>{
   if(key==='format'||key==='width'){
    const format=key==='format'?value:shape(),short=key==='width'?value:Math.min(draft.width,draft.height),long=format==='Square'?short:short*1.5;
    draft.width=format==='Portrait'?short:long;draft.height=format==='Landscape'?short:long;
   }else draft[key]=value;
   dirty=JSON.stringify(draft)!==JSON.stringify(saved);refresh();note.textContent='Apply to both conditions from the next pair on each GPU.';
  }});fields.push({key,field});choices.append(field.element);
 }
 reset.onclick=()=>{if(!reset.disabled){draft={...saved};dirty=false;refresh();note.textContent='Unsaved changes cleared.';}};
 apply.onclick=()=>{if(!apply.disabled&&draft)void post({action:'settings',settings:{...draft}});};
 const actions=el('div',null,'production-study-actions'),toggle=el('button'),status=el('p',null,'production-study-status'),problem=el('p',null,'prompt-caveat');toggle.type='button';status.setAttribute('role','status');
 actions.append(toggle,status);panel.append(header,actions,protocol,settings,lanes,problem);root.replaceChildren(panel);
 const rows=new Map();let enabled=false;
 toggle.onclick=()=>{if(!toggle.disabled)void post({action:enabled?'pause':'start'});};
 return {update({study,workflow={},daemon=workflow,disabled=false}){
  const runtime=daemon||workflow,shared=study.settings||{};
  protocol.textContent=(study.id||'ADHC-001')+' · Production → Precision · same FLUX1 model · shared settings · serial conditions per scene';
  const selected={width:shared.width,height:shared.height,steps:shared.steps,guidance_scale:shared.guidance_scale,max_sequence_length:shared.max_sequence_length??512};saved={...selected};
  if(dirty&&JSON.stringify(draft)===JSON.stringify(selected))dirty=false;
  if(!draft||!dirty)draft={...selected};pending=disabled;
  refresh();
  note.textContent=dirty?'Unsaved parameters. Apply to both conditions together.':'Saved parameters apply from the next pair on each GPU. Current pairs finish unchanged.';
  const liveLanes=runtime.lanes?.length?runtime.lanes:workflow.lanes||[];
  const scenes=Array.isArray(study.currentScenes)?study.currentScenes:Object.values(study.currentScenes||{});
  const current=liveLanes.length?liveLanes:[{stage:runtime.stage,enabled:runtime.enabled,runnerAlive:runtime.runnerAlive}];
  const retained=new Set();
  const labels={running:'Generating',checking:'Preparing','waiting-worker':'Waiting for worker','waiting-draft':'Preparing precision prompt','needs-attention':'Needs attention',paused:'Paused',pausing:'Finishing current image',complete:'Preparing next scene'};
  current.forEach((lane,index)=>{
   const key=lane.laneIndex??lane.gpuIndex??index;retained.add(key);
   let row=rows.get(key);if(!row){
    const section=el('section',null,'production-study-lane'),heading=el('h2'),state=el('p'),prompts=el('div',null,'production-study-prompts'),texts=[];
    for(const label of ['Production prompt','Precision prompt']){const details=el('details'),text=el('p');details.append(el('summary',label),text);prompts.append(details);texts.push(text);}
    section.append(heading,state,prompts);row={section,heading,state,texts};rows.set(key,row);
   }
   const record=scenes.find(scene=>(lane.laneIndex!=null&&scene.laneIndex===lane.laneIndex)||(Number.isInteger(lane.gpuIndex)&&scene.gpuIndex===lane.gpuIndex))||scenes[index];
   const scene=record?.scene||record||(current.length===1?study.currentScene:null)||{};
   row.heading.textContent=(Number.isInteger(lane.gpuIndex)?'GPU '+lane.gpuIndex+' · ':'')+(scene.name||lane.sceneId||'Preparing scene');
   row.state.textContent=lane.enabled&&!lane.runnerAlive?'Runner offline':labels[lane.stage]||lane.stage||'Status unavailable';
   row.texts[0].textContent=scene.prompt||'Production prompt unavailable.';
   row.texts[1].textContent=scene.precisionPrompt||'Preparing the saved precision prompt.';
   if(lanes.children[index]!==row.section)lanes.insertBefore(row.section,lanes.children[index]||null);
  });
  for(const [key,row] of rows)if(!retained.has(key)){row.section.remove();rows.delete(key);}
  enabled=liveLanes.length?liveLanes.some(lane=>lane.enabled):Boolean(runtime.enabled??workflow.enabled);toggle.textContent=enabled?'Pause generation':'Resume generation';toggle.disabled=disabled;
  status.textContent=(enabled?'Generation enabled':'Generation paused')+' · '+(workflow.completedPairs??0)+' completed pairs · pass '+(runtime.pass??workflow.pass??1);
  problem.textContent=runtime.problem||workflow.problem||'';problem.hidden=!problem.textContent;
 }};
}
