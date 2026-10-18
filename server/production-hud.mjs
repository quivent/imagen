// Observations only: a running daemon is not proof of GPU inference.
export function productionHUD({flow={},monitor={},revisions=null,now=Date.now()}){
 const generation=monitor.generation||{},observed=Date.parse(generation.observedAt),fresh=Number.isFinite(observed)&&now-observed>=-5000&&now-observed<15000;
 const daemon=flow.daemon||{},pairs=flow.pairs||[];
 const seconds=pairs.flatMap(p=>Object.values(p.images||{}).map(i=>i.seconds)).filter(n=>Number.isFinite(n)&&n>0);
 const lanes=(daemon.lanes||[]).map(lane=>{
  const worker=(generation.workers||[]).find(w=>w.port===lane.workerPort),heartbeat=Number(lane.heartbeatAt)*1000;
  const alive=lane.runnerAlive&&Number.isFinite(heartbeat)&&now-heartbeat<15000;
  let state='unknown',label='No fresh observation';
  if(fresh&&worker?.running>0){state='running';label=lane.enabled?'Rendering':'Finishing current image';}
  else if(lane.problem||lane.stage==='needs-attention'){state='error';label='Needs attention';}
  else if(!lane.enabled){state='paused';label='Paused';}
  else if(!alive){state='error';label='Runner offline or stale';}
  else if(fresh&&worker?.phase==='ready'){state='waiting';label='Between images';}
  else if(fresh){state='error';label='Worker unavailable';}
  return {gpu:lane.gpuIndex??lane.laneIndex,state,label,promptRevision:lane.activePromptRevision||null};
 });
 const archive=generation.archive||{},archiveTime=Date.parse(archive.observedAt),archiveFresh=archive.alive===true&&Number.isFinite(archiveTime)&&now-archiveTime>=-5000&&now-archiveTime<15000;
 const pending=Number.isFinite(archive.pendingJobs)?archive.pendingJobs:null;
 return {observedAt:now,workerObservedAt:Number.isFinite(observed)?observed:null,fresh,lanes,
  averageRenderSeconds:seconds.length?seconds.reduce((a,b)=>a+b,0)/seconds.length:null,samples:seconds.length,
  completedImages:Number(flow.totalPairs||0)*2,
  stages:[...(revisions?[{label:'Qwen '+revisions.approved+'/'+revisions.total,state:revisions.approved===revisions.total?'ready':'waiting',detail:revisions.drafted+' drafts · '+revisions.approved+' approved · '+revisions.rejected+' need revision; counts, not a claim of current model activity.'}]:[]),{label:'Saved prompts',state:daemon.currentPackage?'ready':'unknown'},
   {label:'FLUX',state:lanes.some(l=>l.state==='running')?'running':lanes.some(l=>l.state==='error')?'error':'waiting'},
   {label:'R2',state:archiveFresh&&pending!==null?(pending===0?'ready':'waiting'):'unknown',detail:archiveFresh&&pending!==null?(pending===0?'Upload queue clear':pending+' waiting to upload'):'Upload observation unavailable or stale'}]};
}
