import './research.css';
import {mountExperimentPlanner} from './research-experiment-planner.js';
import {mountPipelinePicker} from './research-pipeline-picker.js';
import {researchCatalog} from './research-catalog.js';
import {researchDocuments} from './research-documents.js';
import {researchDocumentBody} from './research-document-reader.js';
export function mountResearch({root,isActive=()=>true}){
 const $=id=>root.querySelector('#research-'+id);
 let stateVersion=0;
 let active=isActive(),disposed=false,loaded=false,loading=false,family='All',shortlist=false,state={notes:{},ideas:[]};
 let documentId=new URL(location.href).searchParams.get('document');
 let section=researchDocuments.find(item=>item.id===documentId)?.section||'Methods';
 const drafts=new Map();
 const element=(tag,text,className)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(className)node.className=className;return node;};
 const entries=()=>[...researchCatalog,...state.ideas];
 const message=text=>{$('status').textContent=text;};
 function updateDocumentURL(){const url=new URL(location.href);if(documentId)url.searchParams.set('document',documentId);else url.searchParams.delete('document');history.replaceState(null,'',url);}
 function openDocument(id){const record=researchDocuments.find(item=>item.id===id);if(!record)return;documentId=id;section=record.section;$('idea-form').hidden=true;updateDocumentURL();render();}
 function documents(){
  const record=researchDocuments.find(item=>item.id===documentId);
  $('documents').hidden=Boolean(record);$('reader').hidden=!record;
  if(record){
   if($('document-content').dataset.id!==record.id){$('document-content').replaceChildren(researchDocumentBody(record.content));$('document-content').dataset.id=record.id;}
   const related=researchDocuments.find(item=>item.id===record.related);$('related').hidden=!related;
   if(related){$('related').textContent=related.section==='Studies'?'Open study plan':'Read the explanation';$('related').onclick=()=>openDocument(related.id);}
   $('back').textContent='Back to '+section.toLowerCase();return;
  }
  $('documents').replaceChildren(...researchDocuments.filter(item=>item.section===section).map(item=>{
   const card=element('article',null,'research-card');card.append(element('span',item.kind+' · '+item.status,'research-kind'),element('h2',item.title),element('p',item.description));
   const open=element('button',section==='Studies'?'Read study plan':'Read document');open.type='button';open.onclick=()=>openDocument(item.id);card.append(open);return card;
  }));
 }
 async function change(value){
  stateVersion++;
  const response=await fetch('/api/research-notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
  if(!response.ok)throw new Error('Could not save this research note.');
  state=await response.json();return state;
 }
 const planner=mountExperimentPlanner($('plans'),{save:change,message,choosePipeline:()=>{section='Pipelines';render();}});
 const pipelines=mountPipelinePicker($('pipelines'),{save:change,message,design:id=>{section='Plans';planner.design(id);render();}});
 function render(){
  if(disposed||!active)return;
  for(const button of $('sections').children)button.setAttribute('aria-pressed',String(button.dataset.section===section));
  const methods=section==='Methods';$('method-tools').hidden=!methods;$('families').hidden=!methods;$('grid').hidden=!methods;
  root.querySelector('.research-protocol').hidden=!methods;
  $('plans').hidden=section!=='Plans';
  $('pipelines').hidden=section!=='Pipelines';
  if(section==='Plans'){$('documents').hidden=true;$('reader').hidden=true;planner.render(state);return;}
  if(section==='Pipelines'){$('documents').hidden=true;$('reader').hidden=true;pipelines.render(state);return;}
  if(!methods){documents();return;}$('documents').hidden=true;$('reader').hidden=true;
  const families=['All',...new Set(entries().map(item=>item.family))];
  $('families').replaceChildren(...families.map(name=>{const button=element('button',name);button.type='button';button.setAttribute('aria-pressed',String(name===family));button.onclick=()=>{family=name;render();};return button;}));
  const query=$('search').value.toLowerCase().trim();
  const filtered=entries().filter(item=>(family==='All'||item.family===family)&&(!shortlist||state.notes[item.id]?.shortlisted)&&(!query||[item.name,item.family,item.kind,item.description,item.glsl].join(' ').toLowerCase().includes(query)));
  $('count').textContent=filtered.length+' of '+entries().length+' approaches';
  $('grid').replaceChildren(...filtered.map(item=>{
   const card=element('article',null,'research-card');card.append(element('span',item.family+' · '+item.kind,'research-kind'),element('h2',item.name),element('p',item.description));
   const details=element('details'),summary=element('summary','Plan a test'),list=element('dl');
   for(const [label,key] of [['Inputs','inputs'],['Output','output'],['Route to GLSL','glsl'],['Tradeoff','tradeoff'],['First experiment','trial']])if(item[key])list.append(element('dt',label),element('dd',item[key]));
   details.append(summary,list);
   const area=element('textarea');area.rows=3;area.maxLength=8000;area.placeholder='Hypothesis, questions, evidence, next test…';area.setAttribute('aria-label','Notes for '+item.name);area.value=drafts.get(item.id)??state.notes[item.id]?.note??'';area.oninput=()=>drafts.set(item.id,area.value);
   const save=element('button','Save note'),noteStatus=element('span','','note-status');save.type='button';
   save.onclick=async()=>{save.disabled=true;try{await change({type:'note',id:item.id,note:area.value,shortlisted:Boolean(state.notes[item.id]?.shortlisted)});drafts.delete(item.id);noteStatus.textContent='Saved on this workstation';}catch(error){noteStatus.textContent=error.message;}finally{save.disabled=false;}};
   details.append(area,save,noteStatus);card.append(details);
   const actions=element('div',null,'research-actions'),pin=element('button','Shortlist');pin.type='button';pin.setAttribute('aria-pressed',String(Boolean(state.notes[item.id]?.shortlisted)));
   pin.onclick=async()=>{pin.disabled=true;try{await change({type:'note',id:item.id,note:drafts.get(item.id)??state.notes[item.id]?.note??'',shortlisted:!state.notes[item.id]?.shortlisted});pin.setAttribute('aria-pressed',String(Boolean(state.notes[item.id]?.shortlisted)));if(shortlist)render();}catch(error){message(error.message);}finally{pin.disabled=false;}};actions.append(pin);
   if(item.url){const source=element('button','Copy source link');source.type='button';source.title=item.url;source.onclick=async()=>{try{await navigator.clipboard.writeText(new URL(item.url,location.origin).href);source.textContent='Link copied';}catch{message(item.url);}};actions.append(source);}
   card.append(actions);return card;
  }));
 }
 async function load(){
  if(loaded||loading||!active||disposed)return;loading=true;const version=stateVersion;
  try{const response=await fetch('/api/research-notes',{cache:'no-store'});if(!response.ok)throw new Error();const fetched=await response.json();if(version===stateVersion)state=fetched;loaded=true;message('Notes and ideas are saved on this workstation. Model and pipeline candidates have not been benchmarked here.');}
  catch{message('Showing the research catalog; the local notebook is unavailable.');}
  finally{loading=false;render();}
 }
 $('search').oninput=render;
 for(const button of $('sections').children)button.onclick=()=>{section=button.dataset.section;documentId=null;$('idea-form').hidden=true;updateDocumentURL();render();};
 $('back').onclick=()=>{documentId=null;updateDocumentURL();render();};
 $('shortlist').onclick=()=>{shortlist=!shortlist;$('shortlist').setAttribute('aria-pressed',String(shortlist));render();};
 $('add').onclick=()=>{const open=$('idea-form').hidden;$('idea-form').hidden=!open;$('add').setAttribute('aria-expanded',String(open));if(open)$('idea-form').elements.title.focus();};
 $('idea-form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;try{await change({type:'idea',title:form.elements.title.value,description:form.elements.description.value});form.reset();form.hidden=true;$('add').setAttribute('aria-expanded','false');family='Open ideas';shortlist=false;$('shortlist').setAttribute('aria-pressed','false');$('search').value='';render();message('Research idea saved.');}catch(error){message(error.message);}finally{button.disabled=false;}};
 render();void load();
 return {setActive(value){active=value;if(active){render();void load();}},destroy(){disposed=true;active=false;drafts.clear();planner.destroy();}};
}
