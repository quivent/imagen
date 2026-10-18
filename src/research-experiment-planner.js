import {researchPipelines} from './research-pipelines.js';
const fields=[['title','Experiment name',160],['hypothesis','What do we expect to learn?',2000],['change','What changes?',2000],['controls','What stays fixed?',2000],['success','What would count as success?',2000]];
export function mountExperimentPlanner(root,{save,message,choosePipeline}){
 let state={plans:[]},catalog=null,loading=null,disposed=false,draft=null,saving=false,loadError=false;
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 const button=(text,action)=>{const n=el('button',text);n.type='button';n.onclick=action;return n;};
 async function load(){
  if(catalog||loading||disposed)return;
  loadError=false;
  loading=(async()=>{try{const response=await fetch('/worlds/experiments.json',{cache:'no-cache'});if(!response.ok)throw new Error();const data=await response.json();if(!Array.isArray(data.experiments))throw new Error();catalog=data;}catch{loadError=true;}finally{loading=null;if(!disposed)render();}})();
 }
 function download(plan){const url=URL.createObjectURL(new Blob([JSON.stringify(plan,null,2)+'\n'],{type:'application/json'}));const a=el('a');a.href=url;a.download=plan.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function render(){
  if(disposed)return;
  const heading=el('div',null,'pipeline-heading');heading.append(el('h2','From a possibility to a test'),el('p','Choose one change. Keep a reference. Decide what evidence would change our minds.'));
  root.replaceChildren(heading);
  if(draft){
   const recipe=researchPipelines.find(p=>p.id===draft.pipelineId),form=el('form');form.className='experiment-design';
   form.append(el('h3',recipe.name),el('p','A saved plan records intent. It has no results until evidence is attached.'));
   const source=el('fieldset');source.append(el('legend','Source and comparison baseline'));
   if(catalog){for(const item of catalog.experiments){const choice=button(item.title,()=>{draft.sourceExperiment=item.id;render();});choice.setAttribute('aria-pressed',String(draft.sourceExperiment===item.id));choice.disabled=saving;source.append(choice);}
    const selected=catalog.experiments.find(item=>item.id===draft.sourceExperiment);
    if(selected){const p=el('p',`${selected.source.width} × ${selected.source.height} · ${selected.source.profile}`);const hash=el('code',selected.source.sha256);p.append(el('br'),hash);source.append(p);}
   }else{source.append(el('p',loadError?'Source catalog unavailable. Retry to choose a registered source.':'Loading registered sources…'));if(loadError)source.append(button('Retry',()=>{void load();}));}
   form.append(source);
   for(const [key,label,max] of fields){const wrapper=el('label',label),input=el(key==='title'?'input':'textarea');input.name=key;input.required=true;input.maxLength=max;input.value=draft[key];input.disabled=saving;if(key!=='title')input.rows=2;input.oninput=()=>{draft[key]=input.value;};wrapper.append(input);form.append(wrapper);}
   const actions=el('div',null,'pipeline-actions'),submit=el('button',saving?'Saving…':'Save experiment plan');submit.type='submit';submit.disabled=saving||!draft.sourceExperiment;const cancel=button('Discard draft',()=>{draft=null;render();});cancel.disabled=saving;actions.append(submit,cancel);form.append(actions);
   form.onsubmit=async event=>{event.preventDefault();if(saving)return;saving=true;const pending={type:'experiment',...draft};render();try{state=await save(pending);draft=null;message('Experiment plan saved with its source and pipeline snapshot. No inference started.');}catch(error){message(error.message);}finally{saving=false;render();}};
   root.append(form);
  }else root.append(button('Choose a pipeline',choosePipeline));
  const list=el('div',null,'experiment-plan-list');list.setAttribute('aria-label','Saved experiment plans');
  if(!state.plans?.length)list.append(el('p','No saved plans yet. Start with a pipeline, then define a controlled test.'));
  for(const plan of [...(state.plans||[])].reverse()){
   const card=el('article',null,'research-card');card.dataset.plan=plan.id;
   card.append(el('span','Planned · evidence not yet recorded','research-kind'),el('h2',plan.title),el('p',plan.hypothesis));
   const meta=el('p',plan.pipeline.name+' · '+plan.baseline.title);card.append(meta);
   const details=el('details');details.append(el('summary','Design and provenance'));const dl=el('dl');for(const [label,value] of [['Change',plan.change],['Hold fixed',plan.controls],['Success criterion',plan.success],['Source SHA-256',plan.source.sha256],['Representation',plan.pipeline.contract.output],['Missing work',plan.pipeline.recipe.gap]])dl.append(el('dt',label),el('dd',value));details.append(dl);card.append(details,button('Export experiment',()=>download(plan)));list.append(card);
  }
  root.append(list);
 }
 return {render(value){state=value;render();if(draft)void load();},design(id){const recipe=researchPipelines.find(p=>p.id===id);if(!recipe)return;draft={pipelineId:id,sourceExperiment:'',title:recipe.name+' · first test',hypothesis:recipe.question,change:recipe.trial,controls:'Same source, source-view camera, exploration path, evaluation resolution and rendering budget.',success:'Improve the target quality measure while retaining the source match, reliable return and frame-time budget. Record failures and missing regions separately.'};render();void load();},destroy(){disposed=true;draft=null;}};
}
