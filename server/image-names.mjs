import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../.runtime/image-names/', import.meta.url));
let observedAt = 0;
let pending;
let names = new Map();
let sceneNames = new Map();
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
 if(!sceneNames.size){try{const corpus=JSON.parse(await readFile(new URL('../research/studies/art-direction-held-constant/corpus.json',import.meta.url),'utf8'));sceneNames=new Map(corpus.scenes.map(scene=>[scene.id,scene]));}catch{}}
 return {...collection,jobs:collection.jobs.map(row=>{
  const name=names.get(row.profile+':'+row.id);
  if(name&&name.sha256===row.sha256)return {...row,title:name.title,titleSource:'prompt-metadata'};
  const match=/^adhc-[a-f0-9]{12}-(scene-[0-9]{3})$/.exec(row.scene||''),scene=match&&sceneNames.get(match[1]);
  if(scene){const condition=row.prompt===scene.precisionPrompt?'Precision Wording':row.prompt===scene.prompt?'Original Wording':null;return {...row,title:scene.name+(condition?' — '+condition:''),titleSource:'study-metadata'};}
  return row;
 })};
}
