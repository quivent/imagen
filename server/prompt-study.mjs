import {collectArchiveGallery} from './r2-gallery.mjs';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {readFile,realpath,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {localWorkstationRequest} from './workstation-session.mjs';
import {productionHUD} from './production-hud.mjs';
const execute=promisify(execFile),script=fileURLToPath(new URL('../tools/artwork/prompt_clarity.py',import.meta.url)),controller=fileURLToPath(new URL('../tools/artwork/study_controller.py',import.meta.url));
const flowScript=fileURLToPath(new URL('../tools/artwork/production_feed.py',import.meta.url));
const daemonScript=fileURLToPath(new URL('../tools/artwork/parity_daemon.py',import.meta.url));
const settingsScript=fileURLToPath(new URL('../tools/artwork/study_settings.py',import.meta.url));
const defaultRoot=fileURLToPath(new URL('../.runtime/research/flux1-prompt-clarity',import.meta.url));
export function installPromptStudy(server,{root=defaultRoot,launch,archive=collectArchiveGallery}={}){
 root=path.resolve(root);let saving=null,lastArchive=null,archiveAt=0,archivePending=null;const children=new Map();
 const args=(file,action,id)=>['-B',file,'--root',root,action,...(id?[id]:[])];
 const call=async action=>{const result=await execute('python3',args(script,action),{timeout:10000,maxBuffer:256*1024});return JSON.parse(result.stdout);};
 const control=(action,id,payload)=>new Promise((resolve,reject)=>{
  const child=execFile('python3',args(controller,action,id),{timeout:10000,maxBuffer:512*1024},(error,stdout)=>{if(error){reject(new Error('Study command rejected'));return;}try{resolve(JSON.parse(stdout));}catch{reject(new Error('Invalid study state'));}});
  child.stdin.end(payload?JSON.stringify(payload):'');
 });
 const daemonRoot=root===path.resolve(defaultRoot)?path.resolve(root,'../production-parity-daemon'):path.join(root,'daemon');
 const feeds=new Map();
 const flowCall=async(page=1)=>{const old=feeds.get(page);if(old&&Date.now()-old.at<2000)return old.promise;const promise=execute('python3',['-B',flowScript,'--root',root,'--daemon-root',daemonRoot,'--page',String(page),'feed'],{timeout:10000,maxBuffer:2*1024*1024}).then(result=>JSON.parse(result.stdout));feeds.set(page,{at:Date.now(),promise});if(feeds.size>8)feeds.delete(feeds.keys().next().value);try{return await promise;}catch(error){feeds.delete(page);throw error;}};
 const daemonCall=async action=>{let value;for(const laneRoot of [daemonRoot,daemonRoot+'-gpu1']){try{await stat(path.join(laneRoot,'config.json'));}catch{if(laneRoot!==daemonRoot)continue;}const result=await execute('python3',['-B',daemonScript,'--root',laneRoot,'--study-root',root,action],{timeout:10000,maxBuffer:512*1024});value=JSON.parse(result.stdout);}feeds.clear();return value;};
 const advance=id=>{
  if(launch){launch(id);return;}
  if(children.has(id))return;
  const child=spawn('python3',args(controller,'advance',id),{stdio:'ignore',detached:true});children.set(id,child);
  child.on('error',()=>children.delete(id));child.on('exit',()=>children.delete(id));child.unref();
 };
 server.middlewares.use((req,res,next)=>{
  const url=new URL(req.url,'http://localhost');if(url.pathname!=='/api/prompt-comparison'&&url.pathname!=='/api/production-hud'&&url.pathname!=='/api/prompt-study'&&!url.pathname.startsWith('/api/prompt-study/image/'))return next();
  const send=(code,value)=>res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(JSON.stringify(value));
  if(!['GET','POST'].includes(req.method)){send(405,{ok:false});return;}
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)||req.method==='POST'&&!localWorkstationRequest(req)){send(403,{ok:false});return;}
  void(async()=>{
   if(url.pathname==='/api/prompt-comparison'){
    if(req.method!=='GET'){send(405,{ok:false});return;}
    const file=new URL('../research/studies/art-direction-held-constant/baselines-40.json',import.meta.url);
    try{send(200,JSON.parse(await readFile(file,'utf8')));}catch{send(200,{scenes:[],status:'Writing substantive baselines and Qwen revisions'});}return;
   }
   if(url.pathname==='/api/production-hud'){
    if(req.method!=='GET'){send(405,{ok:false});return;}
    let monitor={};try{monitor=JSON.parse(await readFile(new URL('../.runtime/monitor/status.json',import.meta.url),'utf8'));}catch{}
    let revisions=null;try{const rows=JSON.parse(await readFile(new URL('../research/studies/art-direction-held-constant/baselines-40.json',import.meta.url),'utf8')).scenes;revisions={total:rows.length,drafted:rows.filter(s=>s.precisionPrompt).length,approved:rows.filter(s=>s.semanticReviewStatus==='approved').length,rejected:rows.filter(s=>s.semanticReviewStatus==='rejected').length};}catch{}
    send(200,productionHUD({flow:await flowCall(1),monitor,revisions}));return;
   }
   if(url.pathname.startsWith('/api/prompt-study/image/')){
    if(req.method!=='GET'){send(405,{ok:false});return;}
    const match=url.pathname.match(/^\/api\/prompt-study\/image\/([a-f0-9]{64})\/(pair-[0-9]{2})\/(left|right)\/([a-f0-9]{64})\.png$/);if(!match){send(404,{ok:false});return;}
    const [,id,pair,slot,hash]=match,dir=path.join(root,'runs',id),state=JSON.parse(await readFile(path.join(dir,'control.json'),'utf8')),pkg=JSON.parse(await readFile(path.join(dir,'package.json'),'utf8'));
    const arm=pkg.pairs.find(p=>p.id===pair)?.reviewSlots[slot],result=state.pairs[pair]?.arms[arm];if(result?.sha256!==hash){send(404,{ok:false});return;}
    const filename=await realpath(result.source),work=path.join(await realpath(root),'runs',id,'factory/work')+path.sep;if(filename!==result.source||!filename.startsWith(work)||(await stat(filename)).size>25_000_000){send(404,{ok:false});return;}
    const bytes=await readFile(filename);if(createHash('sha256').update(bytes).digest('hex')!==hash){send(404,{ok:false});return;}
    res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'private, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'}).end(bytes);return;
   }
   if(req.method==='POST'){
    let body='';for await(const part of req){body+=part;if(Buffer.byteLength(body)>6000)throw new Error();}
    const value=JSON.parse(body);
    if(value.action==='prepare'&&Object.keys(value).length===1){
     if(!saving)saving=call('prepare').finally(()=>{saving=null;});const prepared=await saving;send(200,{ok:true,prepared});return;
    }
    if(!/^[a-f0-9]{64}$/.test(value.package||'')||!['settings','guidance','pause','start','review','reconcile'].includes(value.action))throw new Error();
    const allowed={settings:['action','package','settings'],guidance:['action','package','guidance'],pause:['action','package'],start:['action','package'],reconcile:['action','package'],review:['action','package','pair','choice','note','continue']}[value.action];if(Object.keys(value).some(k=>!allowed.includes(k)))throw new Error();
    const selectedPackage=JSON.parse(await readFile(path.join(root,'runs',value.package,'package.json'),'utf8'));
    if(value.action==='settings'){
     if(selectedPackage.study!=='ADHC-001')throw new Error();
     const saved=await new Promise((resolve,reject)=>{const child=execFile('python3',['-B',settingsScript,'--root',root,'set'],{timeout:10000,maxBuffer:65536},(error,stdout)=>{if(error)return reject(error);try{resolve(JSON.parse(stdout));}catch(error){reject(error);}});child.stdin.end(JSON.stringify(value.settings));});
     feeds.clear();send(200,{ok:true,saved});return;
    }
    if(['pause','start'].includes(value.action)&&selectedPackage.study==='ADHC-001'){await daemonCall(value.action==='pause'?'pause':'resume');send(200,{ok:true,...await flowCall()});return;}
    const payload=value.action==='guidance'?value.guidance:value.action==='review'?{pair:value.pair,choice:value.choice,note:value.note||'',continue:selectedPackage.study==='ADHC-001'?false:value.continue??false}:null;
    const workflow=await control(value.action,value.package,payload);if(workflow.enabled&&['start','review'].includes(value.action))advance(value.package);
    feeds.clear();send(200,{ok:true,workflow});return;
   }
   const page=Number(url.searchParams.get('page')||1);if(!Number.isInteger(page)||page<1||page>100000)throw new Error();
   const [preview,status,productionFlow]=await Promise.all([call('preview'),call('status'),flowCall(page)]);
   const id=url.searchParams.get('package')||status.runs.find(run=>run.study==='ADHC-001')?.id||preview.id;if(!/^[a-f0-9]{64}$/.test(id))throw new Error();
   const exists=status.runs.some(run=>run.id===id);const workflow=productionFlow?.currentPackage||productionFlow?.totalPairs?productionFlow.workflow:(exists?await control('status',id):null);
   if(workflow?.continuous&&!workflow.package)workflow.package=productionFlow.pairs[0]?.package||null;
   if(workflow?.pairs.length&&!workflow.continuous){const state=JSON.parse(await readFile(path.join(root,'runs',id,'control.json'),'utf8'));const images=Object.values(state.pairs).flatMap(p=>Object.values(p.arms));if(!archivePending&&Date.now()-archiveAt>10000){archiveAt=Date.now();archivePending=Promise.resolve().then(archive).then(value=>{lastArchive=value;}).catch(()=>{}).finally(()=>{archivePending=null;});}const jobs=lastArchive?.jobs||[];const verified=images.filter(image=>jobs.some(job=>job.id===image.job&&job.sha256===image.sha256)).length;workflow.archive={state:verified===images.length?'verified':'pending',verified,total:images.length};}
   const productionPlan=JSON.parse(await readFile(new URL('../research/studies/art-direction-held-constant/plan.json',import.meta.url),'utf8'));
   const corpus=JSON.parse(await readFile(new URL('../research/studies/art-direction-held-constant/corpus.json',import.meta.url),'utf8'));
   const sceneId=productionFlow?.daemon?.sceneId||productionFlow?.pairs?.[0]?.sceneId;
   const fallbackScene=corpus.scenes.find(scene=>scene.id===sceneId)||corpus.scenes[0];
   const currentScenes=await Promise.all((productionFlow?.daemon?.lanes||[]).map(async lane=>{
    let scene=corpus.scenes.find(scene=>scene.id===lane.sceneId)||null;
    if(/^[a-f0-9]{64}$/.test(lane.currentPackage||''))try{const pkg=JSON.parse(await readFile(path.join(root,'runs',lane.currentPackage,'package.json'),'utf8'));scene=pkg.sourceCorpus?.scene||scene;}catch{}
    return {...lane,scene};
   }));
   const currentScene=currentScenes.find(row=>row.scene)?.scene||fallbackScene;
   let savedSettings;try{savedSettings=JSON.parse(await readFile(path.join(root,'settings.json'),'utf8'));}catch{savedSettings={settings:productionPlan.execution.frozenFirstPairSettings};}
   const productionStudy={id:productionPlan.id,revision:productionPlan.revision,sceneCount:corpus.scenes.length,precisionDrafts:corpus.scenes.filter(scene=>scene.precisionPrompt).length,startingImages:productionPlan.design.startingImages,firstScene:corpus.scenes[0],currentScene,currentScenes,settings:savedSettings.settings,settingsRevision:savedSettings.revision||null};
   send(200,{ok:true,preview,status,workflow,productionStudy,daemon:productionFlow?.daemon||null,productionFlow:productionFlow?{page:productionFlow.page,pages:productionFlow.pages,totalPairs:productionFlow.totalPairs}:null});
  })().catch(()=>{if(!res.headersSent)send(400,{ok:false,problem:'Study operation could not complete. Existing records are retained; no automatic replay.'});});
 });
}
