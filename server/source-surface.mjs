import {readFile,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../.runtime/worlds/',import.meta.url));
export function installSourceSurface(server){
 server.middlewares.use(async(req,res,next)=>{
  const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/api/source-surface/'))return next();
  res.setHeader('X-Content-Type-Options','nosniff');
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
  try{
   const match=url.pathname.match(/^\/api\/source-surface\/([a-f0-9]{64})\.bin$/);if(!match)throw new Error();
   const records=JSON.parse(await readFile(path.join(root,'source-surfaces.json'),'utf8')),relative=records[match[1]];
   if(!/^method3\/[A-Za-z0-9_-]+\/surface\.bin$/.test(relative||''))throw new Error();
   const filename=path.resolve(root,relative);if(await realpath(filename)!==filename)throw new Error();
   const body=await readFile(filename);
   if(body.length>25000000||body.subarray(0,8).toString()!=='IMGSURF1'||createHash('sha256').update(body).digest('hex')!==match[1])throw new Error();
   res.setHeader('Cache-Control','public, max-age=31536000, immutable');res.setHeader('ETag','"'+match[1]+'"');
   if(req.headers['if-none-match']==='"'+match[1]+'"'){res.writeHead(304).end();return;}
   res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':body.length});res.end(req.method==='HEAD'?undefined:body);
  }catch{res.writeHead(404).end();}
 });
}
