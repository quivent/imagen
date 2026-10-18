import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
function element(){return {hidden:false,textContent:'',children:[],append(child){child.parentNode?.remove(child);this.children.push(child);child.parentNode=this;},remove(child){this.children=this.children.filter(n=>n!==child);},insertBefore(child,next){child.parentNode?.remove(child);const index=this.children.indexOf(next);this.children.splice(index<0?this.children.length:index,0,child);child.parentNode=this;},querySelector(){return null;}};}
test('studio navigation has no public monitor reader or timer, mode transitions release both and preserve Seers',async()=>{
 const source=(await readFile(new URL('../src/public-navigation.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('export function','function');
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const home=element();home.append(get('seers-panel'));const sibling=element();home.append(sibling);get('seers-panel').nextSibling=sibling;
 let observer,subscriptions=0,releases=0,callback,tab='stream',seersActive=null;const timers=new Map();let timerId=0;
 const root={dataset:{studioMode:'studio'}},context={document:{documentElement:root,getElementById:get,createElement:element},studioLive:{subscribe(topic,cb){assert.equal(topic,'monitor');subscriptions++;callback=cb;return ()=>releases++;}},generationIsActive:value=>Boolean(value?.active),setInterval(fn){timers.set(++timerId,fn);return timerId;},clearInterval(id){timers.delete(id);},MutationObserver:class {constructor(fn){observer=fn;}observe(){}disconnect(){}}};
 vm.runInNewContext(source+'\nglobalThis.mount=mountPublicNavigation;',context);
 let navigation;navigation=context.mount({activeTab:()=>tab,select(value){tab=value;navigation?.update();},panels:{seers:{setActive(value){seersActive=value;}}}});
 assert.equal(subscriptions,0);assert.equal(timers.size,0);assert.equal(get('tab-stream').textContent,'Stream');
 root.dataset.studioMode='public';observer();assert.equal(subscriptions,1);assert.equal(timers.size,1);assert.equal(get('tab-stream').hidden,true);
 callback({active:true});assert.equal(get('tab-stream').hidden,false);assert.equal(get('tab-stream').textContent,'Active');
 tab='models';navigation.update();assert.equal(seersActive,true);assert.equal(get('seers-panel').hidden,false);assert.notEqual(get('seers-panel').parentNode,home);
 root.dataset.studioMode='studio';observer();assert.equal(releases,1);assert.equal(timers.size,0);assert.equal(get('seers-panel').parentNode,home);assert.equal(get('tab-stream').hidden,false);assert.equal(seersActive,false);
 callback({active:true});assert.equal(get('tab-stream').textContent,'Stream','late public observations are ignored');
 tab='seers';navigation.update();assert.equal(seersActive,true);
 root.dataset.studioMode='public';observer();assert.equal(subscriptions,2);assert.equal(timers.size,1);navigation.destroy();assert.equal(releases,2);assert.equal(timers.size,0);navigation.update();assert.equal(subscriptions,2);
});
