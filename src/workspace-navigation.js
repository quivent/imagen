import {workbenchStudies,selectedStudy,selectStudy,observeStudy,productionStudies,selectedProductionStudy,selectProductionStudy,observeProductionStudy} from './study-context.js';
import {studioTab,studioTabs} from './studio-route.js';
export const workspaceTabs={
 production:['stream','gallery','controls','tasks','models','seers','winners','agents','performance','metrics','daemons','protocol','rules','monitor','prompt-comparison','qwen','pixtral-chat'],
 gallery:['archive'],
 worlds:['worlds'],
 workbench:['workbench','research','stream','gallery','workbench-controls','workbench-tasks','workbench-agents','qwen','pixtral-chat'],
};
const workspaceWorkflow={production:['stream','gallery','controls','winners','models','seers','prompt-comparison','qwen','pixtral-chat'],workbench:['workbench','research','stream','gallery','workbench-controls','qwen','pixtral-chat'],gallery:['archive'],worlds:['worlds']};
const workspaceSystem={production:['tasks','agents','monitor','performance','metrics','daemons','protocol','rules'],workbench:['workbench-tasks','workbench-agents','qwen','pixtral-chat'],gallery:[],worlds:[]};
export function workspaceForTab(tab,preferred='production'){
 if(workspaceTabs[preferred]?.includes(tab))return preferred;
 return Object.keys(workspaceTabs).find(area=>workspaceTabs[area].includes(tab))||'production';
}
export function mountWorkspaceNavigation({select,activeTab}){
 const root=document.documentElement,group=document.getElementById('workspace-navigation'),nav=document.querySelector('.studio-tab-buttons');
 const workflowRow=document.createElement('div'),systemRow=document.createElement('div'),parked=document.createElement('div');workflowRow.className='studio-workflow-tabs';systemRow.className='studio-system-tabs';parked.hidden=true;for(const row of [workflowRow,systemRow,parked]){row.setAttribute('role','presentation');nav.append(row);}
 let preferred='production',last={production:'stream',workbench:'workbench',gallery:'archive',worlds:'worlds'},experimentQuery='';
 try{preferred=localStorage.getItem('imagen:workspace')||preferred;const saved=JSON.parse(localStorage.getItem('imagen:workspace-tabs')||'null');if(saved)for(const area of Object.keys(last))if(workspaceTabs[area].includes(saved[area]))last[area]=saved[area];experimentQuery=localStorage.getItem('imagen:experiment-selection')||'';}catch{}
 const studyGroup=document.getElementById('study-navigation');
 let studyArea=null;
 let area=workspaceForTab(activeTab(),preferred);
 function remember(){try{localStorage.setItem('imagen:workspace',area);localStorage.setItem('imagen:workspace-tabs',JSON.stringify(last));localStorage.setItem('imagen:experiment-selection',experimentQuery);}catch{}}
 function update(){
  const publicMode=root.dataset.studioMode!=='studio';group.hidden=publicMode;root.dataset.workspace=area;studyGroup.hidden=publicMode||['gallery','worlds'].includes(area);root.dataset.study=selectedStudy();root.dataset.productionStudy=selectedProductionStudy();
  if(studyArea!==area){studyArea=area;studyGroup.replaceChildren();studyGroup.setAttribute('aria-label',area==='production'?'Production study':'Workbench study');for(const study of area==='production'?productionStudies:area==='workbench'?workbenchStudies:[]){const b=document.createElement('button');b.type='button';b.dataset.study=study.id;b.textContent=study.label;b.onclick=()=>area==='production'?selectProductionStudy(study.id):selectStudy(study.id);studyGroup.append(b);}}
  const selection=area==='production'?selectedProductionStudy():selectedStudy();for(const b of studyGroup.children)b.setAttribute('aria-pressed',String(b.dataset.study===selection));
  for(const button of group.querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.workspace===area));
  const workflow=publicMode?studioTabs:workspaceWorkflow[area],system=publicMode?[]:workspaceSystem[area];
  for(const tab of [...workflow,...system,...studioTabs.filter(tab=>!workflow.includes(tab)&&!system.includes(tab))]){
   const button=document.getElementById('tab-'+tab);button.dataset.workspaceHidden=String(!publicMode&&!workspaceTabs[area].includes(tab));(workflow.includes(tab)?workflowRow:system.includes(tab)?systemRow:parked).append(button);
  }
  systemRow.hidden=system.length===0;
  nav.hidden=!publicMode&&['gallery','worlds'].includes(area);
  nav.setAttribute('aria-label',publicMode?'Imagen':area==='production'?'Production tools':area==='worlds'?'Worlds':'Workbench tools');
 }
 function captureExperiment(){if(activeTab()==='workbench'&&selectedStudy()==='glsl-worlds'){
  const current=new URL(location.href),query=new URLSearchParams();for(const key of ['experiment','method','page'])if(current.searchParams.has(key))query.set(key,current.searchParams.get(key));experimentQuery=query.toString();
 }}
 for(const button of group.querySelectorAll('button'))button.onclick=()=>{
  if(button.dataset.workspace===area)return;captureExperiment();last[area]=activeTab();area=button.dataset.workspace;remember();update();
  const target=workspaceTabs[area].includes(last[area])?last[area]:workspaceTabs[area][0];
  if(target==='workbench'&&selectedStudy()==='glsl-worlds'&&experimentQuery){const url=new URL(location.href);url.pathname='/workbench';url.search='?'+experimentQuery;url.hash='';history.replaceState(null,'',url);}
  select(target,true);
 };
 const releaseStudy=observeStudy(update);
 const releaseProductionStudy=observeProductionStudy(update);
 const observer=new MutationObserver(update);observer.observe(root,{attributes:true,attributeFilter:['data-studio-mode']});update();
 return {onTab(tab){area=workspaceForTab(tab,area);last[area]=tab;captureExperiment();remember();update();},destroy(){releaseStudy();releaseProductionStudy();studyGroup.replaceChildren();observer.disconnect();for(const button of group.querySelectorAll('button'))button.onclick=null;for(const tab of studioTabs)nav.append(document.getElementById('tab-'+tab));for(const row of [workflowRow,systemRow,parked])row.remove();}};
}
