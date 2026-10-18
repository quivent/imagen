import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateExperimentPlan,freezeExperimentPlan} from './research-plans.mjs';
import {localWorkstationRequest} from './workstation-session.mjs';
export function validateResearchChange(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid research change');
 if(value.type==='experiment')return validateExperimentPlan(value);
 if(value.type==='idea'){
  if(typeof value.title!=='string'||!value.title.trim()||value.title.length>160||typeof value.description!=='string'||!value.description.trim()||value.description.length>8000)throw new Error('Add a title and research question');
  return {type:'idea',title:value.title.trim(),description:value.description.trim()};
 }
 if(value.type!=='note'||!/^[-a-z0-9]{1,100}$/.test(value.id||'')||typeof value.note!=='string'||value.note.length>8000||typeof value.shortlisted!=='boolean')throw new Error('Invalid research note');
 return {type:'note',id:value.id,note:value.note,shortlisted:value.shortlisted};
}
export function installResearchNotes(server,{root=fileURLToPath(new URL('../.runtime/research/',import.meta.url)),catalogFile=fileURLToPath(new URL('../public/worlds/experiments.json',import.meta.url))}={}){
 const file=path.join(root,'notes.json');let writes=Promise.resolve();
 const read=async()=>{try{return {plans:[],...JSON.parse(await readFile(file,'utf8'))};}catch(error){if(error.code==='ENOENT')return {notes:{},ideas:[],plans:[]};throw error;}};
 server.middlewares.use((req,res,next)=>{
  if(new URL(req.url,'http://localhost').pathname!=='/api/research-notes')return next();
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  if(!['GET','POST'].includes(req.method)){res.writeHead(405).end();return;}
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)||(req.method==='POST'&&!localWorkstationRequest(req))){res.writeHead(403).end();return;}
  void(async()=>{
   if(req.method==='GET'){await writes;res.end(JSON.stringify({ok:true,...await read()}));return;}
   let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>20000)throw new Error('Research note is too long');}
   const change=validateResearchChange(JSON.parse(body));
   const update=writes.catch(()=>{}).then(async()=>{
    const state=await read();
    if(change.type==='experiment'){
     if(state.plans.length>=100)throw new Error('Experiment notebook is full');
     const catalog=JSON.parse(await readFile(catalogFile,'utf8'));
     state.plans.push(freezeExperimentPlan(change,catalog,{id:'plan-'+randomUUID()}));
    }else if(change.type==='idea'){
     if(state.ideas.length>=500)throw new Error('Research notebook is full');
     state.ideas.push({id:'idea-'+randomUUID(),name:change.title,description:change.description,family:'Open ideas',kind:'Proposal'});
    }else state.notes[change.id]={note:change.note,shortlisted:change.shortlisted,updatedAt:Date.now()};
    await mkdir(root,{recursive:true});const temporary=file+'.tmp';await writeFile(temporary,JSON.stringify(state,null,2)+'\n');await rename(temporary,file);return state;
   });writes=update.then(()=>{},()=>{});res.end(JSON.stringify({ok:true,...await update}));
  })().catch(()=>{if(!res.headersSent)res.writeHead(400);res.end(JSON.stringify({ok:false,problem:'Research change could not be saved'}));});
 });
}
