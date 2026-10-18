import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {localWorkstationRequest} from './workstation-session.mjs';
const statuses=['next','working','ongoing','done'];
const studies=new Set(['glsl-worlds','flux1-prompt-clarity']);
const taskStudy=task=>typeof task.studyId==='string'&&task.studyId?task.studyId:'glsl-worlds';
export function validateWorkbenchTask(value){
 if(value?.type==='status'&&/^WB-[a-f0-9-]{36}$/.test(value.id||'')&&statuses.includes(value.status))return {type:'status',id:value.id,status:value.status};
 if(value?.type!=='create'||typeof value.title!=='string'||!value.title.trim()||value.title.length>160||typeof value.detail!=='string'||value.detail.length>4000)throw new Error('Invalid task');
 return {type:'create',title:value.title.trim(),detail:value.detail.trim()};
}
export function installWorkbenchTasks(server,{root=fileURLToPath(new URL('../.runtime/workbench/',import.meta.url))}={}){
 const file=path.join(root,'tasks.json');let pending=Promise.resolve();
 const read=async()=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return {schemaVersion:1,workspace:'workbench',updatedAt:null,tasks:[]};throw error;}};
 const scoped=(state,studyId)=>({...state,studyId,tasks:state.tasks.filter(task=>taskStudy(task)===studyId).map(task=>({...task,studyId,workspace:'workbench'}))});
 server.middlewares.use((req,res,next)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname!=='/api/workbench-tasks')return next();
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(data));};
  if(!['GET','POST'].includes(req.method)){send(405,{ok:false});return;}
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)||req.method==='POST'&&!localWorkstationRequest(req)){send(403,{ok:false});return;}
  const studyId=url.searchParams.get('study')??'glsl-worlds';
  if(!studies.has(studyId)){send(400,{ok:false,problem:'Unknown Workbench study'});return;}
  void(async()=>{
   if(req.method==='GET'){await pending;send(200,scoped(await read(),studyId));return;}
   let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>20000)throw new Error('Too large');}
   const value=validateWorkbenchTask(JSON.parse(body));
   const update=pending.catch(()=>{}).then(async()=>{
    const state=await read(),now=new Date().toISOString();
    state.tasks=state.tasks.map(task=>({...task,studyId:taskStudy(task)}));
    if(value.type==='create'){if(state.tasks.filter(task=>taskStudy(task)===studyId).length>=500)throw new Error('Notebook full');state.tasks.push({id:'WB-'+randomUUID(),title:value.title,detail:value.detail,status:'next',workspace:'workbench',studyId,createdAt:now});}
    else{const task=state.tasks.find(t=>t.id===value.id&&taskStudy(t)===studyId);if(!task)throw new Error('Unknown task');task.status=value.status;task.updatedAt=now;}
    state.updatedAt=now;await mkdir(root,{recursive:true});await writeFile(file+'.tmp',JSON.stringify(state,null,2)+'\n');await rename(file+'.tmp',file);return scoped(state,studyId);
   });pending=update.then(()=>{},()=>{});send(200,await update);
  })().catch(()=>send(400,{ok:false,problem:'Workbench task could not be saved'}));
 });
}
