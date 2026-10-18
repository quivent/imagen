import './prompt-comparison.css';

export function promptWordDiff(before,after){
 const a=before.match(/\S+\s*/g)||[],b=after.match(/\S+\s*/g)||[];
 const same=(x,y)=>x.trim()===y.trim(),table=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));
 for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)table[i][j]=same(a[i],b[j])?1+table[i+1][j+1]:Math.max(table[i+1][j],table[i][j+1]);
 const left=[],right=[];let i=0,j=0;
 while(i<a.length||j<b.length){
  if(i<a.length&&j<b.length&&same(a[i],b[j])){left.push({text:a[i++],changed:false});right.push({text:b[j++],changed:false});}
  else if(i<a.length&&(j===b.length||table[i+1][j]>=table[i][j+1]))left.push({text:a[i++],changed:true});
  else right.push({text:b[j++],changed:true});
 }
 return {left,right,removed:left.filter(x=>x.changed).map(x=>x.text).join('').trim(),added:right.filter(x=>x.changed).map(x=>x.text).join('').trim()};
}

export function mountPromptComparison({root,isActive=()=>true,endpoint='/api/prompt-comparison',fetch:request=globalThis.fetch,document=globalThis.document}){
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 let active=false,disposed=false,controller=null,scenes=[],selected=null,page=0,last='',bodySignature='';
 const box=el('section',null,'prompt-comparison'),heading=el('h1','Prompts'),progress=el('p',null,'prompt-comparison-meta'),nav=el('nav',null,'prompt-comparison-scenes'),pager=el('div',null,'prompt-comparison-pager'),previous=el('button','Previous scenes'),next=el('button','Next scenes'),pageLabel=el('span'),body=el('div'),status=el('p',null,'prompt-comparison-meta'),retry=el('button','Retry');
 nav.setAttribute('aria-label','Choose scene');status.setAttribute('role','status');for(const button of [previous,next,retry])button.type='button';retry.hidden=true;
 pager.append(previous,pageLabel,next);box.append(heading,progress,nav,pager,body,status,retry);root.replaceChildren(box);
 const counts=(tokens)=>tokens&&Number.isInteger(tokens.clip)&&Number.isInteger(tokens.t5)?'CLIP '+tokens.clip+' / 77 · T5 '+tokens.t5+' / 512':'Token counts pending';
 function render(){
  const pages=Math.max(1,Math.ceil(scenes.length/10));page=Math.min(page,pages-1);previous.disabled=page===0;next.disabled=page>=pages-1;pageLabel.textContent=(page+1)+' / '+pages;
  const revised=scenes.filter(s=>s.precisionAuthor==='Qwen'&&s.precisionPrompt).length;
  const approved=scenes.filter(s=>s.semanticReviewStatus==='approved').length;
  progress.textContent=scenes.length+' assistant baselines · '+revised+' Qwen revisions · '+approved+' independently approved · CLIP and T5 both receive text; counts include special tokens.';
  if(!selected&&scenes.length)selected=scenes[0].id;
  const buttons=scenes.slice(page*10,page*10+10).map(scene=>{const b=el('button',scene.name);b.type='button';b.setAttribute('aria-pressed',String(scene.id===selected));b.onclick=()=>{selected=scene.id;render();};return b;});nav.replaceChildren(...buttons);
  const scene=scenes.find(s=>s.id===selected)||scenes[0];if(!scene){bodySignature='';body.replaceChildren(el('p','Writing substantive baselines and preparing Qwen revisions.'));return;}selected=scene.id;
  const signature=JSON.stringify(scene);if(signature===bodySignature)return;bodySignature=signature;
  const current=el('section'),title=el('h2',scene.name),columns=el('div',null,'prompt-comparison-columns');current.append(title);
  const revisedPrompt=scene.precisionPrompt||scene.historicalPrecisionPrompt||'',isQwen=Boolean(scene.precisionPrompt&&scene.precisionAuthor==='Qwen');
  const diff=promptWordDiff(scene.baselinePrompt||'',revisedPrompt);
  current.append(el('p',isQwen?(scene.semanticReviewStatus==='rejected'?'Revision needs another Qwen pass after independent review.':'Qwen revised this exact assistant baseline. Meaning preservation '+(scene.semanticReviewStatus==='approved'?'reviewed.':'awaits independent review.')):'Qwen revision pending for this assistant baseline.','prompt-comparison-meta'));
  for(const [label,text,tokens,segments,tag] of [['Assistant baseline',scene.baselinePrompt,scene.baselineTokens,diff.left,'del'],[isQwen?'Qwen revision':'Previous precision · Qwen revision pending',revisedPrompt,isQwen?scene.precisionTokens:null,diff.right,'ins']]){
   const column=el('article'),prompt=el('p',null,'prompt-comparison-text');column.append(el('h3',label),el('p',counts(tokens),'prompt-comparison-meta'));
   if(text)for(const part of segments)prompt.append(el(part.changed?tag:'span',part.text));else prompt.textContent='Qwen has not revised this baseline yet.';
   column.append(prompt);columns.append(column);
  }
  current.append(columns,el('p','Highlighted removals and additions are computed directly from the two texts. Wording changes can also lose or add meaning.','prompt-comparison-meta'));
  if(isQwen){const changes=el('div',null,'prompt-comparison-changes');changes.append(el('p','Removed wording: '+(diff.removed||'None')),el('p','Added wording: '+(diff.added||'None')));current.append(changes);
   if(scene.semanticReview&&scene.semanticReviewStatus!=='unreviewed'){const audit=el('details');audit.append(el('summary','Independent content audit'),el('p',scene.semanticReview.assessment||''));for(const [label,items] of [['Added art direction',scene.semanticReview.addedArtDirection],['Lost baseline content',scene.semanticReview.lostBaselineContent],['Invented subjects',scene.semanticReview.inventedSubjects]])audit.append(el('p',label+': '+(items?.length?items.join('; '):'None identified')));current.append(audit);}
   const reported=scene.changes||scene.qwenChanges;if(reported){const details=el('details');details.append(el('summary','Qwen’s change claims · unverified'),el('p',typeof reported==='string'?reported:JSON.stringify(reported,null,2)),el('p','Possible lost content: '+(scene.qwenPossibleLostContent?.length?scene.qwenPossibleLostContent.join('; '):'None claimed by Qwen')),el('p','Possible added content: '+(scene.qwenPossibleAddedContent?.length?scene.qwenPossibleAddedContent.join('; '):'None claimed by Qwen')));current.append(details);}}
  const source=el('details');source.append(el('summary','Preserved original source prompt'),el('p',scene.sourcePrompt||'Source unavailable.'));current.append(source);body.replaceChildren(current);
 }
 previous.onclick=()=>{page--;selected=scenes[page*10]?.id;render();};next.onclick=()=>{page++;selected=scenes[page*10]?.id;render();};retry.onclick=()=>void load();
 async function load(){
  if(disposed||!active||document.hidden||!isActive()||controller)return;
  const current=new AbortController();controller=current;const timeout=setTimeout(()=>current.abort(),20000);
  try{const response=await request(endpoint,{cache:'no-store',signal:current.signal});if(!response.ok)throw new Error('Unavailable');const payload=await response.json();if(disposed||current.signal.aborted)return;const signature=JSON.stringify(payload);if(signature!==last){last=signature;scenes=payload.scenes||[];render();}status.textContent=payload.status||'';retry.hidden=true;}
  catch(error){if(!disposed&&!current.signal.aborted){status.textContent='Prompt comparison unavailable. Existing texts are retained.';retry.hidden=false;}}
  finally{clearTimeout(timeout);if(controller===current)controller=null;}
 }
 const visibility=()=>{if(document.hidden){controller?.abort();controller=null;}else void load();};document.addEventListener('visibilitychange',visibility);const timer=setInterval(()=>void load(),5000);render();
 return {setActive(value){active=value;if(value)void load();else{controller?.abort();controller=null;}},destroy(){disposed=true;active=false;controller?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visibility);}};
}
