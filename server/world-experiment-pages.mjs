const studyOf=(run,studies)=>run.experimentId||studies.find(study=>study.source.sha256===run.source?.sha256)?.id||'experiment-1';
const indexes=new WeakMap();
function indexFor(data){
 if(indexes.has(data))return indexes.get(data);
 const groups=new Map(),byId=new Map();
 for(const run of data.experiments){
  byId.set(run.id,run);const key=studyOf(run,data.studies)+':'+run.method;
  let group=groups.get(key);if(!group){group={runs:[],total:0,versions:new Map(),pages:new Map()};groups.set(key,group);}
  const count=run.candidateCount??run.candidates.length,version=run.objectiveVersion||1;
  group.runs.push({run,start:group.total,end:group.total+count});group.total+=count;
  const comparable=group.versions.get(version)||{first:run,latest:run,best:null};comparable.latest=run;
  const error=row=>row.validation?.best512?.weighted_total??row.best?.components.weighted_total??Infinity;
  if(run.best&&(!comparable.best||error(run)<error(comparable.best)))comparable.best=run;
  group.versions.set(version,comparable);
 }
 const index={groups,byId};indexes.set(data,index);return index;
}
function findRun(runs,index){let lo=0,hi=runs.length;while(lo<hi){const mid=(lo+hi)>>1;if(runs[mid].end<=index)lo=mid+1;else hi=mid;}return lo;}
export function worldExperimentPage(data,params){
 const index=indexFor(data),legacy=index.byId.get(params.get('experiment'));
 const studyId=params.get('study')||(legacy?studyOf(legacy,data.studies):data.defaultExperiment),study=data.studies.find(item=>item.id===studyId);if(!study)throw new Error('Unknown experiment');
 const method=Number(params.get('method')||legacy?.method||1);if(!Number.isInteger(method)||method<1||method>5)throw new Error('Unknown method');
 const group=index.groups.get(studyId+':'+method)||{runs:[],total:0,versions:new Map(),pages:new Map()};
 const pageSize=20,total=group.total,totalPages=Math.max(1,Math.ceil(total/pageSize));
 let page=params.get('page');page=page===null||page==='latest'?totalPages:Number(page);if(!Number.isInteger(page)||page<1)throw new Error('Invalid page');page=Math.min(page,totalPages);
 if(group.pages.has(page))return group.pages.get(page);
 const start=(page-1)*pageSize,end=Math.min(total,start+pageSize),needed=[];
 for(let i=findRun(group.runs,start);i<group.runs.length&&group.runs[i].start<end;i++)needed.push({...group.runs[i],runIndex:i});
 function finish(loaded){
  const candidates=[];
  for(let i=0;i<needed.length;i++){
   const entry=needed[i],run=loaded[i],version=run.objectiveVersion||1;
   for(let offset=Math.max(0,start-entry.start);offset<run.candidates.length&&entry.start+offset<end;offset++){
    const previous=offset>0?run.candidates[offset-1].components:((group.runs[entry.runIndex-1]?.run.objectiveVersion||1)===version?(group.runs[entry.runIndex-1]?.run.lastComponents||group.runs[entry.runIndex-1]?.run.candidates?.at(-1)?.components||group.runs[entry.runIndex-1]?.run.baseline.components||run.baseline.components):run.baseline.components);
    candidates.push({...run.candidates[offset],id:entry.start+offset+1,batchId:run.id,objectiveVersion:version,previousComponents:previous});
   }
  }
  const version=candidates.at(-1)?.objectiveVersion||group.runs.at(-1)?.run.objectiveVersion||1;
  const comparable=group.versions.get(version),first=comparable?.first,latest=comparable?.latest,bestRun=comparable?.best;
  const experiment=first?{id:studyId+'-method-'+method,experimentId:studyId,method,source:study.source,objectiveVersion:version,searchSize:latest.searchSize||study.searchSize,shaderSha256:first.shaderSha256,baseline:first.baseline,best:bestRun?.best,candidates,views:bestRun?.views||latest.views||[],status:group.runs.at(-1)?.run.status||'complete',note:latest.note||'',totalCandidates:total}:null;
  const result={ok:true,studies:data.studies,defaultExperiment:data.defaultExperiment,selectedStudy:studyId,method,experiment,pagination:{page,pageSize,total,totalPages}};
  group.pages.set(page,result);while(group.pages.size>32)group.pages.delete(group.pages.keys().next().value);return result;
 }
 return data.readRun?Promise.all(needed.map(entry=>data.readRun(entry.run.id))).then(finish):finish(needed.map(entry=>entry.run));
}
