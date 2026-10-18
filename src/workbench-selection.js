import {readWorkbenchRoute} from './workbench-route.js';
let selection={studyId:null,method:1};
try{selection={...selection,...readWorkbenchRoute('http://localhost/workbench?'+(localStorage.getItem('imagen:experiment-selection')||''))};}catch{}
const listeners=new Set();
export const fittingSelection=()=>({...selection});
export function setFittingSelection(change){selection={...selection,...change};for(const listener of listeners)listener(fittingSelection());}
export function observeFittingSelection(listener){listeners.add(listener);return()=>listeners.delete(listener);}
