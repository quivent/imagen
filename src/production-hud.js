import './production-hud.css';
export function mountProductionHUD({root,document=globalThis.document,fetch=globalThis.fetch}){
 let disposed=false,request=null,last=null;
 root.className='production-hud';root.setAttribute('aria-label','Live production status');
 const make=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
 const title=make('span','Active FLUX1 production','production-hud-title'),lanes=make('div','','production-hud-lanes'),average=make('span','Avg render —','production-hud-average'),pipeline=make('div','','production-hud-pipeline'),age=make('span','Connecting…','production-hud-age');
 root.replaceChildren(title,lanes,average,pipeline,age);
 function draw(){
  if(!last)return;
  const stale=Date.now()-last.observedAt>15000;
  lanes.replaceChildren(...last.lanes.map(l=>{const n=make('span','GPU '+l.gpu+' · '+(stale?'Status stale':l.label),'production-hud-lane');n.dataset.state=stale?'unknown':l.state;n.title=l.promptRevision?'Current/last prompt revision: '+l.promptRevision:'Prompt revision observation unavailable';return n;}));
  average.textContent='Avg render '+(Number.isFinite(last.averageRenderSeconds)?last.averageRenderSeconds.toFixed(2)+'s':'—');average.title='Actual worker render time across the latest '+last.samples+' images; excludes scheduling and upload.';
  pipeline.replaceChildren(...last.stages.map(s=>{const n=make('span',s.label,'production-hud-stage');n.dataset.state=stale?'unknown':s.state;n.title=s.detail||s.label;return n;}));
  const seconds=last.workerObservedAt?Math.max(0,Math.floor((Date.now()-last.workerObservedAt)/1000)):null;
  age.textContent=stale?'Connection stale':!last.fresh?'Worker observation stale or unavailable':seconds===null?'Worker status unknown':'Observed '+seconds+'s ago';
 }
 const visible=()=>document.documentElement.dataset.studioMode==='studio'&&document.documentElement.dataset.workspace==='production'&&!document.hidden;
 async function load(){
  root.hidden=!visible();if(root.hidden||disposed){request?.abort();return;}if(request)return;
  const controller=new AbortController();request=controller;const timer=setTimeout(()=>controller.abort(),10000);
  try{const response=await fetch('/api/production-hud',{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error();const data=await response.json();if(!disposed){last=data;draw();}}
  catch{if(!last)age.textContent='Status unavailable';else draw();}
  finally{clearTimeout(timer);if(request===controller)request=null;}
 }
 const observer=new MutationObserver(()=>void load());observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-workspace','data-studio-mode']});
 document.addEventListener('visibilitychange',load);const timer=setInterval(()=>{draw();void load();},3000);void load();
 return {destroy(){disposed=true;request?.abort();clearInterval(timer);observer.disconnect();document.removeEventListener('visibilitychange',load);root.replaceChildren();}};
}
