import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../.runtime/image-names/', import.meta.url));
let observedAt = 0;
let pending;
let names = new Map();
async function refreshNames() {
 if (Date.now()-observedAt<2000) return;
 if (!pending) pending=Promise.all(['flux1-dev','flux2-dev-nf4'].map(async profile=>{
  try {
   const data=JSON.parse(await readFile(root+profile+'.json','utf8'));
   if(data.schema!==1||data.profile!==profile||!data.names||typeof data.names!=='object')return [];
   return Object.entries(data.names).filter(([id,item])=>/^[a-f0-9]{32}$/.test(id)&&typeof item.title==='string'&&item.title.trim().length>0&&item.title.length<=140&&/^[a-f0-9]{64}$/.test(item.sha256||'')).map(([id,item])=>[profile+':'+id,item]);
  }catch{return [];}
 })).then(parts=>{names=new Map(parts.flat());observedAt=Date.now();}).finally(()=>{pending=null;});
 await pending;
}
export async function withImageNames(collection) {
 await refreshNames();
 return {...collection,jobs:collection.jobs.map(row=>{
  const name=names.get(row.profile+':'+row.id);
  return name&&name.sha256===row.sha256?{...row,title:name.title,titleSource:'prompt-metadata'}:row;
 })};
}
