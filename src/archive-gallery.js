import {artworkImageURL,installImageCache} from './image-cache.js';
import './archive-gallery.css';
export function mountArchiveGallery({root,isActive=()=>true,defaultCollection='production-precision'}){
 installImageCache();
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 const button=(label,fn)=>{const n=el('button',label);n.type='button';n.onclick=fn;return n;};
 let collection=defaultCollection==='all'?'all':'production-precision';
 let active=false,disposed=false,profile='',history=[null],data=null,busy=false,requestId=0,request=null;
 let displayedHistory=[null],displayedProfile='',displayedCollection=collection;
 const cards=new Map(),box=el('div',null,'archive-gallery'),heading=el('header'),brand=el('p','IMAGEN','archive-brand');heading.append(brand,el('h1','Gallery'));
 const collections=el('nav',null,'archive-filters');collections.setAttribute('aria-label','Artwork collections');
 for(const [id,label] of [['production-precision','Production → Precision'],['all','All artworks']]){const b=button(label,()=>{if(collection===id)return;collection=id;history=[null];void load(true);});b.dataset.collection=id;collections.append(b);}
 const filters=el('nav',null,'archive-filters');filters.setAttribute('aria-label','Artwork models');
 for(const [id,label] of [['','All models'],['flux1-dev','FLUX.1'],['flux2-dev-nf4','FLUX.2']]){const b=button(label,()=>{if(profile===id)return;profile=id;history=[null];void load(true);});b.dataset.profile=id;filters.append(b);}
 const grid=el('div',null,'archive-grid'),status=el('p','Loading the collection…','archive-status');status.setAttribute('role','status');
 const nav=el('nav',null,'archive-pagination');nav.setAttribute('aria-label','Gallery pages');
 const newer=button('Newer',()=>{if(history.length>1){history.pop();void load(true);}}),latest=button('Latest',()=>{history=[null];void load(true);}),older=button('Older',()=>{if(data?.nextCursor){history.push(data.nextCursor);void load(true);}}),position=el('span');nav.append(newer,latest,older,position);
 const viewer=el('dialog',null,'archive-viewer'),close=button('Close',()=>{viewer.close();image.removeAttribute('src');}),image=el('img'),title=el('h2');viewer.append(close,image,title);viewer.onclose=()=>image.removeAttribute('src');viewer.onclick=e=>{if(e.target===viewer)viewer.close();};
 box.append(heading,collections,filters,status,grid,nav,viewer);root.append(box);
 function update(){for(const b of collections.children)b.setAttribute('aria-pressed',String(b.dataset.collection===collection));for(const b of filters.children)b.setAttribute('aria-pressed',String(b.dataset.profile===profile));newer.disabled=busy||history.length===1;latest.disabled=busy||history.length===1;older.disabled=busy||!data?.nextCursor;position.textContent='Page '+history.length+(data?' · '+data.totalJobs+' works':'');grid.setAttribute('aria-busy',String(busy));}
 function render(){
  const keep=new Set(),nodes=[];
  for(const row of data.jobs){
   if(!['flux1-dev','flux2-dev-nf4'].includes(row.profile)||!/^[a-f0-9]{64}$/.test(row.sha256||''))continue;
   const url=artworkImageURL(row.imageUrl,row.sha256);if(!url||new URL(url).pathname!=='/api/gallery/image')continue;
   const id=row.profile+':'+row.id+':'+row.sha256;keep.add(id);let entry=cards.get(id);
   if(!entry){const card=el('figure',null,'archive-card'),open=button('',()=>{}),img=el('img');img.src=url;img.loading='lazy';img.decoding='async';img.width=Number.isFinite(row.width)?row.width:512;img.height=Number.isFinite(row.height)?row.height:512;open.append(img);const caption=el('figcaption');card.append(open,caption);entry={card,open,img,caption};cards.set(id,entry);}
   const name=row.title||row.scene||'Untitled work';entry.img.alt=name;entry.open.setAttribute('aria-label','View '+name);entry.caption.textContent=name;entry.open.onclick=()=>{title.textContent=name;image.alt=name;image.src=url;viewer.showModal();};nodes.push(entry.card);
  }
  for(let i=0;i<nodes.length;i++)if(grid.children[i]!==nodes[i])grid.insertBefore(nodes[i],grid.children[i]||null);
  for(const child of [...grid.children])if(!nodes.includes(child))child.remove();
  for(const [key] of cards)if(!keep.has(key))cards.delete(key);
  status.textContent=data.jobs.length?(history.length===1?'Newest works · updates appear automatically.':'Earlier works · return to Latest for new arrivals.'):(collection==='production-precision'?'No Production → Precision images have arrived in the archive yet. All artworks contains the earlier collection.':'No works in this collection yet.');update();
 }
 async function load(replace=false){
  if(disposed||!active||document.hidden||!isActive()||busy&&!replace)return;
  request?.abort();const ticket=++requestId;request=new AbortController();const controller=request,timeout=setTimeout(()=>controller.abort(),20000);busy=true;update();
  const params=new URLSearchParams({limit:'24',collection});if(profile)params.set('profile',profile);if(history.at(-1))params.set('cursor',history.at(-1));
  try{const response=await fetch('/api/gallery?'+params,{cache:'no-store',signal:request.signal});if(!response.ok)throw new Error();const value=await response.json();if(!value.ok||!Array.isArray(value.jobs)||!Number.isInteger(value.totalJobs))throw new Error();if(disposed||ticket!==requestId)return;data=value;displayedHistory=[...history];displayedProfile=profile;displayedCollection=collection;render();}
  catch(error){if(!disposed&&ticket===requestId){if(data){profile=displayedProfile;collection=displayedCollection;history=[...displayedHistory];}status.textContent='The collection is reconnecting. Works already loaded stay here.';}}
  finally{clearTimeout(timeout);if(ticket===requestId){busy=false;update();}}
 }
 const visibility=()=>{if(!document.hidden&&active&&history.length===1)void load();};document.addEventListener('visibilitychange',visibility);
 const timer=setInterval(()=>{if(history.length===1)void load();},15000);update();
 return {setActive(value){active=value;if(value)void load();else{requestId++;request?.abort();busy=false;if(viewer.open)viewer.close();}},destroy(){disposed=true;active=false;request?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visibility);if(viewer.open)viewer.close();image.removeAttribute('src');cards.clear();}};
}
