import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {readWorkbenchRoute,workbenchURL} from '../src/workbench-route.js';
class Node extends EventTarget{
 constructor(tag='div'){super();this.tag=tag;this.children=[];this.attributes=new Map();this.classList={add(){}};this.open=false;this.dataset={};}
 setAttribute(name,value){this.attributes.set(name,String(value));}getAttribute(name){return this.attributes.get(name);}removeAttribute(name){this.attributes.delete(name);if(name==='src')this.src='';}
 append(...nodes){for(let node of nodes){if(typeof node==='string'){const text=new Node('text');text.textContent=node;node=text;}this.insertBefore(node,null);}}
 insertBefore(node,before){node.remove();const index=before?this.children.indexOf(before):this.children.length;this.children.splice(index,0,node);node.parent=this;}
 replaceChildren(...nodes){for(const child of [...this.children])child.remove();this.append(...nodes);}
 remove(){if(this.parent){this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}}
 replaceWith(node){const parent=this.parent,next=parent.children[parent.children.indexOf(this)+1];this.remove();parent.insertBefore(node,next||null);}
 contains(node){return this===node||this.children.some(child=>child.contains(node));}
 showModal(){this.open=true;}close(){this.open=false;this.dispatchEvent(new Event('close'));}
}
test('Workbench retains source/baseline/candidate images across live appends and disposes modal resources',async()=>{
 const nodes=new Map(),root=new Node(),images=[];let poll,cleared=false,fetches=0;
 root.querySelector=selector=>{if(!nodes.has(selector)){const node=new Node();nodes.set(selector,node);root.append(node);}return nodes.get(selector);};
 const get=id=>root.querySelector('#iter-'+id);get('follow').setAttribute('aria-checked','true');
 const item=(url,error)=>({image:{url},components:{weighted_total:error},recipeUrl:'/api/world-experiments/recipe/'+'a'.repeat(64)+'.json'});
 const first={...item('/candidate1',.6),id:1,previousComponents:{weighted_total:.7}};
 const run={id:'study-method-1',experimentId:'experiment-2',method:1,source:{imageUrl:'/source',sha256:'b'.repeat(64),id:'source'},baseline:item('/baseline',.7),best:item('/best',.6),candidates:[first],shaderSha256:'c'.repeat(64),objectiveVersion:2,status:'running',totalCandidates:1,views:[]};
 let payload={studies:[{id:'experiment-2',label:'Experiment2'}],selectedStudy:'experiment-2',experiment:run,pagination:{page:1,totalPages:1,total:1,pageSize:20}};
 const context={URL,URLSearchParams,Event,readWorkbenchRoute,workbenchURL,location:{href:'http://localhost/workbench?experiment=2'},history:{replaceState(){}},document:{hidden:false,createElement:tag=>{const node=new Node(tag);if(tag==='img')images.push(node);return node;}},fetch:async()=>{fetches++;return {ok:true,json:async()=>structuredClone(payload)};},AbortSignal,setInterval:callback=>{poll=callback;return 1;},clearInterval:()=>{cleared=true;},console};
 const code=(await readFile(new URL('../src/workbench-results.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/,'').replace('export function mountWorkbenchResults','function mountWorkbenchResults');
 vm.runInNewContext(code+'\nglobalThis.mount=mountWorkbenchResults;',context);
 const component=context.mount({root});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(images.length,4);const source=images[0],baseline=images[1],candidate=images[3],card=get('candidates').children[0];
 payload.experiment={...run,best:{...run.best,components:{weighted_total:.59}},totalCandidates:2,candidates:[first,{...item('/candidate2',.59),id:2,previousComponents:first.components}]};payload.pagination.total=2;
 await poll();assert.equal(images.length,5,'only the new candidate needs an image node');
 assert.ok(root.contains(source));assert.ok(root.contains(baseline));assert.ok(root.contains(candidate));assert.equal(get('candidates').children[0],card);
 await poll();assert.equal(images.length,5,'unchanged polls create no images');
 card.children[0].onclick();assert.ok(get('viewer').open);assert.ok(get('viewer-image').src);
 get('viewer').close();assert.equal(get('viewer-image').src,'');
 component.setActive(false);const before=fetches;await poll();assert.equal(fetches,before,'inactive panel does not poll');
 component.destroy();assert.ok(cleared);
});
