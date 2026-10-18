import {researchPipelines,researchHardware,pipelinePlan} from './research-pipelines.js';
export function mountPipelinePicker(root,{save,message}){
 let selected=researchPipelines[0].id,notes={};
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 function render(){
  const heading=el('div',null,'pipeline-heading');heading.append(el('h2','Choose an experiment pipeline'),el('p','Ten recipes, from source-preserving surfaces to reconstructed worlds. Picking a recipe does not start inference.'));
  const hardware=el('div',null,'pipeline-hardware');for(const item of researchHardware){const card=el('div');card.append(el('strong',item.name),el('p',item.detail));hardware.append(card);}
  const layout=el('div',null,'pipeline-layout'),tree=el('nav',null,'pipeline-tree');tree.setAttribute('aria-label','Pipeline families');
  for(const family of new Set(researchPipelines.map(p=>p.family))){const group=el('section');group.append(el('h3',family));for(const p of researchPipelines.filter(p=>p.family===family)){const button=el('button',p.name);button.type='button';button.setAttribute('aria-pressed',String(selected===p.id));button.onclick=()=>{selected=p.id;render();};group.append(button);}tree.append(group);}
  const recipe=researchPipelines.find(p=>p.id===selected),detail=el('article',null,'research-card pipeline-detail');detail.dataset.pipeline=recipe.id;
  detail.append(el('span',recipe.status,'research-kind'),el('h2',recipe.name),el('p',recipe.question),el('strong',recipe.model));
  const stages=el('ol',null,'pipeline-stages');for(const s of recipe.stages){const row=el('li');row.append(el('strong',s.name),el('span',s.hardware),el('p',s.output));stages.append(row);}detail.append(stages,el('h3','What still needs work'),el('p',recipe.gap),el('h3','First controlled test'),el('p',recipe.trial));
  const actions=el('div',null,'pipeline-actions'),pin=el('button',notes['pipeline-'+recipe.id]?.shortlisted?'Planned ✓':'Add to planned experiments');pin.type='button';pin.setAttribute('aria-pressed',String(Boolean(notes['pipeline-'+recipe.id]?.shortlisted)));
  pin.onclick=async()=>{pin.disabled=true;try{const id='pipeline-'+recipe.id;const state=await save({type:'note',id,note:notes[id]?.note||'',shortlisted:!notes[id]?.shortlisted});notes=state.notes;render();message('Pipeline choice saved on this workstation.');}catch(error){message(error.message);}finally{pin.disabled=false;}};
  const download=el('button','Export pipeline plan');download.type='button';download.onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(pipelinePlan(recipe.id),null,2)+'\n'],{type:'application/json'}));const a=el('a');a.href=url;a.download=recipe.id+'-pipeline.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};actions.append(pin,download);
  if(recipe.source){const copy=el('button','Copy model source');copy.type='button';copy.onclick=async()=>{try{await navigator.clipboard.writeText(recipe.source);message('Model source link copied.');}catch{message(recipe.source);}};actions.append(copy);}
  detail.append(actions);layout.append(tree,detail);root.replaceChildren(heading,hardware,el('p','Hardware layout comes from our deployment configuration; current power state, loaded models and free VRAM have not been checked.','pipeline-hardware-note'),layout);
 }
 return {render(state){notes=state.notes||{};render();}};
}
