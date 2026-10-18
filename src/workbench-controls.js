export function mountWorkbenchControls({root,isActive=()=>true,prefix='wb-'}){
const $=id=>root.querySelector('#'+prefix+id);
let panelVisible=isActive(),active=panelVisible,selectedControlMethod=1,disposed=false;
const methods=['Pixel fitting','Contour fitting','Structure search','3D hypotheses','Neural field'];
let selectedStudy=null,activeStudy=null;
function context(){
 const archived=selectedStudy&&activeStudy&&selectedStudy.id!==activeStudy;
 for(const id of ['settings','live','scoring'])$(id).hidden=selectedControlMethod!==1||archived;
 $('method-note').hidden=selectedControlMethod===1&&!archived;
 $('method-note').textContent=archived?'This experiment is preserved. The live loop is fitting another experiment.':'Saved results appear beside these controls. Live tuning for this method is not implemented yet.';
}
const families=['camera','lighting','materials','terrain','palms','buildings','fields'];
let settings=null,initialized=false,editable=false,timer=null,saving=false,queued=false,polling=false,revision=null;
const percent=value=>Number.isFinite(value)?(value*100).toFixed(6)+'%':'—';
function switchState(id,value){$(id).setAttribute('aria-checked',String(value));}
function controls(){
 $('literal').setAttribute('aria-pressed',String(settings.objectiveVersion===2));$('legacy').setAttribute('aria-pressed',String(settings.objectiveVersion===1));
 $('formula-weights').textContent=settings.objectiveVersion===2?'Literal fit: 50% pixels outside 10% RGB RMS tolerance + 35% local structure difference + 15% full-frame RGB RMS. The tolerance and weights are initial choices, not a perceptual calibration.':'Legacy fit: 60% coarse RGB + 25% edge magnitude + 15% fine RGB, measured after substantial downsampling.';
 switchState('running',!settings.paused);switchState('adaptive',settings.adaptive);
 for(const button of $('families').children)button.setAttribute('aria-checked',String(settings.families.includes(button.dataset.family)));
 $('stepFraction').value=settings.stepFraction*100;$('step-slider').value=settings.stepFraction*100;
 $('proposals').value=settings.proposals;$('intervalSeconds').value=settings.intervalSeconds;$('meaningfulGain').value=Number((settings.meaningfulGain*100).toFixed(6));
}
function schedule(){
 if(disposed)return;
 clearTimeout(timer);$('save-status').textContent='Saving changes…';timer=setTimeout(()=>{timer=null;void save();},400);
}
async function save(){
 if(disposed)return;
 if(saving){queued=true;return;}if(!editable)return;
 saving=true;
 try{
  const response=await fetch('/api/world-algorithms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(settings)});
  const data=await response.json();if(!response.ok)throw new Error(data.problem||'Could not save settings');
  revision=data.revision;$('save-status').textContent='Saved · applies to next batch';
 }catch(error){$('save-status').textContent=error.message;}
 finally{saving=false;if(queued){queued=false;void save();}}
}
for(const family of families){
 const button=document.createElement('button');button.type='button';button.role='switch';button.dataset.family=family;button.setAttribute('aria-checked','true');
 const track=document.createElement('span');track.className='track';track.setAttribute('aria-hidden','true');track.append(document.createElement('span'));button.append(track,family[0].toUpperCase()+family.slice(1));
 button.onclick=()=>{const enabled=settings.families.includes(family);if(enabled&&settings.families.length===1){$('save-status').textContent='Keep at least one search family active.';return;}settings.families=enabled?settings.families.filter(item=>item!==family):[...settings.families,family];controls();schedule();};$('families').append(button);
}
for(const [id,version] of [['literal',2],['legacy',1]])$(id).onclick=()=>{settings.objectiveVersion=version;controls();schedule();};
$('settings').onsubmit=event=>event.preventDefault();
$('running').onclick=()=>{settings.paused=!settings.paused;controls();schedule();};
$('adaptive').onclick=()=>{settings.adaptive=!settings.adaptive;controls();schedule();};
for(const id of ['stepFraction','proposals','intervalSeconds','meaningfulGain'])$(id).oninput=()=>{
 if(!$(id).validity.valid||$(id).value===''){ $('save-status').textContent='Choose a value within the displayed range.';clearTimeout(timer);return; }
 settings[id]=Number($(id).value)/(['stepFraction','meaningfulGain'].includes(id)?100:1);
 if(id==='stepFraction')$('step-slider').value=$(id).value;schedule();
};
$('step-slider').oninput=()=>{settings.stepFraction=Number($('step-slider').value)/100;$('stepFraction').value=$('step-slider').value;schedule();};
async function refresh(){
 if(disposed||document.hidden||!active||polling)return;polling=true;
 try{
  const response=await fetch('/api/world-algorithms',{cache:'no-store',signal:AbortSignal.timeout(10000)});const data=await response.json();if(disposed||!active)return;if(!response.ok)throw new Error();
  if(!initialized||!saving&&!timer&&!queued&&revision!==data.revision){settings=data.settings;revision=data.revision;editable=data.canEdit;controls();initialized=true;for(const input of $('settings').querySelectorAll('button,input'))input.disabled=!editable;}
  const state=data.state;activeStudy=state?.experimentId||'experiment-1';context();const pending=state?.revision!==data.revision;
  const status=state?.status||'Not started';
  $('resolution').textContent='Search: '+(state?.searchSize||256)+' × '+(state?.searchSize||256)+'; validation: 512 × 512. Compare the same source and objective version.';
  $('status').textContent=state?.alive===false?'Stopped':settings.paused&&status==='running'?'Pausing after batch':status[0].toUpperCase()+status.slice(1);
  $('best').textContent=Number.isFinite(state?.best512)?(10*(1-state.best512)).toFixed(6):'—';
  const mismatch=state?.bestComponents512?.pixel_mismatch_10pct;
  $('delta-label').textContent=state?.objectiveVersion===2?'Pixels outside 10% tolerance':'Legacy fitting index';
  $('delta').textContent=state?.objectiveVersion===2?percent(mismatch):percent(state?.best512);$('gain').textContent=Number.isFinite(state?.lastRelativeGain)?percent(state.lastRelativeGain):'—';
  $('coverage').textContent=state?.eligibleControls?state.activeControls+' / '+state.eligibleControls:'12 (legacy search)';
  $('cycle').textContent=state?.cycle!==undefined?String(state.cycle+(status==='running'?1:0)):'—';
  if(!saving&&!timer)$('save-status').textContent=!editable?'Read only · edit from your workstation session':pending?'Saved · queued for next batch':'Settings active';
  $('connection').textContent='Live · '+(state?.objectiveVersion===2?'Literal fit v2':'Legacy fit v1')+' · '+new Date().toLocaleTimeString();
 }catch{$('connection').textContent='Reconnecting · saved settings retained';}
 finally{polling=false;}
}
let preparation=null;
function prepare(){
 if(!preparation)preparation=(async()=>{
  for(const input of $('settings').querySelectorAll('button,input'))input.disabled=true;
  if(['localhost','127.0.0.1'].includes(location.hostname))await fetch('/api/workstation-session',{method:'POST'}).catch(()=>{});
 })();
 return preparation;
}
const poll=setInterval(()=>{if(active&&!disposed)void prepare().then(refresh);},2000);
if(active)void prepare().then(refresh);
return {setStudy(study){selectedStudy=study;context();},setMethod(method){selectedControlMethod=method;active=panelVisible&&method===1;$('control-method').textContent=methods[method-1];for(const id of ['settings','live','scoring'])$(id).hidden=method!==1;$('method-note').hidden=method===1;$('method-note').textContent='Saved results appear beside these controls. Live tuning for this method is not implemented yet.';if(method!==1)$('connection').textContent='No live controls';context();if(active&&!disposed)void prepare().then(refresh);},setActive(value){panelVisible=value;active=value&&selectedControlMethod===1;if(active&&!disposed)void prepare().then(refresh);},destroy(){disposed=true;active=false;clearInterval(poll);clearTimeout(timer);}};
}
