// One editable parameter template shared by the production studies.
export function createControlChoice({document=globalThis.document,key,label,values,suffix='',onChoose}){
 const fieldset=document.createElement('fieldset');fieldset.className='choice-field';
 const legend=document.createElement('legend');legend.textContent=label;
 const group=document.createElement('div');group.className='choice-buttons';const buttons=[];
 for(const value of values){const button=document.createElement('button');button.type='button';button.textContent=String(value)+suffix;button.setAttribute('data-choice-field',key);button.setAttribute('data-choice-value',String(value));button.setAttribute('aria-pressed','false');button.onclick=()=>{if(!button.disabled)onChoose(value);};group.append(button);buttons.push({button,value});}
 fieldset.append(legend,group);
 return {element:fieldset,update(selected,disabled=false){for(const {button,value} of buttons){button.setAttribute('aria-pressed',String(value===selected));button.disabled=disabled;}}};
}
