import './workbench.css';
import './workbench-results.css';
import fittingMarkup from './workbench-fitting-controls.html?raw';
import {setFittingSelection} from './workbench-selection.js';
import resultsMarkup from './workbench-results.html?raw';
import { mountWorkbenchResults } from './workbench-results.js';
import { mountWorkbenchControls } from './workbench-controls.js';
export function mountWorkbench({root,isActive=()=>true}){
 const $=id=>root.querySelector('#wb-'+id);
 $('output-panel').innerHTML=resultsMarkup;
 root.querySelector('.wb-control-content').innerHTML=fittingMarkup;
 const controls=mountWorkbenchControls({root,isActive:()=>false});
 const results=mountWorkbenchResults({root:$('output-panel'),isActive,onMethodChange:method=>{controls.setMethod(method);setFittingSelection({method});},onStudyChange:study=>{controls.setStudy(study);if(study)setFittingSelection({studyId:study.id});}});
 let active=isActive(),open=!matchMedia('(max-width:950px)').matches;
 try{const saved=sessionStorage.getItem('imagen:workbench-controls');if(saved!==null)open=saved==='true';}catch{}
 function update(){
  $('control-panel').hidden=!open;$('controls-toggle').setAttribute('aria-checked',String(open));root.querySelector('.wb-layout').classList.toggle('controls-collapsed',!open);
  controls.setActive(active&&open);try{sessionStorage.setItem('imagen:workbench-controls',String(open));}catch{}
 }
 $('controls-toggle').onclick=()=>{open=!open;update();};
 $('controls-close').onclick=()=>{open=false;update();$('controls-toggle').focus();};
 update();
 return {setActive(value){active=value;results.setActive(value);controls.setActive(value&&open);},destroy(){results.destroy();controls.destroy();}};
}
