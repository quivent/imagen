import test from 'node:test';
import assert from 'node:assert/strict';
import {mountProductionStudyControls} from '../src/production-study-controls.js';
class Node{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this._text='';}
 set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+' '+this.children.map(n=>n.textContent).join(' ');}
 setAttribute(k,v){this.attributes[k]=String(v);}append(...nodes){for(const n of nodes)this.insertBefore(n,null);}
 insertBefore(n,b){n.remove();this.children.splice(b?this.children.indexOf(b):this.children.length,0,n);n.parent=this;}
 replaceChildren(...nodes){for(const n of [...this.children])n.remove();this._text='';this.append(...nodes);}remove(){if(this.parent){this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}}
 all(tag){return [...(this.tagName===tag?[this]:[]),...this.children.flatMap(n=>n.all(tag))];}
}
const data=()=>({study:{id:'ADHC-001',settings:{width:512,height:512,steps:28,guidance_scale:3.5,max_sequence_length:512},currentScenes:[{laneIndex:0,scene:{name:'Atlas',prompt:'Atlas production',precisionPrompt:'Atlas precision'}},{laneIndex:1,scene:{name:'Temple',prompt:'Temple production',precisionPrompt:'Temple precision'}}]},workflow:{completedPairs:42,pass:2,lanes:[{laneIndex:0,gpuIndex:0,stage:'running',enabled:true,runnerAlive:true},{laneIndex:1,gpuIndex:1,stage:'running',enabled:true,runnerAlive:true}]},daemon:{enabled:true,runnerAlive:true}});
const button=(root,label)=>root.all('BUTTON').find(b=>b.textContent.trim()===label);
function mount(){const root=new Node(),posts=[],component=mountProductionStudyControls({root,post:v=>posts.push(v),document:{createElement:t=>new Node(t)}});return{root,posts,component};}
test('shared editable parameter template saves actual paired settings and retains an unsaved edit across polls',()=>{
 const{root,posts,component}=mount(),value=data();component.update(value);
 assert.ok(root.textContent.includes('Production parameters'));assert.equal(root.all('SELECT').length,0);assert.equal(root.all('IMG').length,0);assert.ok(!/seed/i.test(root.textContent));
 button(root,'768 px').onclick();button(root,'16').onclick();component.update(value);button(root,'Apply parameters').onclick();
 assert.deepEqual(posts.pop(),{action:'settings',settings:{width:768,height:768,steps:16,guidance_scale:3.5,max_sequence_length:512}});
 value.study.settings={width:768,height:768,steps:16,guidance_scale:3.5,max_sequence_length:512};component.update(value);assert.equal(button(root,'Apply parameters').disabled,true);
 assert.ok(root.textContent.includes('Atlas production'));assert.ok(root.textContent.includes('Temple precision'));
});
test('frame and reset operate on the paired settings without applying automatically',()=>{
 const{root,posts,component}=mount(),value=data();component.update(value);
 button(root,'Landscape').onclick();button(root,'1024 px').onclick();
 assert.ok(root.textContent.includes('1536 × 1024 px'));assert.equal(posts.length,0);
 button(root,'Apply parameters').onclick();assert.deepEqual(posts.pop().settings,{width:1536,height:1024,steps:28,guidance_scale:3.5,max_sequence_length:512});
 button(root,'Reset changes').onclick();assert.ok(root.textContent.includes('512 × 512 px'));assert.equal(button(root,'Apply parameters').disabled,true);
});
test('pause/resume controls operate both lanes and respect pending actions',()=>{
 const{root,posts,component}=mount(),value=data();component.update(value);button(root,'Pause generation').onclick();assert.deepEqual(posts.pop(),{action:'pause'});
 value.workflow.lanes.forEach(l=>l.enabled=false);component.update(value);button(root,'Resume generation').onclick();assert.deepEqual(posts.pop(),{action:'start'});
 component.update({...value,disabled:true});button(root,'Resume generation').onclick();assert.equal(posts.length,0);
});
test('heartbeats retain prompt disclosures and remove stale lanes',()=>{
 const{root,component}=mount(),value=data();component.update(value);const detail=root.all('DETAILS')[0];detail.open=true;component.update(value);assert.equal(root.all('DETAILS')[0],detail);assert.equal(detail.open,true);
 value.workflow.lanes.shift();value.study.currentScenes.shift();component.update(value);assert.equal(root.all('DETAILS').length,2);assert.ok(!root.textContent.includes('Atlas'));assert.ok(root.textContent.includes('Temple'));
});
