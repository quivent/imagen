import './workbench.css';
import markup from './workbench-fitting-controls.html?raw';
import {mountWorkbenchControls} from './workbench-controls.js';
import {fittingSelection,setFittingSelection,observeFittingSelection} from './workbench-selection.js';
export function mountWorkbenchControlsTab({root,isActive=()=>true}){
 const view=document.createElement('div');view.className='workbench-view workbench-controls-tab';
 const heading=document.createElement('h1');heading.textContent='Controls';
 const intro=document.createElement('p');intro.textContent='GLSL experiments · fitting objectives, parameter search and loop settings.';
 const sources=document.createElement('div'),methods=document.createElement('div');for(const node of [sources,methods])node.className='fitting-selectors';sources.setAttribute('aria-label','Experiment');methods.setAttribute('aria-label','Fitting method');
 const content=document.createElement('div');content.innerHTML=markup.replaceAll('wb-','wbc-');view.append(heading,intro,sources,methods,content);root.append(view);
 const controls=mountWorkbenchControls({root,isActive:()=>false,prefix:'wbc-'});let catalog=[],disposed=false,active=isActive();
 function render(){
  if(disposed)return;
  const selected=fittingSelection(),study=catalog.find(p=>p.id===selected.studyId);
  const button=(label,pressed,click)=>{const node=document.createElement('button');node.type='button';node.textContent=label;node.setAttribute('aria-pressed',String(pressed));node.onclick=click;return node;};
  sources.replaceChildren(...catalog.map(p=>button(p.title,p.id===selected.studyId,()=>setFittingSelection({studyId:p.id,method:p.defaultMethod||1}))));
  methods.replaceChildren(...['Pixel fitting','Contour fitting','Structure search','3D hypotheses','Neural field'].map((name,index)=>button(name,index+1===selected.method,()=>setFittingSelection({method:index+1}))));
  controls.setStudy(study||{id:selected.studyId||'unselected'});controls.setMethod(selected.method);controls.setActive(active&&Boolean(study));
 }
 const stop=observeFittingSelection(render);
 void fetch('/worlds/experiments.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error();return r.json();}).then(data=>{if(disposed)return;catalog=data.experiments;if(!catalog.some(p=>p.id===fittingSelection().studyId))setFittingSelection({studyId:data.defaultExperiment,method:catalog.find(p=>p.id===data.defaultExperiment)?.defaultMethod||1});render();}).catch(()=>{if(!disposed)sources.textContent='Experiment catalog unavailable. Reopen this tab to retry.';});
 render();return {setActive(value){active=value;render();},destroy(){disposed=true;stop();controls.destroy();}};
}
