import { mountParameters } from './parameter-editor.js';
import { createFrameScheduler } from './frame-scheduler.js';
const $ = id => document.getElementById(id);
const canvas = $('world');
const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
const state = { arrival: { position: [2.3,20], look: [-.06,-.06] }, fixedClock: null, position: [2.3, 20], look: [-.06, -.06], sun: .3, water: 1, active: false, keys: new Set(), drag: null, frames: 0 };
window.worldTrial = { state, ready: false, error: null };
let invalidate=()=>{};
async function start() {
 if (!gl) throw new Error('This browser needs WebGL 2 to explore this world.');
 const shaders = await Promise.all(['scene.vert', 'scene.frag'].map(async file => {
  const response = await fetch(file); if (!response.ok) throw new Error('World shader unavailable');
  const shader = gl.createShader(file.endsWith('vert') ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER);
  gl.shaderSource(shader, await response.text()); gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
 }));
 const program = gl.createProgram(); shaders.forEach(shader => gl.attachShader(program, shader)); gl.linkProgram(program);
 if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
 gl.useProgram(program); gl.bindVertexArray(gl.createVertexArray());
 const parameterResponse=await fetch('parameters.json');if(!parameterResponse.ok)throw new Error('Scene parameters unavailable');
 const parameters=await parameterResponse.json();
 const recipeId=new URLSearchParams(location.search).get('recipe');
 if(recipeId){
  if(!/^[a-f0-9]{64}$/.test(recipeId))throw new Error('Invalid saved candidate identity');
  const response=await fetch('/api/world-experiments/recipe/'+recipeId+'.json');if(!response.ok)throw new Error('Saved candidate unavailable');
  const recipe=await response.json();const fragment=await fetch('scene.frag').then(r=>r.arrayBuffer());
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',fragment))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(recipe.shaderSha256!==digest)throw new Error('This candidate belongs to another shader revision; its saved capture remains available.');
  for(const group of parameters.groups){
   const saved=recipe.parameters.groups.find(g=>g.id===group.id);
   if(!saved||saved.values.length!==group.values.length)throw new Error('Saved parameter structure changed');
   for(let row=0;row<group.values.length;row++)for(let col=0;col<4;col++){
    const value=saved.values[row][col],bounds=group.limits[col];if(!Number.isFinite(value)||value<bounds[0]||value>bounds[1])throw new Error('Saved parameter out of range');group.values[row][col]=value;
   }
  }
  const camera=[...recipe.camera.position,...recipe.camera.look];if(camera.length!==4||!camera.every(Number.isFinite))throw new Error('Invalid saved camera');
  state.position=[...recipe.camera.position];state.look=[...recipe.camera.look];state.arrival={position:[...state.position],look:[...state.look]};state.fixedClock=recipe.camera.clock??0;
  window.worldTrial.recipeId=recipeId;
  window.worldTrial.recipeSource=recipe.source||null;
  window.worldTrial.experimentId=recipe.experimentId||null;
 }

 const slots=parameters.groups.map(group=>({group,location:gl.getUniformLocation(program,group.uniform.includes('[')?group.uniform:group.uniform+'[0]')}));
 if(slots.some(slot=>slot.location===null))throw new Error('A declared scene parameter has no active shader uniform');
 const applyParameters=()=>{for(const {group,location} of slots)gl.uniform4fv(location,new Float32Array(group.values.flat()));invalidate();};
 applyParameters();window.worldTrial.parameters=parameters;window.worldTrial.applyParameters=applyParameters;
 mountParameters(parameters,applyParameters);
 $('sun').value=parameters.groups.find(g=>g.id==='world-00').values[0][1];
 $('water').value=parameters.groups.find(g=>g.id==='world-11').values[0][0];
 $('sun').oninput=()=>{parameters.groups.find(g=>g.id==='world-00').values[0][1]=Number($('sun').value);applyParameters();};
 $('water').oninput=()=>{parameters.groups.find(g=>g.id==='world-11').values[0][0]=Number($('water').value);applyParameters();};
 const uniforms = Object.fromEntries(['uResolution','uPosition','uLook','uTime'].map(name => [name, gl.getUniformLocation(program, name)]));
 const resize = () => {
  const scale = Math.min(1, 720 / innerWidth, 450 / innerHeight);
  canvas.width = Math.max(1, Math.round(innerWidth * scale)); canvas.height = Math.max(1, Math.round(innerHeight * scale));
  gl.viewport(0,0,canvas.width,canvas.height);invalidate();
 };
 resize(); addEventListener('resize',resize);
 function frame(now,dt) {
  if (!document.hidden && !$('provenance').open&&!$('parameter-dialog').open) {
   if (state.active) {
    const speed=dt*(state.keys.has('shift')?8:3);
    const forward=Number(state.keys.has('w')||state.keys.has('arrowup'))-Number(state.keys.has('s')||state.keys.has('arrowdown'));
    const right=Number(state.keys.has('d')||state.keys.has('arrowright'))-Number(state.keys.has('a')||state.keys.has('arrowleft'));
    state.position[0]=Math.max(-30,Math.min(30,state.position[0]+(Math.sin(state.look[0])*forward+Math.cos(state.look[0])*right)*speed));
    state.position[1]=Math.max(-58,Math.min(25,state.position[1]+(-Math.cos(state.look[0])*forward+Math.sin(state.look[0])*right)*speed));
   }
   gl.uniform2f(uniforms.uResolution,canvas.width,canvas.height); gl.uniform2fv(uniforms.uPosition,state.position); gl.uniform2fv(uniforms.uLook,state.look);
   state.clock=state.fixedClock??now/1000;gl.uniform1f(uniforms.uTime,state.clock);
   gl.drawArrays(gl.TRIANGLES,0,3); state.frames++;
   if(state.frames===1){window.worldTrial.glError=gl.getError();if(window.worldTrial.glError)throw new Error('World drawing failed');}
  }
 }
 const visible=()=>!document.hidden&&!$('provenance').open&&!$('parameter-dialog').open;
 const scheduler=createFrameScheduler({request:callback=>requestAnimationFrame(callback),cancel:id=>cancelAnimationFrame(id),now:()=>performance.now(),visible,continuous:()=>state.fixedClock===null,moving:()=>state.active&&[...state.keys].some(key=>['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(key)),draw:frame});
 invalidate=()=>scheduler.invalidate();
 document.addEventListener('visibilitychange',()=>{if(visible())invalidate();else scheduler.suspend();});
 for(const id of ['provenance','parameter-dialog'])$(id).addEventListener('close',invalidate);
 addEventListener('pagehide',()=>scheduler.suspend());addEventListener('pageshow',invalidate);
 window.worldTrial.scheduler=scheduler;
 window.worldTrial.provenance=await fetch('trial.json').then(r=>r.json());
 if(window.worldTrial.recipeSource)window.worldTrial.provenance={schema:1,world:'draa-valley',source:window.worldTrial.recipeSource,scene:window.worldTrial.provenance.scene,experimentId:window.worldTrial.experimentId,recipeId:window.worldTrial.recipeId,acceptance:'Pending Jay visual and exploration acceptance',sourceObservations:'Source observations must be recorded for this specific source; baseline validation is not inherited.'};
 window.worldTrial.ready=true; window.worldTrial.capture=()=>canvas.toDataURL('image/png');
 $('status').textContent='848 GLSL parameters · source-linked draft · awaiting your acceptance'; invalidate();
}
$('enter').onclick=()=>{state.active=true;$('start').hidden=true;canvas.focus();invalidate();};
$('home').onclick=()=>{state.position=[...state.arrival.position];state.look=[...state.arrival.look];invalidate();};
const movement=new Set(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright','shift']);
addEventListener('keydown',event=>{const key=event.key.toLowerCase();if(state.active&&!$('provenance').open&&!$('parameter-dialog').open&&movement.has(key)){event.preventDefault();state.keys.add(key);invalidate();}});
addEventListener('keyup',event=>{state.keys.delete(event.key.toLowerCase());invalidate();});
addEventListener('blur',()=>{state.keys.clear();invalidate();});
canvas.tabIndex=0;
canvas.onpointerdown=event=>{state.drag=[event.clientX,event.clientY];canvas.setPointerCapture(event.pointerId);};
canvas.onpointermove=event=>{if(!state.drag)return;state.look[0]+=(event.clientX-state.drag[0])*.004;state.look[1]=Math.max(-1.1,Math.min(1.1,state.look[1]-(event.clientY-state.drag[1])*.004));state.drag=[event.clientX,event.clientY];invalidate();};
canvas.onpointerup=canvas.onpointercancel=()=>{state.drag=null;};
for(const button of document.querySelectorAll('[data-move]')){const key={forward:'w',back:'s',left:'a',right:'d'}[button.dataset.move];button.onpointerdown=event=>{event.preventDefault();state.active=true;$('start').hidden=true;state.keys.add(key);invalidate();button.setPointerCapture(event.pointerId);};button.onpointerup=button.onpointercancel=()=>{state.keys.delete(key);invalidate();};}
for(const name of ['sun','water']) $(name).oninput=()=>{state[name]=Number($(name).value);};
$('close').onclick=()=>$('provenance').close();
$('source').onclick=async()=>{
 state.keys.clear();$('provenance').showModal();
 try {
  const source=window.worldTrial.recipeSource||await fetch('source.json').then(r=>r.json());
  $('original').src=source.imageUrl;
  $('identity').textContent=`${source.profile==='flux1-dev'?'FLUX.1':'FLUX.2'} · ${source.width} × ${source.height} · source ${source.id} · SHA256 ${source.sha256}`;
  const originalSource=await fetch('source.json').then(r=>r.json());
  if(source.sha256!==originalSource.sha256){$('reviews').textContent='No Seer reviews are recorded for this experiment source yet.';return;}
  const brief=await fetch('brief.json').then(r=>r.json());
  $('reviews').replaceChildren(...Object.entries(brief.reviews).map(([name,review])=>{const section=document.createElement('section'),h=document.createElement('h4'),p=document.createElement('pre');h.textContent=name;p.textContent=review.feedback;section.append(h,p);return section;}));
  const analysis=await fetch('analysis.json').then(r=>r.json());
  for(const [name,review] of Object.entries(analysis.reviews)){for(const [pass,result] of Object.entries(review.passes)){const details=document.createElement('details'),summary=document.createElement('summary'),text=document.createElement('pre');summary.textContent=name+' · '+pass.replaceAll('_',' ')+(result.parseError?' · unparsed output':'');text.textContent=result.feedback;details.append(summary,text);$('reviews').append(details);}}
 } catch {$('identity').textContent='Source record is temporarily unavailable.';}
};
$('capture').onclick=()=>{
 const artifact={schema:1,world:'draa-valley',shader:'scene.frag',recipeId:window.worldTrial.recipeId||null,recordedAt:new Date().toISOString(),position:[...state.position],look:[...state.look],parameters:window.worldTrial.parameters,clock:state.clock,viewport:[canvas.width,canvas.height],provenance:window.worldTrial.provenance,image:window.worldTrial.capture?.()};
 const link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(artifact)],{type:'application/json'}));link.href=url;link.download='draa-valley-view.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
start().catch(error=>{window.worldTrial.error=error.message;$('status').textContent=error.message;});
