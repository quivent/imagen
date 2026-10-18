import {studioRedirect,studioPageRequest} from '../src/studio-route.js';
import {readWorkbenchRoute,workbenchURL} from '../src/workbench-route.js';
const world='/worlds/draa-valley/';
const worldDirectories=new Set([world,'/worlds/source-surface/']);
const legacy=new Set(['/worlds/draa-valley/iterations/','/worlds/draa-valley/algorithms/']);
export function worldPageRequest(raw){
 const url=new URL(raw,'http://localhost');
 return worldDirectories.has(url.pathname)?url.pathname+'index.html'+url.search:null;
}
export function workbenchRedirect(raw){
 const url=new URL(raw,'http://localhost'),path=url.pathname.replace(/\/index\.html$/,'/');
 if(legacy.has(path)||legacy.has(path+'/')||(url.pathname==='/'&&url.searchParams.get('tab')==='workbench')||url.pathname==='/workbench/'){
  const target=workbenchURL(url,readWorkbenchRoute(url));return target.pathname+target.search+target.hash;
 }
 return null;
}
export function installWorldPages(server){
 server.middlewares.use((req,res,next)=>{
  const redirect=workbenchRedirect(req.url)||studioRedirect(req.url);if(redirect){res.writeHead(308,{Location:redirect}).end();return;}
  const url=new URL(req.url,'http://localhost');
  if(worldDirectories.has(url.pathname+'/')){res.writeHead(308,{Location:url.pathname+'/'+url.search}).end();return;}
  const resolved=worldPageRequest(req.url)||studioPageRequest(req.url);if(resolved)req.url=resolved;
  next();
 });
}
