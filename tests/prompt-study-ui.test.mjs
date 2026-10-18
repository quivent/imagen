import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {workflowPanel,reviewPairs} from '../src/prompt-study-workflow.js';
import {mountProductionStudyControls} from '../src/production-study-controls.js';
class Node extends EventTarget{
 constructor(tag='div'){super();this.tagName=tag.toUpperCase();this.children=[];this.attributes=new Map();this._text='';}
 get firstChild(){return this.children[0]||null;}get textContent(){return this._text+this.children.map(child=>child.textContent).join(' ');}set textContent(value){this._text=String(value);for(const child of [...this.children])child.remove();}
 setAttribute(key,value){this.attributes.set(key,String(value));}getAttribute(key){return this.attributes.get(key);}
 append(...nodes){for(let node of nodes){if(typeof node==='string'){const text=new Node('text');text.textContent=node;node=text;}this.insertBefore(node,null);}}
 insertBefore(node,before){node.remove();this.children.splice(before?this.children.indexOf(before):this.children.length,0,node);node.parent=this;}
 replaceChildren(...nodes){for(const child of [...this.children])child.remove();this._text='';this.append(...nodes);}
 remove(){if(this.parent){this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}}
 contains(node){return this===node||this.children.some(child=>child.contains(node));}
 all(predicate){return [...(predicate(this)?[this]:[]),...this.children.flatMap(child=>child.all(predicate))];}
 querySelectorAll(selector){return this.all(node=>selector==='button'?node.tagName==='BUTTON':node.getAttribute('role')==='status');}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}
const el=(tag,text,cls)=>{const node=new Node(tag);if(text)node.textContent=text;if(cls)node.className=cls;return node;};
const button=(root,label)=>root.all(node=>node.tagName==='BUTTON'&&node.textContent===label)[0];
const pair=()=>({id:'oldpackage:pair01',package:'oldpackage',requestPair:'pair-01',sceneName:'Ocean',seed:42,images:{left:{url:'/left',seconds:2},right:{url:'/right',seconds:3}},review:null,revealedArms:null});
const workflow=()=>({study:'ADHC-001',continuous:true,package:'currentpackage',stage:'running',enabled:true,runnerAlive:true,completedPairs:42,remainingPairs:108,pass:1,pairs:[pair()],report:null});

test('continuous workflow has optional single-action review and preserves image nodes across heartbeats/reviews',()=>{
 const posts=[],drafts={},flow=workflow(),post=value=>posts.push(value);
 const controls=workflowPanel({workflow:flow,post,el,drafts});
 assert.ok(!controls.textContent.includes('Pair limit'));assert.ok(!controls.textContent.includes('Review every'));assert.ok(!controls.textContent.includes('20-minute'));
 button(controls,'Pause generation').onclick();assert.equal(posts.at(-1).action,'pause');
 const section=reviewPairs({workflow:flow,post,el,drafts}),card=section.children[0],images=section.all(node=>node.tagName==='IMG');
 assert.equal(images.length,2);assert.ok(button(section,'Save choice'));assert.ok(!button(section,'Save choice & pause'));
 button(section,'Left').onclick();button(section,'Save choice').onclick();
 assert.deepEqual(posts.at(-1),{action:'review',package:'oldpackage',pair:'pair-01',choice:'left',note:'',continue:false});
 const second=reviewPairs({workflow:{...flow,completedPairs:43,stage:'checking'},post,el,drafts});assert.equal(second,section);assert.equal(second.children[0],card);assert.equal(second.all(node=>node.tagName==='IMG')[0],images[0]);
 const reviewed=reviewPairs({workflow:{...flow,pairs:[{...flow.pairs[0],review:{choice:'left'},revealedArms:{left:'B',right:'A'}}]},post,el,drafts});
 assert.equal(reviewed.all(node=>node.tagName==='IMG')[0],images[0]);assert.ok(reviewed.textContent.includes('Precision'));assert.ok(!button(reviewed,'Save choice'));
});

async function mount(view,fetch){
 const document=new EventTarget();document.hidden=false;document.createElement=tag=>new Node(tag);document.activeElement=null;
 const root=new Node(),timers=new Map();let next=1,poll;
 const context={workflowPanel,reviewPairs,mountProductionStudyControls,document,fetch,AbortController,console,setTimeout:(fn,ms)=>{const id=next++;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),setInterval:fn=>{poll=fn;return 1;},clearInterval(){}};
 const code=(await readFile(new URL('../src/prompt-study.js',import.meta.url),'utf8')).replace(/^import[^\n]*\n/gm,'').replace('export function mountPromptStudy','function mountPromptStudy');
 vm.runInNewContext(code+'\nglobalThis.mount=mountPromptStudy;',context);
 const component=context.mount({root,view});component.setActive(true);await new Promise(resolve=>setImmediate(resolve));return {component,root,document,timers,poll:()=>poll()};
}
const payload=()=>({productionStudy:{id:'ADHC-001',sceneCount:150,firstScene:{name:'Old Sahara',prompt:'Old first prompt'},currentScene:{name:'Current Ocean',prompt:'Current production wording',precisionPrompt:'Current precision wording'},settings:{width:512,height:512,steps:28,guidance_scale:3.5,max_sequence_length:512}},workflow:workflow(),daemon:{enabled:true,runnerAlive:true,pass:2,seed:43},productionFlow:{page:1,pages:3,totalPairs:42}});

test('Controls displays current scene and actual shared settings; Stream is compact and pagination requests its page',async()=>{
 const requests=[];let data=payload();const fetch=async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>structuredClone(data)};};
 const controls=await mount('controls',fetch);
 assert.ok(controls.root.textContent.includes('Current Ocean'));assert.ok(controls.root.textContent.includes('Current production wording'));assert.ok(controls.root.textContent.includes('Current precision wording'));assert.ok(!controls.root.textContent.includes('Old Sahara'));
 assert.ok(controls.root.textContent.includes('28'));assert.ok(controls.root.textContent.includes('Resolution'));assert.ok(!controls.root.textContent.includes('Pair limit'));
 controls.component.destroy();
 const stream=await mount('stream',fetch);assert.ok(stream.root.textContent.includes('Live · Current Ocean'));assert.ok(!stream.root.textContent.includes('Current production wording'));
 button(stream.root,'Older').onclick();await new Promise(resolve=>setImmediate(resolve));assert.ok(requests.some(request=>request.url==='/api/prompt-study?page=2'));
 stream.component.destroy();
});

test('poll requests have twenty-second cancellation and abort when hidden or disposed',async()=>{
 const requests=[];const fetch=(url,options)=>new Promise((resolve,reject)=>{requests.push({url,signal:options.signal});options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});
 const app=await mount('stream',fetch);assert.ok([...app.timers.values()].some(timer=>timer.ms===20000));
 app.document.hidden=true;app.document.dispatchEvent(new Event('visibilitychange'));assert.ok(requests[0].signal.aborted);await new Promise(resolve=>setImmediate(resolve));
 app.document.hidden=false;app.document.dispatchEvent(new Event('visibilitychange'));assert.equal(requests.length,2);app.component.destroy();assert.ok(requests[1].signal.aborted);await new Promise(resolve=>setImmediate(resolve));assert.equal(app.timers.size,0);
});

test('legacy FPC keeps bounded pilot guidance and review continuation controls',()=>{
 const flow={study:'FPC-001',package:'legacy',stage:'prepared',completedPairs:0,remainingPairs:3,plannedPairs:3,pairs:[{...pair(),id:'pair-01',package:undefined,requestPair:undefined}],guidance:{maxPairs:3,reviewEvery:1,focus:'Composition'}};
 const controls=workflowPanel({workflow:flow,post(){},el,drafts:{}});
 assert.ok(controls.textContent.includes('Pair limit'));assert.ok(controls.textContent.includes('Review every'));assert.ok(controls.textContent.includes('20-minute'));
 const pairs=reviewPairs({workflow:flow,post(){},el,drafts:{}});
 assert.ok(button(pairs,'Save choice & pause'));assert.ok(button(pairs,'Save choice & continue'));
});

test('dual-lane Controls shows both actual scenes and lane states with one shared settings section',async()=>{
 const data=payload();data.daemon.lanes=[{laneIndex:0,gpuIndex:0,sceneId:'scene-061',stage:'running',enabled:true,runnerAlive:true,seed:42},{laneIndex:1,gpuIndex:1,sceneId:'scene-076',stage:'waiting-worker',enabled:true,runnerAlive:true,seed:43}];
 data.productionStudy.currentScenes=[{laneIndex:0,gpuIndex:0,scene:{name:'Atlas',prompt:'Atlas production',precisionPrompt:'Atlas precision'}},{laneIndex:1,gpuIndex:1,scene:{name:'Temple',prompt:'Temple production',precisionPrompt:'Temple precision'}}];
 const app=await mount('controls',async()=>({ok:true,json:async()=>structuredClone(data)}));
 const text=app.root.textContent;
 assert.ok(text.includes('GPU 0 · Atlas'));assert.ok(text.includes('GPU 1 · Temple'));assert.ok(text.includes('Generating'));assert.ok(text.includes('Waiting for worker'));
 assert.ok(text.includes('Atlas production'));assert.ok(text.includes('Temple production'));assert.ok(!/seed/i.test(text));
 assert.equal(app.root.all(node=>node.tagName==='LEGEND'&&node.textContent==='Resolution').length,1,'shared editable settings are shown once');
 app.component.destroy();
});
