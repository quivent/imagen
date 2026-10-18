import { studioLive } from './live-store.js';
import { generationIsActive } from './generation-state.js';
export function mountPublicNavigation({select, activeTab, panels}) {
 const $=id=>document.getElementById(id);
 let running=false,lastObservation=null;
 const originalSeersParent=$('seers-panel').parentNode;
 const originalSeersNext=$('seers-panel').nextSibling;
 const seersHome=document.createElement('div');seersHome.className='models-seers';$('models-panel').append(seersHome);
 function update(){
  const publicMode=document.documentElement.dataset.studioMode==='public';
  $('tab-stream').textContent=publicMode?'Active':'Stream';
  $('tab-stream').hidden=publicMode&&!running;
  $('tab-winners').textContent=publicMode?'Collections':'Winners';
  const heading=$('winners-panel').querySelector('h1');if(heading)heading.textContent=publicMode?'Collections':'Winners';
  const intro=$('winners-panel').querySelector('.winners-heading > p:last-child');if(intro)intro.textContent=publicMode?'A place for selected works and the collections we make from them.':'Choose a side in Compare. Your choices are kept here across browsers.';
  if(publicMode){if($('seers-panel').parentNode!==seersHome)seersHome.append($('seers-panel'));$('seers-panel').hidden=activeTab()!=='models';}
  else if($('seers-panel').parentNode!==originalSeersParent){originalSeersParent.insertBefore($('seers-panel'),originalSeersNext);$('seers-panel').hidden=activeTab()!=='seers';}
  panels.seers?.setActive(publicMode?activeTab()==='models':activeTab()==='seers');
  const selected=$('tab-'+activeTab());
  if(publicMode&&(selected?.hidden||['research','workbench','rules','protocol','seers','controls','tasks','performance','metrics','agents','daemons','monitor'].includes(activeTab())))select(activeTab()==='seers'?'models':'worlds');
 }
 const release=studioLive.subscribe('monitor',observation=>{lastObservation=observation;running=generationIsActive(observation);update();});
 const observer=new MutationObserver(update);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-studio-mode']});
 const timer=setInterval(()=>{const active=generationIsActive(lastObservation);if(active!==running){running=active;update();}const tab=activeTab();if(document.documentElement.dataset.studioMode==='public'){$('seers-panel').hidden=tab!=='models';panels.seers?.setActive(tab==='models');}},1000);
 update();
 return {update,destroy(){release();observer.disconnect();clearInterval(timer);}};
}
