import {createFrameScheduler} from '../draa-valley/frame-scheduler.js';
const canvas=document.getElementById('surface'),status=document.getElementById('status');
const gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});
const keys=new Set();let camera=[0,0,0,0,0],drag=null,relief=0,storedRelief=.75,scheduler;
async function start(){
 if(!gl)throw new Error('WebGL2 is unavailable.');
 const id=new URLSearchParams(location.search).get('recipe');if(!/^[a-f0-9]{64}$/.test(id||''))throw new Error('Open a saved Experiment4 surface from Workbench.');
 const response=await fetch('/api/world-experiments/recipe/'+id+'.json');if(!response.ok)throw new Error('Surface recipe unavailable.');
 const recipe=await response.json();if(recipe.viewer!=='source-surface')throw new Error('Wrong surface recipe.');
 const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
 const program=gl.createProgram();
 for(const [file,type,expected] of [['scene.vert',gl.VERTEX_SHADER,recipe.vertexSha256],['scene.frag',gl.FRAGMENT_SHADER,recipe.shaderSha256]]){
  const bytes=await fetch(file).then(r=>{if(!r.ok)throw new Error('Shader unavailable.');return r.arrayBuffer();});
  if(await hash(bytes)!==expected)throw new Error('Saved shader identity changed.');
  const shader=gl.createShader(type);gl.shaderSource(shader,new TextDecoder().decode(bytes));gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));gl.attachShader(program,shader);
 }
 gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));gl.useProgram(program);
 if(!/^[a-f0-9]{64}$/.test(recipe.surfaceDataSha256||''))throw new Error('Invalid geometry identity.');
 const data=await fetch('/api/source-surface/'+recipe.surfaceDataSha256+'.bin').then(r=>{if(!r.ok)throw new Error('Geometry unavailable.');return r.arrayBuffer();});
 if(await hash(data)!==recipe.surfaceDataSha256)throw new Error('Geometry identity changed.');
 const header=new DataView(data),width=header.getUint32(8,true),height=header.getUint32(12,true);
 if(new TextDecoder().decode(data.slice(0,8))!=='IMGSURF1'||width!==512||height!==512||data.byteLength!==16+width*height*20)throw new Error('Invalid source geometry.');
 gl.bindVertexArray(gl.createVertexArray());const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Uint8Array(data,16),gl.STATIC_DRAW);
 gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,4,gl.UNSIGNED_BYTE,true,20,0);gl.vertexAttribDivisor(0,1);
 gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,4,gl.FLOAT,false,20,4);gl.vertexAttribDivisor(1,1);
 gl.disable(gl.DITHER);gl.disable(gl.BLEND);gl.enable(gl.DEPTH_TEST);
 const uniforms=Object.fromEntries(['uSourceSize','uViewport','uCamera','uLook','uRelief'].map(name=>[name,gl.getUniformLocation(program,name)]));
 gl.uniform2f(uniforms.uSourceSize,width,height);
 relief=recipe.relief;storedRelief=relief||.75;document.getElementById('depth').setAttribute('aria-checked',String(relief>0));
 const resize=()=>{const side=Math.min(720,Math.round(Math.min(innerWidth,innerHeight)*Math.min(devicePixelRatio,2)));canvas.width=side;canvas.height=side;gl.viewport(0,0,side,side);scheduler?.invalidate();};resize();addEventListener('resize',resize);
 const draw=(_,dt)=>{
  const speed=dt*.5;camera[0]+=(Number(keys.has('d'))-Number(keys.has('a')))*speed;camera[2]+=(Number(keys.has('s'))-Number(keys.has('w')))*speed;
  gl.uniform2f(uniforms.uViewport,canvas.width,canvas.height);gl.uniform3fv(uniforms.uCamera,camera.slice(0,3));gl.uniform2fv(uniforms.uLook,camera.slice(3));gl.uniform1f(uniforms.uRelief,relief);
  gl.clearColor(.055,.071,.09,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.drawArraysInstanced(gl.TRIANGLES,0,6,width*height);
 };
 scheduler=createFrameScheduler({request:requestAnimationFrame,cancel:cancelAnimationFrame,now:()=>performance.now(),visible:()=>!document.hidden,continuous:()=>false,moving:()=>keys.size>0,draw});
 if(new URLSearchParams(location.search).has('verify')){
  canvas.width=512;canvas.height=512;gl.viewport(0,0,512,512);draw(0,0);
  const pixels=new Uint8Array(512*512*4),reference=new Uint8Array(data,16);gl.readPixels(0,0,512,512,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  let equalPixels=0,maxByteDifference=0;
  for(let y=0;y<512;y++)for(let x=0;x<512;x++){let equal=true;for(let channel=0;channel<3;channel++){const delta=Math.abs(pixels[((511-y)*512+x)*4+channel]-reference[(y*512+x)*20+channel]);maxByteDifference=Math.max(maxByteDifference,delta);equal&&=delta===0;}equalPixels+=Number(equal);}
  window.sourceSurfaceTrial={ready:true,equalPixels,pixels:512*512,maxByteDifference,glError:gl.getError(),relief};
 }
 status.textContent='Source RGB on GLSL geometry · exact native512 arrival proven in CGL · depth is a hypothesis';scheduler.invalidate();
 document.getElementById('return').onclick=()=>{camera=[0,0,0,0,0];scheduler.invalidate();};
 document.getElementById('depth').onclick=event=>{relief=relief?0:storedRelief;event.currentTarget.setAttribute('aria-checked',String(relief>0));scheduler.invalidate();};
}
addEventListener('keydown',event=>{if(['w','a','s','d'].includes(event.key.toLowerCase())){event.preventDefault();keys.add(event.key.toLowerCase());scheduler?.invalidate();}});
addEventListener('keyup',event=>{keys.delete(event.key.toLowerCase());scheduler?.invalidate();});addEventListener('blur',()=>keys.clear());
canvas.onpointerdown=event=>{drag=[event.clientX,event.clientY];canvas.setPointerCapture(event.pointerId);};canvas.onpointerup=canvas.onpointercancel=()=>{drag=null;};
canvas.onpointermove=event=>{if(!drag)return;camera[3]+=(event.clientX-drag[0])*.003;camera[4]+=(event.clientY-drag[1])*.003;drag=[event.clientX,event.clientY];scheduler?.invalidate();};
document.addEventListener('visibilitychange',()=>{if(document.hidden){keys.clear();scheduler?.suspend();}else scheduler?.invalidate();});addEventListener('pagehide',()=>scheduler?.suspend());addEventListener('pageshow',()=>scheduler?.invalidate());
start().catch(error=>{status.textContent=error.message;window.sourceSurfaceTrial={ready:true,error:error.message};});
