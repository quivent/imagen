export function workflowPanel({workflow,post,el,disabled=false,drafts={},compact=false}){
 const section=el('section',null,'prompt-workflow'),labels={prepared:'Ready to start',checking:'Checking worker',running:'Generating the pair',pausing:'Finishing the current image',paused:'Paused','waiting-worker':'Waiting for the worker','waiting-review':'Ready for your review',complete:'Pilot complete','needs-attention':'Needs attention'};
 if(workflow.continuous){
  const signature=JSON.stringify([workflow.stage,workflow.enabled,workflow.runnerAlive,workflow.completedPairs,workflow.remainingPairs,workflow.pass,workflow.problem,compact,disabled]);
  if(drafts.continuousPanel?.signature===signature)return drafts.continuousPanel.element;
  const names={...labels,'waiting-draft':'Preparing next precision prompt',checking:'Preparing next scene',complete:'Continuing study'};
  section.append(el('h2',names[workflow.stage]||workflow.stage),el('p',workflow.completedPairs+' completed · '+workflow.remainingPairs+' remaining this pass · pass '+(workflow.pass||1)));
  if(workflow.problem)section.append(el('p',workflow.problem,'prompt-caveat'));
  if(!compact){const actions=el('div',null,'prompt-actions'),button=el('button',workflow.enabled?'Pause generation':'Resume generation');button.type='button';button.disabled=disabled;button.onclick=()=>void post({action:workflow.enabled?'pause':'start'});actions.append(button,el('span','Reviews are optional. Generation continues independently.'));section.append(actions);}
  drafts.continuousPanel={signature,element:section};return section;
 }
 const corpus=workflow.study==='ADHC-001',armLabel=arm=>arm==='A'?(corpus?'Production':'Original'):arm==='B'?(corpus?'Precision':'Precise'):arm;
 section.append(el('h2',labels[workflow.stage]||workflow.stage),el('p',workflow.completedPairs+' pairs completed · '+workflow.remainingPairs+' pairs remaining'));
 if(workflow.archive?.state==='verified')section.append(el('p','Saved to R2.','prompt-caveat'));
 if(workflow.problem)section.append(el('p',workflow.problem,'prompt-caveat'));
 if(workflow.report){const report=workflow.report,summary=el('section');summary.append(el('h3','Pilot report'),el('p',report.reviewedPairs+' pairs reviewed · '+armLabel('A')+' '+report.preferences.A+' · '+armLabel('B')+' '+report.preferences.B+' · Ties '+report.preferences.tie+' · Neither '+report.preferences.neither),el('p','Median generation time: '+armLabel('A')+' '+(report.medianWorkerSeconds.A?.toFixed(3)??'—')+' s · '+armLabel('B')+' '+(report.medianWorkerSeconds.B?.toFixed(3)??'—')+' s'),el('p',report.interpretation,'prompt-caveat'));section.append(summary);}
 if(compact)return section;
 const action=(label,value)=>{const b=el('button',label);b.type='button';b.disabled=disabled;b.onclick=()=>void post(value);return b;};
 const source=JSON.stringify(workflow.guidance);if(!drafts.guidanceDirty&&drafts.guidanceSource!==source){drafts.guidance={...workflow.guidance};drafts.guidanceSource=source;}
 const guidance=el('form'),draft=drafts.guidance||(drafts.guidance={...workflow.guidance});
 for(const [key,label] of [['maxPairs','Pair limit'],['reviewEvery','Review every']]){
  const group=el('fieldset');group.append(el('legend',label));for(const n of [1,2,3].filter(n=>n<=(workflow.plannedPairs||3))){const b=action(n+' '+(n===1?'pair':'pairs'),{});b.setAttribute('aria-pressed',String(draft[key]===n));b.onclick=()=>{drafts.guidanceDirty=true;draft[key]=n;for(const child of group.querySelectorAll('button'))child.setAttribute('aria-pressed',String(child===b));};group.append(b);}guidance.append(group);
 }
 const focus=el('label','Light guidance'),area=el('textarea');area.value=draft.focus;area.maxLength=2000;area.rows=2;area.oninput=()=>{drafts.guidanceDirty=true;draft.focus=area.value;};area.disabled=disabled;area.placeholder='What should we pay attention to?';focus.append(area);guidance.append(focus);
 const save=el('button','Save guidance');save.type='submit';save.disabled=disabled;guidance.append(save);guidance.onsubmit=event=>{event.preventDefault();void post({action:'guidance',guidance:{...draft,focus:area.value}});};section.append(guidance,el('p','Guidance sets the review focus and execution limits. It does not rewrite either frozen prompt.','prompt-caveat'));
 const actions=el('div',null,'prompt-actions');
 if(['prepared','paused','complete'].includes(workflow.stage)&&workflow.remainingPairs>0)actions.append(action(workflow.completedPairs?'Continue pilot':'Start pilot',{action:'start'}));
 if(workflow.enabled||workflow.runnerAlive)actions.append(action('Pause before next image',{action:'pause'}));
 if(workflow.stage==='needs-attention')actions.append(action('Reconcile saved results',{action:'reconcile'}));
 actions.append(el('span',corpus?'One GPU · one image at a time · production then precision for each scene.':'At most six images · one worker · a 20-minute window for starting images. Prompts stay frozen.'));section.append(actions);
 if(workflow.preflight?.tokens){const details=el('details');details.append(el('summary','Conditioning check'));for(const [name,counts] of Object.entries(workflow.preflight.tokens))details.append(el('p',name+': A '+counts.A+', B '+counts.B+' · limit '+counts.limit));details.append(el('p',workflow.preflight.clipPolicy));section.append(details);}
 return section;
}
export function reviewPairs({workflow,post,el,disabled=false,stream=false,drafts={}}){
 const section=drafts.pairSection||(drafts.pairSection=el('section',null,'prompt-pairs'));
 const cache=drafts.pairCards||(drafts.pairCards=new Map()),pairs=workflow?.pairs||[],nodes=[];
 if(!pairs.length){
  const key=String(Boolean(workflow?.enabled||workflow?.runnerAlive));
  if(drafts.emptyKey!==key||cache.size){section.replaceChildren(el('p',key==='true'?'The next completed pair will appear here automatically.':'Completed pairs appear here. Generation is managed in Controls.','prompt-summary'));drafts.emptyKey=key;}
  cache.clear();return section;
 }
 drafts.emptyKey=null;
 for(const pair of pairs){
  const canContinue=!workflow.continuous&&!workflow.pairs.some(other=>other.id!==pair.id&&!other.review);
  const signature=JSON.stringify([pair,disabled,stream,workflow.study,workflow.continuous,canContinue]);
  const existing=cache.get(pair.id);
  if(existing?.signature===signature){nodes.push(existing.card);continue;}
  const card=el('article');card.append(el('h2',pair.sceneName||pair.id));
  if(pair.promptRevision&&pair.promptRevision!=='historical-production')card.append(el('p','Assistant baseline → Qwen revision','prompt-summary'));
  const imageSignature=JSON.stringify(['left','right'].map(slot=>pair.images[slot].url));
  const grid=existing?.imageSignature===imageSignature?existing.grid:el('div',null,'prompt-arms');
  if(grid!==existing?.grid){
   for(const slot of ['left','right']){const figure=el('figure'),img=el('img');img.src=pair.images[slot].url;img.alt=slot==='left'?'Left candidate':'Right candidate';img.width=512;img.height=512;img.decoding='async';img.loading='lazy';figure.append(img,el('figcaption'));grid.append(figure);}
  }
  for(let i=0;i<2;i++){
   const slot=['left','right'][i],arm=pair.revealedArms?.[slot],label=workflow.study==='ADHC-001'?(arm==='A'?'Production':arm==='B'?'Precision':arm):arm;
   const seconds=pair.images[slot].seconds,caption=pair.revealedArms?slot+' · '+label+(Number.isFinite(seconds)?' · '+seconds.toFixed(3)+' s':''):slot==='left'?'Left':'Right';
   grid.children[i].children[1].textContent=caption;
  }
  card.append(grid);
  if(!stream&&pair.slotPrompts&&Object.keys(pair.slotPrompts).length){
   const prompts=el('div',null,'prompt-arms prompt-pair-texts');
   for(const slot of ['left','right']){
    const frozen=pair.slotPrompts[slot],column=el('section');
    const label=frozen?.author==='Qwen'?'Qwen revision':frozen?.author==='Imagen assistant'?'Assistant baseline':frozen?.arm==='A'?'Production prompt':'Precision prompt';
    column.append(el('h3',label),el('p',frozen?.text||'Saved prompt unavailable.','prompt-frozen-text'));prompts.append(column);
   }
   card.append(prompts);
  }
  if(!pair.review&&!stream){
   const draft=(drafts.reviews||={})[pair.id]||((drafts.reviews||={})[pair.id]={choice:null,note:''});let choice=draft.choice;
   const options=el('div',null,'prompt-actions');for(const [value,label] of [['left','Left'],['right','Right'],['tie','Tie'],['neither','Neither']]){const button=el('button',label);button.type='button';button.disabled=disabled;button.setAttribute('aria-pressed',String(choice===value));button.onclick=()=>{choice=value;draft.choice=value;for(const sibling of options.children)sibling.setAttribute('aria-pressed',String(sibling===button));};options.append(button);}card.append(options);
   const note=el('textarea');note.rows=2;note.value=draft.note;note.oninput=()=>{draft.note=note.value;};note.maxLength=2000;note.placeholder='Optional notes';note.setAttribute('aria-label','Review notes for '+pair.id);note.disabled=disabled;card.append(note);
   const actions=el('div',null,'prompt-actions');
   const choices=workflow.continuous?[[false,'Save choice']]:[[false,'Save choice & pause'],[true,'Save choice & continue']];
   for(const [resume,label] of choices){const button=el('button',label);button.type='button';button.disabled=disabled||(resume&&!canContinue);button.onclick=()=>{if(!choice){note.placeholder='Choose Left, Right, Tie or Neither first.';return;}void post({action:'review',package:pair.package||workflow.package,pair:pair.requestPair||pair.id,choice,note:note.value,continue:resume});};actions.append(button);}card.append(actions);
  }else if(pair.review)card.append(el('p','Saved choice: '+pair.review.choice+(pair.review.note?' · '+pair.review.note:'')));
  cache.set(pair.id,{card,grid,signature,imageSignature});nodes.push(card);
 }
 for(let i=0;i<nodes.length;i++)if(section.children[i]!==nodes[i])section.insertBefore(nodes[i],section.children[i]||null);
 const retained=new Set(nodes);for(const child of [...section.children])if(!retained.has(child))child.remove();
 const ids=new Set(pairs.map(pair=>pair.id));for(const key of cache.keys())if(!ids.has(key))cache.delete(key);
 return section;
}
