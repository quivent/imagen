import { readWorkbenchRoute, workbenchURL } from './workbench-route.js';
export function mountWorkbenchResults({root,isActive=()=>true,onMethodChange=()=>{},onStudyChange=()=>{}}){
const $=id=>root.querySelector('#iter-'+id);
let active=isActive(),disposed=false,fetching=false;
const route=readWorkbenchRoute(location.href);
let records=[],selected=route.legacyRun,signature='';
let studies=[],selectedStudy=route.studyId;
const methods=['Pixel fitting','Contour fitting','Structure search','3D hypotheses','Neural field'];
let selectedMethod=route.method;
if(selectedMethod<1||selectedMethod>5)selectedMethod=1;
let currentPage=route.page,pageInfo={page:1,totalPages:1,total:0,pageSize:20},requestVersion=0;
const legacyRequested=selected;
const pageCache=new Map();
const score=value=>Number.isFinite(value)?value.toFixed(6):'Pending';
function metricDetails(components){
 const panel=document.createElement('div');panel.className='metric-details';
 if(!components)return panel;
 function group(title,entries,className=''){
  const section=document.createElement('section');section.className='metric-group '+className;
  const heading=document.createElement('h3');heading.textContent=title+' ↓';heading.title='Difference from source · lower is better';heading.setAttribute('aria-label',title+' — lower is better');
  const list=document.createElement('dl');
  for(const [label,key] of entries){const row=document.createElement('div'),name=document.createElement('dt'),value=document.createElement('dd');name.textContent=label;value.textContent=key==='pixel_mismatch_10pct'?(components[key]*100).toFixed(6)+'%':score(components[key]);row.append(name,value);list.append(row);}
  section.append(heading,list);panel.append(section);
 }
 if('pixel_mismatch_10pct' in components){
  group('Pixels',[['Outside 10% tolerance','pixel_mismatch_10pct'],['RGB RMS','full_rgb_rms']]);
  group('Structure delta',[['Local structure','local_structure_delta']]);
 }else{
 group('RGB delta',[['Coarse','coarse_rgb_l1'],['Fine','fine_rgb_l1']]);
 group('Edge delta',[['Magnitude','edge_magnitude_l1']]);
 }
 group('Fitting error',[['Weighted','weighted_total']],'metric-total');
 return panel;
}
const readyImages=new Set(),cardCache=new Map();
const overviewGrid=document.createElement('div'),overviewSummary=document.createElement('p');overviewGrid.className='grid';overviewSummary.className='summary';
function reconcile(parent,nodes){for(let i=0;i<nodes.length;i++)if(parent.children[i]!==nodes[i])parent.insertBefore(nodes[i],parent.children[i]||null);const keep=new Set(nodes);for(const child of [...parent.children])if(!keep.has(child))child.remove();}
function revealImage(img,slot,url){
 slot.classList.add('image-slot');slot.setAttribute('aria-busy','true');
 const reveal=()=>{slot.classList.add('image-ready');slot.setAttribute('aria-busy','false');readyImages.delete(url);readyImages.add(url);if(readyImages.size>256)readyImages.delete(readyImages.values().next().value);};
 img.onload=()=>{if(img.decode)img.decode().catch(()=>{}).then(reveal);else reveal();};
 img.onerror=()=>{slot.classList.add('image-failed');slot.setAttribute('aria-busy','false');};
 if(readyImages.has(url))reveal();
 img.src=url;
 if(img.complete&&img.naturalWidth)reveal();
}
function exploreURL(item){const world=item.viewer==='source-surface'?'source-surface':'draa-valley';return '/worlds/'+world+'/?recipe='+item.recipeUrl.match(/([a-f0-9]{64})\.json$/)[1];}
function card(label,item,best=false,previous=null){
 const key=label+'|'+item.image.url,version=JSON.stringify([item,best,previous]),existing=cardCache.get(key);
 if(existing?.version===version)return existing.figure;
 const figure=existing?.figure||document.createElement('figure');figure.className='card'+(best?' best':'');
 const button=existing?.button||document.createElement('button');
 if(!existing){const img=document.createElement('img');button.type='button';img.alt=label;img.loading=['Source artwork','Baseline','Best saved result'].includes(label)?'eager':'lazy';img.decoding='async';button.append(img);revealImage(img,button,item.image.url);}
 const caption=document.createElement('figcaption'),heading=document.createElement('h3'),metrics=document.createElement('p');heading.textContent=label;metrics.className='score';metrics.textContent=item.reference?'10 / 10':Number.isFinite(item.components?.weighted_total)?(10*Math.max(0,Math.min(1,1-item.components.weighted_total))).toFixed(6)+' / 10':'';metrics.title=('pixel_mismatch_10pct' in (item.components||{})?'Literal fit v2':'Legacy fit v1')+' · higher is better · heuristic, not calibrated perceptual quality';caption.append(heading,metrics);
 if(Number.isFinite(item.components?.weighted_total)&&Number.isFinite(previous?.weighted_total)){
  const delta=document.createElement('p');delta.className='card-delta';
  const change=previous.weighted_total===0?null:(previous.weighted_total-item.components.weighted_total)/previous.weighted_total*100;
  const deltaValue=document.createElement('span');deltaValue.className='card-delta-value';
  deltaValue.textContent=change===null?'—':(change>0?'+':change<0?'−':'')+Math.abs(change).toFixed(6)+'%';
  delta.append('Delta ',deltaValue);
  delta.title='Relative improvement versus '+(item.deltaReference||'previous candidate (first candidate: baseline)')+'. Positive means improved; negative means worse.';
  if(change<0)deltaValue.classList.add('regressed');caption.append(delta);
 }
 if(best){const badge=document.createElement('span');badge.className='badge';badge.textContent='★';badge.title='Best saved result in this experiment';badge.setAttribute('aria-label','Best saved result in this experiment');heading.append(' ',badge);}
 if(item.recipeUrl){const explore=document.createElement('a');explore.className='card-explore';explore.textContent='Explore ↗';explore.href=exploreURL(item);caption.append(explore);}
 button.onclick=()=>{$('viewer-title').textContent=label;$('viewer-image').src=item.fullImage?.url||item.image.url;$('viewer-detail').replaceChildren(metricDetails(item.components));if(item.control){const change=document.createElement('p');change.className='viewer-change';change.textContent=item.control+(item.direction<0?' · decrease':' · increase');$('viewer-detail').append(change);}$('viewer-parameters').hidden=!item.recipeUrl;$('viewer-parameters').open=false;$('viewer-explore').hidden=!item.recipeUrl;if(item.recipeUrl){$('viewer-recipe').href=item.recipeUrl;$('viewer-recipe').download=label.replaceAll(' ','-')+'.json';const match=item.recipeUrl.match(/([a-f0-9]{64})\.json$/);$('viewer-explore').href=exploreURL(item);}$('viewer').showModal();};if(existing)existing.caption.replaceWith(caption);else figure.append(button,caption);cardCache.set(key,{figure,button,caption,version});return figure;
}
function show(){
 const experiment=records.find(row=>row.id===selected&&row.method===selectedMethod&&row.experimentId===selectedStudy);
 $('results').hidden=!experiment;$('view-section').hidden=!experiment;
 if(!experiment){const empty=document.createElement('p');empty.className='empty-method';empty.textContent=methods[selectedMethod-1]+' · No iterations yet';$('overview').replaceChildren(empty);$('candidates').replaceChildren();$('views').replaceChildren();signature='';cardCache.clear();return;}
 const next=JSON.stringify(experiment);if(next===signature)return;signature=next;
 const overview=overviewGrid,summary=overviewSummary,overviewCards=[];
 const sourceURL=new URL(experiment.source.imageUrl,location.href);sourceURL.searchParams.set('sha256',experiment.source.sha256);
 const source=card('Source artwork',{reference:true,image:{url:sourceURL.href},components:Object.fromEntries(Object.keys(experiment.baseline.components).map(key=>[key,0]))});source.title=experiment.source.id+' · SHA256 '+experiment.source.sha256;
 source.classList.add('comparison-source');
 const baseline=card('Baseline',experiment.baseline);baseline.classList.add('comparison-baseline');
 overviewCards.push(source,baseline);
 if(experiment.best){const best=card('Best saved result',{...experiment.best,finalBest:true,deltaReference:'previous saved best (batch baseline)'},true,experiment.baseline.components);best.classList.add('comparison-best');overviewCards.push(best);}
 summary.className='summary';summary.textContent=(experiment.objectiveVersion===2?'Literal fit v2':'Legacy fit v1')+' · '+experiment.candidates.length+' of '+experiment.totalCandidates+' iterations · '+experiment.status+' · fixed shader '+experiment.shaderSha256.slice(0,12)+'. '+(experiment.note||'');reconcile(overview,overviewCards);reconcile($('overview'),[overview,summary]);
 reconcile($('candidates'),experiment.candidates.map(candidate=>card('Iteration '+candidate.id,candidate,candidate.image.url===experiment.best?.image.url,candidate.previousComponents))); 
 reconcile($('views'),(experiment.views||[]).map(view=>card(view.label,view)));
 for(const [key,entry] of cardCache)if(!root.contains(entry.figure))cardCache.delete(key);
}
function updateURL(){
 const url=workbenchURL(location.href,{studyId:selectedStudy,method:selectedMethod,page:$('follow').getAttribute('aria-checked')==='true'?null:currentPage});
 history.replaceState(null,'',url);
}
function choose(){
 requestVersion++;signature='';updateURL();selectors();void refresh();
}
function selectors(){
 const studyNav=$('studies');
 if(studyNav.children.length!==studies.length)studyNav.replaceChildren(...studies.map(study=>{
  const button=document.createElement('button');button.type='button';button.textContent=study.label;button.dataset.id=study.id;
  button.onclick=()=>{selectedStudy=study.id;selectedMethod=study.defaultMethod||1;currentPage=null;onMethodChange(selectedMethod);onStudyChange(study);choose();};return button;
 }));
 for(const button of studyNav.children)button.setAttribute('aria-pressed',String(button.dataset.id===selectedStudy));
 const methodNav=$('experiments');
 if(!methodNav.children.length)methodNav.replaceChildren(...methods.map((name,index)=>{
  const button=document.createElement('button');button.type='button';button.textContent=(index+1)+' · '+name;
  button.onclick=()=>{selectedMethod=index+1;currentPage=null;onMethodChange(selectedMethod);choose();};return button;
 }));
 [...methodNav.children].forEach((button,index)=>button.setAttribute('aria-pressed',String(index+1===selectedMethod)));
 methodNav.hidden=!studies.some(study=>study.id===selectedStudy);
 $('page').value=pageInfo.page;$('page').max=pageInfo.totalPages;
 $('page-count').textContent='of '+pageInfo.totalPages+' · 20 per page';
 $('previous-page').disabled=pageInfo.page<=1;$('next-page').disabled=pageInfo.page>=pageInfo.totalPages;
}
function goPage(page){
 currentPage=Math.max(1,Math.min(pageInfo.totalPages,page));$('follow').setAttribute('aria-checked','false');choose();
}
async function refresh(){
 if(disposed||!active||document.hidden||fetching)return;fetching=true;
 const version=requestVersion;
 try{
  const params=new URLSearchParams({view:'page',method:selectedMethod,page:$('follow').getAttribute('aria-checked')==='true'?'latest':String(currentPage||'latest')});
  if(selectedStudy)params.set('study',selectedStudy);else if(legacyRequested)params.set('experiment',legacyRequested);
  const requestURL='/api/world-experiments?'+params,cached=pageCache.get(requestURL);
  const response=await fetch(requestURL,{cache:'no-store',headers:cached?.etag?{'If-None-Match':cached.etag}:{},signal:AbortSignal.timeout(10000)});
  if(!response.ok&&!(response.status===304&&cached))throw new Error();
  const data=response.status===304?cached.data:await response.json();if(disposed||!active||version!==requestVersion)return;
  pageCache.delete(requestURL);pageCache.set(requestURL,{data,etag:response.headers?.get('etag')});while(pageCache.size>16)pageCache.delete(pageCache.keys().next().value);
  studies=data.studies;selectedStudy=data.selectedStudy;if(!new URL(location.href).searchParams.has('method')){const preferred=studies.find(study=>study.id===selectedStudy)?.defaultMethod;if(preferred&&preferred!==selectedMethod){selectedMethod=preferred;onMethodChange(preferred);requestVersion++;return;}}selected=data.experiment?.id;records=data.experiment?[data.experiment]:[];pageInfo=data.pagination;
  if($('follow').getAttribute('aria-checked')!=='true')currentPage=pageInfo.page;
  onStudyChange(studies.find(study=>study.id===selectedStudy));updateURL();selectors();
  $('connection').textContent=pageInfo.total+' saved iterations · refreshed '+new Date().toLocaleTimeString();show();
 }catch{if(!disposed)$('connection').textContent='Reconnecting · saved results stay in place';}
 finally{fetching=false;if(!disposed&&active&&version!==requestVersion)void refresh();}
}
$('previous-page').onclick=()=>goPage(pageInfo.page-1);$('next-page').onclick=()=>goPage(pageInfo.page+1);
$('page').onchange=()=>{if($('page').validity.valid)goPage(Number($('page').value));};
const clearViewer=()=>{$('viewer-image').removeAttribute('src');$('viewer-detail').replaceChildren();};
$('viewer').addEventListener('close',clearViewer);
$('close').onclick=()=>$('viewer').close();$('follow').onclick=()=>{const enabled=$('follow').getAttribute('aria-checked')!=='true';$('follow').setAttribute('aria-checked',String(enabled));if(enabled){currentPage=null;choose();}};
if(currentPage)$('follow').setAttribute('aria-checked','false');
selectors();onMethodChange(selectedMethod);
if(active)void refresh();
const poll=setInterval(refresh,2000);
return {setActive(value){active=value;if(active)void refresh();else if($('viewer').open)$('viewer').close();},destroy(){disposed=true;active=false;clearInterval(poll);if($('viewer').open)$('viewer').close();clearViewer();$('viewer').removeEventListener('close',clearViewer);cardCache.clear();readyImages.clear();pageCache.clear();}};
}
