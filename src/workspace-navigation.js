import {studioTab,studioTabs} from './studio-route.js';
export const workspaceTabs={
 production:['stream','gallery','controls','models','winners','worlds'],
 workbench:['workbench','research','worlds','stream','gallery','models','seers','tasks','performance','metrics','agents','daemons','rules','protocol','monitor'],
};
export function workspaceForTab(tab,preferred='production'){
 if(workspaceTabs[preferred]?.includes(tab))return preferred;
 return workspaceTabs.workbench.includes(tab)?'workbench':'production';
}
export function mountWorkspaceNavigation({select,activeTab}){
 const root=document.documentElement,group=document.getElementById('workspace-navigation'),nav=document.querySelector('.studio-tab-buttons');
 let preferred='production',last={production:'stream',workbench:'workbench'},experimentQuery='';
 try{preferred=localStorage.getItem('imagen:workspace')||preferred;const saved=JSON.parse(localStorage.getItem('imagen:workspace-tabs')||'null');if(saved)for(const area of Object.keys(last))if(workspaceTabs[area].includes(saved[area]))last[area]=saved[area];experimentQuery=localStorage.getItem('imagen:experiment-selection')||'';}catch{}
 let area=workspaceForTab(activeTab(),preferred);
 function remember(){try{localStorage.setItem('imagen:workspace',area);localStorage.setItem('imagen:workspace-tabs',JSON.stringify(last));localStorage.setItem('imagen:experiment-selection',experimentQuery);}catch{}}
 function update(){
  const publicMode=root.dataset.studioMode!=='studio';group.hidden=publicMode;root.dataset.workspace=area;
  for(const button of group.querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.workspace===area));
  for(const tab of [...workspaceTabs[area],...studioTabs.filter(tab=>!workspaceTabs[area].includes(tab))]){
   const button=document.getElementById('tab-'+tab);button.dataset.workspaceHidden=String(!publicMode&&!workspaceTabs[area].includes(tab));nav.append(button);
  }
  nav.setAttribute('aria-label',publicMode?'Imagen':area==='production'?'Production tools':'Workbench tools');
 }
 function captureExperiment(){if(activeTab()==='workbench'){
  const current=new URL(location.href),query=new URLSearchParams();for(const key of ['experiment','method','page'])if(current.searchParams.has(key))query.set(key,current.searchParams.get(key));experimentQuery=query.toString();
 }}
 for(const button of group.querySelectorAll('button'))button.onclick=()=>{
  if(button.dataset.workspace===area)return;captureExperiment();last[area]=activeTab();area=button.dataset.workspace;remember();update();
  const target=workspaceTabs[area].includes(last[area])?last[area]:workspaceTabs[area][0];
  if(target==='workbench'&&experimentQuery){const url=new URL(location.href);url.pathname='/workbench';url.search='?'+experimentQuery;url.hash='';history.replaceState(null,'',url);}
  select(target,true);
 };
 const observer=new MutationObserver(update);observer.observe(root,{attributes:true,attributeFilter:['data-studio-mode']});update();
 return {onTab(tab){area=workspaceForTab(tab,area);last[area]=tab;captureExperiment();remember();update();},destroy(){observer.disconnect();for(const button of group.querySelectorAll('button'))button.onclick=null;}};
}
