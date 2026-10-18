export const workbenchStudies=[{id:'glsl-worlds',label:'Image → World'},{id:'flux1-prompt-clarity',label:'Production → Precision'}];
export const productionStudies=[{id:'flux1-prompt-clarity',label:'Production → Precision'},{id:'production',label:'FLUX1 / FLUX2'}];
let current='flux1-prompt-clarity';
let productionCurrent='flux1-prompt-clarity';
try{const saved=localStorage.getItem('imagen:study');if(workbenchStudies.some(s=>s.id===saved))current=saved;if(location.pathname==='/workbench'&&new URLSearchParams(location.search).has('experiment'))current='glsl-worlds';}catch{}
try{const saved=localStorage.getItem('imagen:production-study');if(productionStudies.some(s=>s.id===saved))productionCurrent=saved;}catch{}
const listeners=new Set();
const productionListeners=new Set();
export const selectedStudy=()=>current;
export function selectStudy(id){if(!workbenchStudies.some(s=>s.id===id)||id===current)return;current=id;try{localStorage.setItem('imagen:study',id);}catch{}for(const listener of listeners)listener(id);}
export function observeStudy(listener){listeners.add(listener);return()=>listeners.delete(listener);}
export const selectedProductionStudy=()=>productionCurrent;
export function selectProductionStudy(id){if(!productionStudies.some(s=>s.id===id)||id===productionCurrent)return;productionCurrent=id;try{localStorage.setItem('imagen:production-study',id);}catch{}for(const listener of productionListeners)listener(id);}
export function observeProductionStudy(listener){productionListeners.add(listener);return()=>productionListeners.delete(listener);}
