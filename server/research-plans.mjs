import {pipelinePlan} from '../src/research-pipelines.js';
export function validateExperimentPlan(value){
 const out={type:'experiment'};
 for(const [key,max] of Object.entries({pipelineId:80,sourceExperiment:80,title:160,hypothesis:2000,change:2000,controls:2000,success:2000})){
  if(typeof value[key]!=='string'||!value[key].trim()||value[key].length>max)throw new Error('Incomplete experiment plan');
  out[key]=value[key].trim();
 }
 pipelinePlan(out.pipelineId);
 if(!/^experiment-[0-9]+$/.test(out.sourceExperiment))throw new Error('Unknown source experiment');
 return out;
}
export function freezeExperimentPlan(change,catalog,{id,now=Date.now()}={}){
 const value=validateExperimentPlan(change),baseline=catalog.experiments.find(row=>row.id===value.sourceExperiment);
 if(!baseline||!baseline.source||!/^[a-f0-9]{64}$/.test(baseline.source.sha256||''))throw new Error('Source is not registered');
 const {type,...design}=value;
 return {...design,id,createdAt:now,status:'planned',source:structuredClone(baseline.source),baseline:{id:baseline.id,title:baseline.title,number:baseline.number},pipeline:pipelinePlan(value.pipelineId),evidence:[],conclusion:null};
}
