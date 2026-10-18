import {selectedStudy,observeStudy} from './study-context.js';
import {mountPromptStudy} from './prompt-study.js';
export function mountStudyPanel({root,isActive=()=>true,kind='experiment'}){
 let active=false,disposed=false,controller=null,version=0,current=null;
 async function mount(){
  const id=selectedStudy();if(id===current){controller?.setActive(active);return;}current=id;const ticket=++version;controller?.destroy();controller=null;root.replaceChildren();
  if(id==='flux1-prompt-clarity'){controller=mountPromptStudy({root,isActive,view:kind});controller.setActive(active);return;}
  try{
   const [module,markup]=kind==='controls'?await Promise.all([import('./workbench-controls-tab.js'),Promise.resolve({default:''})]):await Promise.all([import('./workbench.js'),import('./workbench-panel.html?raw')]);
   if(disposed||ticket!==version)return;root.innerHTML=markup.default;
   controller=(kind==='controls'?module.mountWorkbenchControlsTab:module.mountWorkbench)({root,isActive});controller.setActive(active);
  }catch{if(!disposed&&ticket===version)root.textContent='This study could not load. Switch studies to retry.';}
 }
 const release=observeStudy(()=>{if(active)void mount();else{version++;controller?.destroy();controller=null;current=null;root.replaceChildren();}});
 return {setActive(value){active=value;if(value)void mount();else controller?.setActive(false);},destroy(){disposed=true;version++;release();controller?.destroy();}};
}
