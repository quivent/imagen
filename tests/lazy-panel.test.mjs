import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
function node(){return {dataset:{},childNodes:[],attributes:{},insertions:0,setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},append(...children){for(const child of children){child.parentNode=this;this.childNodes.push(child);}},remove(){if(this.parentNode){this.parentNode.childNodes=this.parentNode.childNodes.filter(child=>child!==this);this.parentNode=null;}},insertAdjacentHTML(){this.insertions++;this.append(node());}};}
async function setup(){
 const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('function lazyPanel('),source.indexOf('for(const [name,loader] of Object.entries(panelLoaders))'));
 const roots=new Map(),rootFor=id=>{if(!roots.has(id))roots.set(id,node());return roots.get(id);};
 const context={$:rootFor,document:{hidden:false,createElement:node},publicNavigation:{update(){}}};vm.runInNewContext(code+'\nglobalThis.create=lazyPanel;',context);
 return {context,rootFor};
}
test('inactive panels load only on selection, respect navigation during loading, and dispose pending/HMR mounts',async()=>{
 const {context,rootFor}=await setup();
 let resolve,loads=0,mounts=0,destroys=0;const states=[];
 const mount=()=>{mounts++;return {setActive:value=>states.push(value),destroy:()=>destroys++};};
 const panel=context.create('test',()=>{loads++;return new Promise(done=>{resolve=done;});});
 panel.setActive(false);assert.equal(loads,0);panel.setActive(true);panel.setActive(true);assert.equal(loads,1);
 panel.setActive(false);resolve([mount,'markup']);await new Promise(done=>setImmediate(done));
 assert.equal(mounts,1);assert.equal(states.at(-1),false,'late import does not activate the panel after navigation');
 panel.setActive(true);assert.equal(states.at(-1),true);assert.equal(loads,1);
 panel.remount(mount,'new markup');assert.equal(mounts,2);assert.equal(destroys,1);panel.destroy();assert.equal(destroys,2);
 let resolveLate;const late=context.create('late',()=>new Promise(done=>resolveLate=done));late.setActive(true);late.destroy();resolveLate([mount,'markup']);await new Promise(done=>setImmediate(done));
 assert.equal(mounts,2,'disposed pending imports never mount');assert.equal(rootFor('late-panel').insertions,0);
});
test('failed mounts show explicit Retry, clean partial markup and preserve external children',async()=>{
 const {context,rootFor}=await setup(),root=rootFor('broken-panel'),external=node();root.append(external);
 let loads=0,mounts=0,destroys=0;
 const panel=context.create('broken',()=>{loads++;return Promise.resolve([()=>{mounts++;return {setActive(){if(mounts===1)throw Error('partial mount');},destroy(){destroys++;}};},'markup']);});
 panel.setActive(true);await new Promise(done=>setImmediate(done));
 assert.equal(destroys,1);assert.equal(root.dataset.loadError,'true');assert.equal(root.childNodes.length,2);
 const failure=root.childNodes.find(child=>child!==external);assert.equal(failure.attributes.role,'alert');
 panel.setActive(true);assert.equal(loads,1,'a failed panel waits for an explicit retry');
 failure.childNodes[1].onclick();await new Promise(done=>setImmediate(done));
 assert.equal(loads,2);assert.equal(mounts,2);assert.equal(root.childNodes.length,2,'one markup insertion remains after retry');assert.equal(root.childNodes[0],external);assert.equal(root.dataset.loadError,undefined);
 panel.destroy();assert.equal(destroys,2);assert.deepEqual(root.childNodes,[external]);
});
test('a remount fences stale imports and synchronous loader errors can retry',async()=>{
 const {context,rootFor}=await setup();let late,oldMounts=0,newMounts=0;
 const panel=context.create('race',()=>new Promise(resolve=>late=resolve));panel.setActive(true);
 panel.remount(()=>{newMounts++;return {setActive(){},destroy(){}};},'new');
 late([()=>{oldMounts++;return {setActive(){},destroy(){}};},'old']);await new Promise(done=>setImmediate(done));
 assert.equal(newMounts,1);assert.equal(oldMounts,0);assert.equal(rootFor('race-panel').childNodes.length,1);panel.destroy();
 let attempts=0;const sync=context.create('sync',()=>{if(!attempts++)throw Error('loader');return Promise.resolve([null,'ready']);});sync.setActive(true);
 const failure=rootFor('sync-panel').childNodes[0];assert.equal(failure.attributes.role,'alert');failure.childNodes[1].onclick();await new Promise(done=>setImmediate(done));assert.equal(attempts,2);sync.destroy();
});
