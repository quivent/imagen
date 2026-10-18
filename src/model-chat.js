import './model-chat.css';
const models={qwen:{name:'Qwen',purpose:'Text and code · qwen-precision'},pixtral:{name:'Pixtral',purpose:'Text and code · pixtral-critic'}};
export function mountModelChat({root,model,isActive=()=>true,storage=globalThis.localStorage,fetcher=globalThis.fetch.bind(globalThis)}){
 if(!Object.hasOwn(models,model))throw Error('Unknown chat model');
 const document=root.ownerDocument,key='imagen:model-chat:'+model,el=(tag,text,cls)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(cls)node.className=cls;return node;};
 let history=[],disposed=false,controller=null,request=0,active=false;
 try{const saved=JSON.parse(storage.getItem(key)||'[]');if(Array.isArray(saved))history=saved.filter(row=>['user','assistant'].includes(row?.role)&&typeof row.content==='string').slice(-80).map(row=>({role:row.role,content:row.content.slice(0,64000)}));}catch{}
 const box=el('section',null,'model-chat'),header=el('header'),title=el('h1',models[model].name),subtitle=el('p',models[model].purpose,'model-chat-subtitle'),clear=el('button','New conversation');clear.type='button';header.append(title,subtitle,clear);
 const log=el('div',null,'model-chat-log');log.setAttribute('role','log');log.setAttribute('aria-label',models[model].name+' conversation');log.setAttribute('aria-live','polite');
 const form=el('form',null,'model-chat-composer'),input=el('textarea');input.rows=4;input.maxLength=6000;input.placeholder='Ask '+models[model].name+'…';input.setAttribute('aria-label','Message '+models[model].name);
 const actions=el('div',null,'model-chat-actions'),send=el('button','Send'),stop=el('button','Stop'),status=el('p','Your conversation is saved locally on this device.','model-chat-status');send.type='submit';stop.type='button';stop.disabled=true;status.setAttribute('role','status');actions.append(send,stop,status);form.append(input,actions);box.append(header,log,form);root.replaceChildren(box);
 function persist(){try{storage.setItem(key,JSON.stringify(history.filter(row=>row.content.trim()).slice(-80)));}catch{status.textContent='Local storage is full. This conversation remains available until the view closes.';}}
 function message(row){const article=el('article',null,'model-chat-message');article.dataset.role=row.role;article.append(el('h2',row.role==='user'?'You':models[model].name),el('pre',row.content||'Waiting for the model…'));log.append(article);return article.lastChild;}
 function render(){log.replaceChildren();for(const row of history)message(row);if(!history.length)log.append(el('p','Start a conversation with '+models[model].name+'. Text and code stay as text; nothing is executed.','model-chat-empty'));log.scrollTop=log.scrollHeight;}
 function busy(value){send.disabled=value;stop.disabled=!value;clear.disabled=value;input.disabled=value;form.setAttribute('aria-busy',String(value));}
 function recentMessages(){let length=0;const rows=[];for(const row of [...history].reverse()){if(!row.content.trim())continue;if(rows.length&&length+row.content.length>7000)break;rows.unshift({role:row.role,content:row.content});length+=row.content.length;if(rows.length===12)break;}while(rows[0]?.role==='assistant')rows.shift();const merged=[];for(const row of rows){if(merged.at(-1)?.role===row.role)merged.at(-1).content+='\n\n'+row.content;else merged.push(row);}return merged;}
 const stopped=()=>{request++;controller?.abort();controller=null;if(history.at(-1)?.role==='assistant'&&!history.at(-1).content){history.pop();render();}busy(false);status.textContent='Stopped. Any partial reply stays in this conversation.';persist();};stop.onclick=stopped;
 clear.onclick=()=>{if(controller)return;history=[];persist();render();status.textContent='New conversation. Saved history for the other model is unchanged.';input.focus();};
 form.onsubmit=async event=>{
  event.preventDefault();const text=input.value.trim();if(!text||controller||disposed)return;
  const ticket=++request;controller=new AbortController();const signal=controller.signal;history.push({role:'user',content:text});input.value='';render();const payload=recentMessages(),answer={role:'assistant',content:''};history.push(answer);const output=message(answer);log.scrollTop=log.scrollHeight;busy(true);status.textContent='Connecting to '+models[model].name+'…';persist();
  try{
   const session=await fetcher('/api/workstation-session',{method:'POST',credentials:'same-origin',signal});if(!session.ok)throw Error('The local workstation session could not be established.');
   const response=await fetcher('/api/model-chat/'+model,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:payload}),signal});
   if(!response.ok){let problem;try{problem=(await response.json()).error;}catch{}throw Error(problem||'The model is unavailable. Please try again shortly.');}
   if(!response.body)throw Error('Streaming is unavailable in this app.');
   const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',done=false;
   while(true){const part=await reader.read();if(ticket!==request)break;pending+=decoder.decode(part.value||new Uint8Array(),{stream:!part.done});let at;while((at=pending.indexOf('\n'))!==-1){const line=pending.slice(0,at);pending=pending.slice(at+1);if(!line.trim())continue;const value=JSON.parse(line);if(value.error)throw Error(value.error);if(typeof value.delta==='string'){const follow=log.scrollHeight-log.scrollTop-log.clientHeight<80;answer.content+=value.delta;output.textContent=answer.content;if(follow)log.scrollTop=log.scrollHeight;status.textContent=models[model].name+' is replying…';}if(value.done)done=true;}if(part.done)break;}
   if(ticket===request){if(!done)throw Error('The connection ended before the reply completed.');status.textContent='Reply complete · saved locally.';}
  }catch(error){if(ticket===request&&error.name!=='AbortError'){status.textContent=error.message||'The model is unavailable.';if(!answer.content){history=history.filter(row=>row!==answer);output.parentNode?.remove();}}}
  finally{if(ticket===request){controller=null;busy(false);persist();if(active&&isActive())input.focus();}}
 };
 input.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();form.requestSubmit();}});
 const visibility=()=>{if(document.hidden&&controller)stopped();};document.addEventListener('visibilitychange',visibility);
 render();return {setActive(value){active=value;if(!value&&controller)stopped();},destroy(){disposed=true;request++;controller?.abort();controller=null;persist();document.removeEventListener('visibilitychange',visibility);form.onsubmit=null;stop.onclick=null;clear.onclick=null;}};
}
