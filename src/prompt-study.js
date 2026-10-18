import './prompt-study.css';
import './production-study-controls.css';
import {mountProductionStudyControls} from './production-study-controls.js';
import {workflowPanel,reviewPairs} from './prompt-study-workflow.js';
export function mountPromptStudy({root,isActive=()=>true,view='experiment'}){
 let active=false,disposed=false,fetching=false,data=null,saving=false,errorMessage='';
 const drafts={};let lastRendered='';
 let editing=false,page=1,loadController=null,actionController=null,productionUI=null;
 const stopRequests=()=>{loadController?.abort();actionController?.abort();};
 let focusTimer=null;const focusIn=()=>{editing=['TEXTAREA','INPUT'].includes(document.activeElement?.tagName);};const focusOut=()=>{clearTimeout(focusTimer);focusTimer=setTimeout(()=>{editing=root.contains(document.activeElement)&&['TEXTAREA','INPUT'].includes(document.activeElement?.tagName);},0);};root.addEventListener('focusin',focusIn);root.addEventListener('focusout',focusOut);
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 function productionRender(){
  const study=data.productionStudy,workflow=data.workflow||{study:study.id||'ADHC-001',continuous:true,stage:'paused',enabled:false,pairs:[],completedPairs:0,remainingPairs:study.sceneCount||150},daemon=data.daemon||workflow;
  if(!productionUI){
   const box=el('div',null,'prompt-study prompt-study-production'),header=el('header'),title=el('h1',view==='compare'?'Compare':view==='controls'?'Controls':'Production → Precision');header.append(title);header.hidden=view==='stream';
   const progress=el('p',null,'prompt-live-progress'),lanes=el('div',null,'prompt-live-lanes'),controls=el('div'),prompts=el('div'),pairs=el('div'),pagination=el('nav',null,'prompt-pagination'),status=el('p',null,'prompt-summary');status.setAttribute('role','status');pagination.setAttribute('aria-label','Completed pair pages');
   const newer=el('button','Newer'),latest=el('button','Latest'),older=el('button','Older'),label=el('span');for(const button of [newer,latest,older])button.type='button';
   newer.onclick=()=>goPage(page-1);latest.onclick=()=>goPage(1);older.onclick=()=>goPage(page+1);pagination.append(newer,latest,older,label);
   box.append(header,progress,lanes,controls,prompts,pairs,pagination,status);productionUI={box,progress,lanes,laneRows:new Map(),controls,prompts,pairs,pagination,status,newer,latest,older,label,promptSignature:null};
  }
  const ui=productionUI,scene=study.currentScene||study.firstScene||{},flow=data.productionFlow||{},settings=study.settings||{};
  const lanes=daemon.lanes||workflow.lanes||[],currentScenes=Array.isArray(study.currentScenes)?study.currentScenes:Object.values(study.currentScenes||{});
  const laneScenes=lanes.map((lane,index)=>{
   const record=currentScenes.find(row=>row.laneIndex===lane.laneIndex||(Number.isInteger(lane.gpuIndex)&&row.gpuIndex===lane.gpuIndex))||currentScenes[index];
   return {lane,scene:record?.scene||record||(lanes.length===1?scene:{name:lane.sceneId||'Preparing scene'})};
  });
  const live=daemon.runnerAlive&&daemon.enabled;
  ui.progress.textContent=(live?'Live':daemon.enabled?'Runner offline':'Paused')+' · '+(lanes.length>1?lanes.length+' GPU lanes':scene.name||daemon.sceneId||'Preparing scene')+' · '+(workflow.completedPairs||0)+' pairs · pass '+(daemon.pass||workflow.pass||1)+' · '+(workflow.remainingPairs??0)+' remaining';
  const laneLabels={running:'Generating',checking:'Preparing','waiting-worker':'Waiting for worker','waiting-draft':'Waiting for draft','needs-attention':'Needs attention',paused:'Paused'};
  const keys=new Set();for(const {lane,scene:current} of laneScenes){const key=lane.laneIndex;keys.add(key);let row=ui.laneRows.get(key);if(!row){row=el('p',null,'prompt-summary');ui.laneRows.set(key,row);ui.lanes.append(row);}
   row.textContent=(Number.isInteger(lane.gpuIndex)?'GPU '+lane.gpuIndex:'Lane '+lane.laneIndex)+' · '+(current.name||lane.sceneId||'Preparing scene')+' · '+(lane.enabled&&!lane.runnerAlive?'Runner offline':laneLabels[lane.stage]||lane.stage||'Unknown');
  }
  for(const [key,row] of ui.laneRows)if(!keys.has(key)){row.remove();ui.laneRows.delete(key);}ui.lanes.hidden=!lanes.length;
  ui.progress.hidden=view==='controls'||view==='experiment';
  if(view==='controls'){
   ui.lanes.hidden=true;ui.prompts.hidden=true;
   if(!ui.studyControls)ui.studyControls=mountProductionStudyControls({root:ui.controls,post,document});
   ui.studyControls.update({study,workflow,daemon,disabled:saving});
  }else if(view==='experiment'){
   const panel=workflowPanel({workflow,post,el,disabled:saving,drafts,compact:view!=='controls'});if(ui.controls.firstChild!==panel)ui.controls.replaceChildren(panel);
   const promptScenes=laneScenes.length?laneScenes:[{lane:{seed:daemon.seed},scene}];
   const signature=JSON.stringify([promptScenes.map(({lane,scene:current})=>[lane.gpuIndex,lane.laneIndex,lane.seed,current.name,current.prompt,current.precisionPrompt]),settings]);
   if(ui.promptSignature!==signature){
    ui.promptSignature=signature;const source=el('section',null,'prompt-current-scene');source.append(el('h2',promptScenes.length>1?'Current scenes':scene.name||'Current scene'));
    const seeds=[...new Set(promptScenes.map(row=>row.lane.seed).filter(Number.isFinite))],seedLabel=seeds.length>1?'Per lane':seeds[0]??daemon.seed??workflow.seed??'—';
    const rows=el('dl',null,'prompt-settings');for(const [label,value] of [['Output',Number.isFinite(settings.width)&&Number.isFinite(settings.height)?settings.width+' × '+settings.height:'—'],['Steps',settings.steps??'—'],['Guidance',settings.guidance_scale??'—'],['Conditioning limit',settings.max_sequence_length??'—']])rows.append(el('dt',label),el('dd',String(value)));source.append(rows);
    for(const {lane,scene:current} of promptScenes){const group=el('section');if(promptScenes.length>1)group.append(el('h3',(Number.isInteger(lane.gpuIndex)?'GPU '+lane.gpuIndex+' · ':'')+(current.name||'Preparing scene')));const grid=el('div',null,'prompt-arms');for(const [label,text] of [['Production prompt',current.prompt],['Precision prompt',current.precisionPrompt]]){const details=el('details');details.append(el('summary',label),el('p',text||'Preparing the next saved draft.'));grid.append(details);}group.append(grid);source.append(group);}ui.prompts.replaceChildren(source);
   }
  }
  const showPairs=['compare','stream','experiment'].includes(view);ui.pairs.hidden=!showPairs;ui.pagination.hidden=!showPairs;
  if(showPairs){const section=reviewPairs({workflow,post,el,disabled:saving,stream:view==='stream',drafts});if(ui.pairs.firstChild!==section)ui.pairs.replaceChildren(section);}
  page=flow.page||page;const pages=flow.pages||1;ui.label.textContent='Page '+page+' of '+pages+' · '+(flow.totalPairs??workflow.completedPairs??0)+' pairs';ui.newer.disabled=saving||page<=1;ui.latest.disabled=saving||page===1;ui.older.disabled=saving||page>=pages;
  ui.status.textContent=errorMessage;if(root.firstChild!==ui.box)root.replaceChildren(ui.box);
 }
 function goPage(value){const pages=data?.productionFlow?.pages||1;page=Math.max(1,Math.min(pages,value));void load(true);}
 function render(){
  if(disposed)return;lastRendered=JSON.stringify([data,saving,errorMessage]);
  if(data?.productionStudy){productionRender();return;}
  if(!data){const loading=el('p',errorMessage||'Loading study observations…','prompt-summary');loading.setAttribute('role','status');root.replaceChildren(loading);return;}
  const box=el('div',null,'prompt-study'),header=el('header');header.append(el('p','STUDY · FPC-001','eyebrow'),el('h1',view==='compare'?'Compare':view==='stream'?'Stream':view==='controls'?'Controls':'FLUX.1 · Prompt Clarity'),el('p','Original prompt ↔ precise art direction · same FLUX.1 dev model'));
  box.append(header);
  if(view==='compare'||view==='stream'){
   if(data?.workflow)box.append(workflowPanel({workflow:data.workflow,post,el,disabled:saving,drafts,compact:view!=='controls'}),reviewPairs({workflow:data.workflow,post,el,disabled:saving,stream:view==='stream',drafts}));
   else box.append(el('p','Save a run package in Controls to begin. No study images have been requested.'));
  }else{
   box.append(el('p',data?'512 × 512 · 28 steps · guidance 3.5 · 6 planned images':'Loading the frozen study design…','prompt-summary'));
   if(data){
    const p=data.preview;if(data.workflow)box.append(workflowPanel({workflow:data.workflow,post,el,disabled:saving,drafts,compact:view!=='controls'}));const grid=el('div',null,'prompt-arms');
    for(const arm of ['A','B']){const card=el('section');card.append(el('h2',arm==='A'?'A · Original':'B · Precise art direction'),el('p',arm==='A'?'Exact historical prompt, unchanged.':'Draft caption · frozen before generation.'));
     const details=el('details');details.append(el('summary','Read the prompt'),el('p',p.prompts[arm]),el('code','SHA-256 '+p.promptHashes[arm]));card.append(details);grid.append(card);}box.append(grid);
    const rows=el('dl',null,'prompt-settings');for(const [label,value] of [['Model',p.model],['Output',p.settings.width+' × '+p.settings.height],['Steps',p.settings.steps],['Guidance',p.settings.guidance_scale],['Conditioning limit',p.settings.max_sequence_length+' tokens'],['Precision',p.precisionPolicy]])rows.append(el('dt',label),el('dd',String(value)));box.append(rows);
    box.append(el('p',p.knownDiscrepancies.join(' '),'prompt-caveat'));
    const actions=el('div',null,'prompt-actions'),prepare=el('button',saving?'Saving…':'Save run package');prepare.type='button';prepare.disabled=saving;prepare.onclick=()=>void post({action:'prepare'});actions.append(prepare,el('span','Saves JSON only · no jobs queued or images generated.'));box.append(actions);
    box.append(el('p',data.status.runs.length+' saved run '+(data.status.runs.length===1?'package':'packages')+' · current package '+p.id.slice(0,12),'prompt-summary'));
   }
   const research=el('a','Read specification & protocol');research.href='/research?document=prompt-clarity-specification';box.append(research);
  }
  if(data?.workflow?.pairs.length&&view==='experiment')box.append(reviewPairs({workflow:data.workflow,post,el,disabled:saving,drafts}));
  const status=el('p',errorMessage,'prompt-summary');status.setAttribute('role','status');box.append(status);root.replaceChildren(box);
 }
 async function post(value){
  if(saving||disposed||(!data?.workflow&&value.action!=='prepare'))return;
  saving=true;errorMessage='';render();const controller=new AbortController();actionController=controller;const timeout=setTimeout(()=>controller.abort(),20000);
  try{
   const response=await fetch('/api/prompt-study',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({package:data?.workflow?.package,...value}),signal:controller.signal});
   if(!response.ok)throw new Error();await response.json();if(disposed)return;
   if(value.action==='guidance'){delete drafts.guidance;drafts.guidanceDirty=false;delete drafts.guidanceSource;}
   if(value.action==='review'&&drafts.reviews){delete drafts.reviews[value.pair];if(value.package)delete drafts.reviews[value.package+':'+value.pair.replace('-','')];}
   await load(true);
  }catch{if(!disposed)errorMessage='The action could not be confirmed. Saved requests are retained; no automatic replay.';}
  finally{clearTimeout(timeout);if(actionController===controller)actionController=null;saving=false;if(!disposed&&active)render();}
 }
 async function load(force=false){
  if(disposed||!active||document.hidden||!isActive())return;
  if(loadController){if(!force)return;loadController.abort();}
  const controller=new AbortController();loadController=controller;fetching=true;const timeout=setTimeout(()=>controller.abort(),20000);
  try{
   const response=await fetch('/api/prompt-study?page='+page,{cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error();const value=await response.json();
   if(disposed||!active||controller.signal.aborted||loadController!==controller)return;data=value;
   if(!editing&&JSON.stringify([data,saving,errorMessage])!==lastRendered)render();
  }catch{if(!disposed&&active&&!controller.signal.aborted){errorMessage='Study observations are unavailable. Existing pairs stay in place.';if(!editing)render();}}
  finally{clearTimeout(timeout);if(loadController===controller){loadController=null;fetching=false;}}
 }
 const visibility=()=>{if(document.hidden)stopRequests();else if(active&&!editing)void load();};document.addEventListener('visibilitychange',visibility);
 const poll=setInterval(()=>{if(active&&!document.hidden&&!editing)void load();},3000);
 render();return {setActive(value){active=value;if(!value)stopRequests();else if(isActive()){if(!editing)render();void load();}},destroy(){disposed=true;active=false;stopRequests();clearInterval(poll);clearTimeout(focusTimer);document.removeEventListener('visibilitychange',visibility);root.removeEventListener('focusin',focusIn);root.removeEventListener('focusout',focusOut);drafts.pairCards?.clear();}};
}
