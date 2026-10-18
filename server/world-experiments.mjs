import { worldExperimentPage } from './world-experiment-pages.mjs';
import { readFile, readdir, realpath, stat, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const hash=data=>createHash('sha256').update(data).digest('hex');
const responseBodies=new WeakMap();
const defaultRoot=fileURLToPath(new URL('../.runtime/worlds/',import.meta.url));
export function createExperimentStore({root=defaultRoot,catalogFile=fileURLToPath(new URL('../public/worlds/experiments.json',import.meta.url)),now=Date.now}={}){
 const index=path.join(root,'experiments'),cacheDirectory=path.join(root,'.viewer-cache');
 const filesCache=new Map(),loadedRuns=new Map(),pendingRuns=new Map();
 let snapshot=null,snapshotAt=0,collecting=null,lastScan=0,lastPrune=0,directoryStamp='',catalogStamp='';
 async function readRun(id){
  const entry=[...filesCache.values()].find(row=>row.summary.id===id);if(!entry)throw new Error('Unknown run');
  const key=entry.cleanFile;
  if(loadedRuns.has(key)){const run=loadedRuns.get(key);loadedRuns.delete(key);loadedRuns.set(key,run);return run;}
  if(pendingRuns.has(key))return pendingRuns.get(key);
  const pending=readFile(key,'utf8').then(text=>{const run=JSON.parse(text);loadedRuns.set(key,run);while(loadedRuns.size>8)loadedRuns.delete(loadedRuns.keys().next().value);return run;}).finally(()=>pendingRuns.delete(key));pendingRuns.set(key,pending);return pending;
 }
 async function collect(){
  if(snapshot&&now()-snapshotAt<1000)return snapshot;if(collecting)return collecting;
  collecting=(async()=>{
   const [directoryInfo,catalogInfo]=await Promise.all([stat(index),stat(catalogFile)]);
   const nextDirectoryStamp=directoryInfo.mtimeMs+':'+directoryInfo.ctimeMs,nextCatalogStamp=catalogInfo.mtimeMs+':'+catalogInfo.size;
   if(snapshot&&nextDirectoryStamp===directoryStamp&&nextCatalogStamp===catalogStamp&&now()-lastScan<10000){snapshotAt=now();return snapshot;}
   const names=(await readdir(index)).filter(name=>/^method[1-5]-[A-Za-z0-9_-]+\.json$/.test(name)).sort();
   let changed=!snapshot||nextCatalogStamp!==catalogStamp;
   await mkdir(cacheDirectory,{recursive:true});
   // Sequential reads bound transient memory during a cold history scan.
   for(const name of names){
    const filename=path.join(index,name),info=await stat(filename),stamp=info.mtimeMs+':'+info.size;
    if(filesCache.get(name)?.stamp===stamp)continue;
    const images=new Map(),recipes=new Map();
    const clean=(value,trail=[])=>{
     if(Array.isArray(value))return value.map((item,i)=>clean(item,[...trail,i]));
     if(!value||typeof value!=='object')return value;
     if(typeof value.file==='string'&&/^[a-f0-9]{64}$/.test(value.sha256||'')){
      if(!/^method[1-5]\/[A-Za-z0-9_./-]+\.png$/.test(value.file)||value.file.split('/').includes('..'))throw new Error('Invalid experiment path');
      images.set(value.sha256,value.file);const {file,...publicValue}=value;return publicValue;
     }
     const out={};for(const [key,item] of Object.entries(value)){
      if(key==='recipe'){const sha=hash(JSON.stringify(item));recipes.set(sha,{filename,trail:[...trail,key]});out.recipeUrl='/api/world-experiments/recipe/'+sha+'.json';}
      else out[key]=clean(item,[...trail,key]);
     }return out;
    };
    const run=clean(JSON.parse(await readFile(filename,'utf8'))),{candidates=[],...summary}=run;
    summary.candidateCount=candidates.length;summary.lastComponents=candidates.at(-1)?.components||null;
    const cleanFile=path.join(cacheDirectory,hash(name+':'+stamp)+'.json'),temporary=cleanFile+'.'+process.pid+'.tmp';
    await writeFile(temporary,JSON.stringify(run));await rename(temporary,cleanFile);
    const previous=filesCache.get(name);if(previous){loadedRuns.delete(previous.cleanFile);void(pendingRuns.get(previous.cleanFile)||Promise.resolve()).then(()=>unlink(previous.cleanFile)).catch(()=>{});}
    filesCache.set(name,{stamp,summary,images,recipes,cleanFile});changed=true;
   }
   const present=new Set(names);for(const [name,entry] of filesCache)if(!present.has(name)){loadedRuns.delete(entry.cleanFile);filesCache.delete(name);changed=true;}
   if(now()-lastPrune>60000){
    const current=new Set([...filesCache.values()].map(entry=>path.basename(entry.cleanFile)));
    for(const name of await readdir(cacheDirectory))if(/^[a-f0-9]{64}\.json$/.test(name)&&!current.has(name)){const file=path.join(cacheDirectory,name);try{if((await stat(file)).mtimeMs<now()-60000)await unlink(file);}catch{}}
    lastPrune=now();
   }
   directoryStamp=nextDirectoryStamp;catalogStamp=nextCatalogStamp;lastScan=now();snapshotAt=now();
   if(!changed)return snapshot;
   const images=new Map(),recipes=new Map();for(const entry of filesCache.values()){for(const pair of entry.images)images.set(...pair);for(const pair of entry.recipes)recipes.set(...pair);}
   const catalog=JSON.parse(await readFile(catalogFile,'utf8'));
   snapshot={experiments:names.map(name=>filesCache.get(name).summary),images,recipes,studies:catalog.experiments,defaultExperiment:catalog.defaultExperiment,readRun};return snapshot;
  })();try{return await collecting;}finally{collecting=null;}
 }
 async function readRecipe(locator,sha){
  let value=JSON.parse(await readFile(locator.filename,'utf8'));for(const key of locator.trail)value=value?.[key];
  const body=JSON.stringify(value);if(!body||hash(body)!==sha)throw new Error('Recipe hash mismatch');return Buffer.from(body);
 }
 return {collect,readRecipe,stats:()=>({summaries:filesCache.size,loadedRuns:loadedRuns.size,recipeBodiesRetained:0,recipeLocators:snapshot?.recipes.size||0,summaryBytes:Buffer.byteLength(JSON.stringify(snapshot?.experiments||[])),loadedRunBytes:[...loadedRuns.values()].reduce((sum,run)=>sum+Buffer.byteLength(JSON.stringify(run)),0)})};
}
const store=createExperimentStore();
export const collectExperiments=()=>store.collect();
export function installWorldExperiments(server){
 server.middlewares.use(async(req,res,next)=>{
  const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/api/world-experiments')){next();return;}
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-cache');
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'}).end();return;}
  try{
   const data=await collectExperiments();let body,type,sha;
   if(url.pathname==='/api/world-experiments'){
    const value=url.searchParams.has('view')?await worldExperimentPage(data,url.searchParams):{ok:true,experiments:await Promise.all(data.experiments.map(run=>data.readRun(run.id))),studies:data.studies,defaultExperiment:data.defaultExperiment};
    let encoded=responseBodies.get(value);if(!encoded){const buffer=Buffer.from(JSON.stringify(value));encoded={body:buffer,sha:hash(buffer)};responseBodies.set(value,encoded);}
    body=encoded.body;type='application/json';sha=encoded.sha;res.setHeader('ETag','"'+sha+'"');
    if(req.headers['if-none-match']==='"'+sha+'"'){res.writeHead(304).end();return;}
   }else{
    const match=url.pathname.match(/^\/api\/world-experiments\/(image|recipe)\/([a-f0-9]{64})\.(png|json)$/);if(!match)throw new Error('Unknown artifact');
    sha=match[2];const isImage=match[1]==='image'&&match[3]==='png',isRecipe=match[1]==='recipe'&&match[3]==='json';
    if(!isImage&&!isRecipe)throw new Error('Invalid artifact');
    const registered=isImage?data.images.get(sha):data.recipes.get(sha);if(!registered)throw new Error('Unknown artifact');
    res.setHeader('ETag','"'+sha+'"');res.setHeader('Cache-Control','public, max-age=31536000, immutable');
    if(req.headers['if-none-match']==='"'+sha+'"'){res.writeHead(304).end();return;}
    if(isImage){
     const filename=path.resolve(defaultRoot,registered);if(!filename.startsWith(defaultRoot)||await realpath(filename)!==filename)throw new Error('Invalid capture path');
     const info=await stat(filename);if(!info.isFile()||info.size>25000000)throw new Error('Invalid capture');
     if(req.method==='HEAD'){res.writeHead(200,{'Content-Type':'image/png','Content-Length':info.size}).end();return;}
     body=await readFile(filename);if(body.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||hash(body)!==sha)throw new Error('Capture hash mismatch');type='image/png';
    }else{body=await store.readRecipe(registered,sha);type='application/json';}
   }
   res.writeHead(200,{'Content-Type':type,'Content-Length':body.length});res.end(req.method==='HEAD'?undefined:body);
  }catch(error){res.writeHead(error.code==='ENOENT'?503:404,{'Content-Type':'application/json'}).end(JSON.stringify({ok:false,problem:'Experiment artifact unavailable'}));}
 });
}
