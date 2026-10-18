import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { authorized } from './native-live.mjs';
import { localWorkstationRequest } from './workstation-session.mjs';

export const defaults = { objectiveVersion:2, paused:false, adaptive:true, families:['camera','lighting','materials','terrain','palms','buildings','fields'], stepFraction:.04, proposals:32, intervalSeconds:30, meaningfulGain:.002 };
export function validateSettings(value) {
 if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).length!==Object.keys(defaults).length || Object.keys(value).some(key=>!(key in defaults)))throw new Error('Invalid settings');
 if(![1,2].includes(value.objectiveVersion))throw new Error('Unknown objective');
 if(typeof value.paused!=='boolean'||typeof value.adaptive!=='boolean')throw new Error('Invalid switch');
 if(!Array.isArray(value.families)||!value.families.length||new Set(value.families).size!==value.families.length||value.families.some(name=>!defaults.families.includes(name)))throw new Error('Choose at least one control family');
 for(const [key,low,high] of [['stepFraction',.001,.25],['intervalSeconds',1,600],['meaningfulGain',.0001,.1]])if(typeof value[key]!=='number'||!Number.isFinite(value[key])||value[key]<low||value[key]>high)throw new Error('Invalid '+key);
 if(!Number.isInteger(value.intervalSeconds)||!Number.isInteger(value.proposals)||value.proposals<8||value.proposals>128||value.proposals%2)throw new Error('Invalid batch or interval');
 return structuredClone(value);
}
async function body(req){
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>4096)throw new Error('Request too large');chunks.push(chunk);}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function installWorldAlgorithms(server,{directory=fileURLToPath(new URL('../.runtime/worlds/',import.meta.url)),authorize=authorized}={}){
 server.middlewares.use((req,res,next)=>{
  if(new URL(req.url,'http://localhost').pathname!=='/api/world-algorithms')return next();
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  void(async()=>{
   const canEdit=localWorkstationRequest(req)||await authorize(req);
   if(!['GET','POST'].includes(req.method)){send(405,{ok:false});return;}
   if(req.method==='POST'){
    const origin=req.headers.origin;
    if(!canEdit||!(localWorkstationRequest(req)||origin==='https://artwork.influx.vision')){send(403,{ok:false,problem:'Editing requires your studio session.'});return;}
    if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){send(415,{ok:false});return;}
    let settings;try{settings=validateSettings(await body(req));}catch(error){send(400,{ok:false,problem:error.message});return;}
    const record={settings,revision:randomUUID(),updatedAt:Date.now()/1000};await mkdir(directory,{recursive:true});
    const target=directory+'/fit-settings.json',temporary=target+'.'+record.revision+'.tmp';
    await writeFile(temporary,JSON.stringify(record)+'\n',{mode:0o600});await rename(temporary,target);
    send(200,{ok:true,...record});return;
   }
   let record={settings:defaults,revision:'defaults'},state=null;
   try{record=JSON.parse(await readFile(directory+'/fit-settings.json','utf8'));record.settings={objectiveVersion:1,...record.settings};validateSettings(record.settings);}catch(error){if(error.code!=='ENOENT')throw error;}
   try{const raw=JSON.parse(await readFile(directory+'/fit-loop.json','utf8'));state=Object.fromEntries(['experimentId','searchSize','objectiveVersion','status','cycle','best512','lastGain','lastRelativeGain','promoted','plateau','activeControls','eligibleControls','effectiveStepFraction','searchVersion','startedAt','finishedAt','updatedAt','revision'].filter(key=>Object.hasOwn(raw,key)).map(key=>[key,raw[key]]));if(typeof raw.seed==='string'&&raw.seed.startsWith(directory.replace(/\/$/,'')+'/method1/')){try{const report=JSON.parse(await readFile(raw.seed.replace(/candidate\.json$/,'report.json'),'utf8'));if((report.objectiveVersion||1)===(raw.objectiveVersion||1))state.bestComponents512=report.validation?.best512;}catch{}}try{process.kill(raw.pid,0);state.alive=true;}catch{state.alive=false;}}catch(error){if(error.code!=='ENOENT')throw error;}
   send(200,{ok:true,...record,state,canEdit});
  })().catch(()=>send(503,{ok:false,problem:'Algorithm state unavailable.'}));
 });
}
