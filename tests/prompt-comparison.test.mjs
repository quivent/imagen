import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
const source=(await readFile(new URL('../src/prompt-comparison.js',import.meta.url),'utf8')).replace(/^import[^\n]*\n/gm,'').replaceAll('export function ','function ');
class Node{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this._text='';}
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(n=>n.textContent).join(' ');}
 setAttribute(key,value){this.attributes[key]=String(value);}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;this._text='';}
 all(tag){return [...(this.tagName===tag?[this]:[]),...this.children.flatMap(n=>n.all(tag))];}
}
const makeContext=()=>{const document=new EventTarget();document.hidden=false;document.createElement=tag=>new Node(tag);let poll;const context={document,AbortController,setInterval:fn=>{poll=fn;return 1;},clearInterval(){},setTimeout:()=>1,clearTimeout(){},tick:()=>poll?.()};vm.createContext(context);vm.runInContext(source+'\nglobalThis.exports={mountPromptComparison,promptWordDiff};',context);return context;};
test('word diff independently highlights exact removals and additions, including repeated words',()=>{
 const {exports:{promptWordDiff}}=makeContext();const diff=promptWordDiff('blue water and blue sky','blue sky and clear water');
 assert.equal(diff.left.map(x=>x.text).join(''),'blue water and blue sky');assert.equal(diff.right.map(x=>x.text).join(''),'blue sky and clear water');assert.ok(diff.removed);assert.ok(diff.added.includes('clear'));
 const identical=promptWordDiff('One turtle swims.','One turtle swims.');assert.equal(identical.added,'');assert.equal(identical.removed,'');
});
test('all 150 saved baselines preserve full source provenance and actual budget counts',async()=>{
 const data=JSON.parse(await readFile(new URL('../research/studies/art-direction-held-constant/baselines-40.json',import.meta.url),'utf8'));
 const original=JSON.parse(await readFile(new URL('../research/studies/art-direction-held-constant/corpus.json',import.meta.url),'utf8'));
 assert.equal(data.scenes.length,150);const lookup=new Map(original.scenes.map(s=>[s.id,s]));
 for(const scene of data.scenes){assert.equal(scene.sourcePrompt,lookup.get(scene.id).prompt);assert.equal(scene.baselineAuthor,'Imagen assistant');assert.ok(scene.baselinePrompt.split(/\s+/).length>=20);assert.ok(scene.baselinePrompt.toLowerCase().includes('painterly realism'));assert.ok(scene.baselineTokens.clip<=data.baselineClipBudget);assert.ok(scene.baselineTokens.clip>=20);assert.ok(scene.baselineTokens.t5<512);assert.equal(scene.baselineSha256,createHash('sha256').update(scene.baselinePrompt).digest('hex'));}
});

test('all 150 revisions have actual Qwen receipts, exact baseline hashes and native token limits',async()=>{
 const data=JSON.parse(await readFile(new URL('../research/studies/art-direction-held-constant/baselines-40.json',import.meta.url),'utf8'));
 assert.equal(data.scenes.length,150);assert.equal(data.tokenizerProvenance.addSpecialTokens,true);assert.equal(data.tokenizerProvenance.truncation,false);
 for(const scene of data.scenes){
  assert.equal(scene.precisionAuthor,'Qwen',scene.id);assert.ok(scene.precisionPrompt.trim());assert.ok(scene.precisionTokens.clip<=77);assert.ok(scene.precisionTokens.t5<=512);
  assert.equal(scene.semanticReviewStatus,'approved',scene.id);assert.equal(scene.revisionStatus,'qwen-revised-token-verified');assert.deepEqual(scene.semanticReview.lostBaselineContent,[]);assert.deepEqual(scene.semanticReview.inventedSubjects,[]);
  assert.equal(scene.revisionBaselineSha256,scene.baselineSha256);assert.equal(scene.revisionReceipt.baselineSha256,scene.baselineSha256);
  assert.equal(scene.precisionSha256,createHash('sha256').update(scene.precisionPrompt).digest('hex'));assert.equal(scene.sourcePromptSha256,createHash('sha256').update(scene.sourcePrompt).digest('hex'));
  assert.equal(scene.revisionReceipt.requestedModel,'qwen-precision');assert.ok(scene.revisionReceipt.responseId);assert.ok(scene.revisionReceipt.usage.completion_tokens>0);
 }
});
test('comparison shows full baseline and real Qwen revision counts, bounded scene buttons and source text',async()=>{
 const context=makeContext(),root=new Node(),scenes=Array.from({length:12},(_,i)=>({id:'scene-'+i,name:'Place '+i,baselinePrompt:'Blue water beneath a pale sky.',precisionPrompt:'Pale sky above clear blue water.',precisionAuthor:'Qwen',baselineTokens:{clip:12,t5:10},precisionTokens:{clip:14,t5:11},sourcePrompt:'Preserved full source '+i}));
 const mounted=context.exports.mountPromptComparison({root,fetch:async()=>({ok:true,json:async()=>({scenes})})});mounted.setActive(true);await new Promise(resolve=>setImmediate(resolve));
 assert.ok(root.textContent.includes('Assistant baseline'));assert.ok(root.textContent.includes('Qwen revision'));assert.ok(root.textContent.includes('CLIP 12 / 77'));assert.ok(root.textContent.includes('T5 11 / 512'));assert.ok(root.textContent.includes('awaits independent review'));
 assert.equal(root.all('BUTTON').filter(n=>n.textContent.startsWith('Place')).length,10);assert.equal(root.all('SELECT').length,0);assert.equal(root.all('IMG').length,0);assert.ok(root.all('DEL').length);assert.ok(root.all('INS').length);
 root.all('BUTTON').find(n=>n.textContent==='Next scenes').onclick();assert.ok(root.textContent.includes('Preserved full source 10'));assert.equal(root.all('BUTTON').filter(n=>n.textContent.startsWith('Place')).length,2);mounted.destroy();
});

test('new revisions elsewhere retain the selected prompt nodes and open source disclosure',async()=>{
 const context=makeContext(),root=new Node(),selected={id:'first',name:'First',baselinePrompt:'A quiet shore.',historicalPrecisionPrompt:'Quiet shore with rocks.',sourcePrompt:'Full shore source.'};let scenes=[selected,{id:'second',name:'Second',baselinePrompt:'A hill.'}];
 const mounted=context.exports.mountPromptComparison({root,fetch:async()=>({ok:true,json:async()=>({scenes})})});mounted.setActive(true);await new Promise(resolve=>setImmediate(resolve));
 const disclosure=root.all('DETAILS').find(n=>n.textContent.includes('Preserved original source'));disclosure.open=true;const prompt=root.all('DEL')[0],sceneButton=root.all('BUTTON').find(n=>n.textContent==='First');
 scenes=[selected,{...scenes[1],precisionPrompt:'A grassy hill.',precisionAuthor:'Qwen'}];context.tick();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(root.all('DETAILS').find(n=>n.textContent.includes('Preserved original source')),disclosure);assert.equal(disclosure.open,true);assert.equal(root.all('DEL')[0],prompt);assert.equal(root.all('BUTTON').find(n=>n.textContent==='First'),sceneButton);assert.ok(root.textContent.includes('1 Qwen revisions'));mounted.destroy();
});

test('hidden and inactive comparisons abort pending reads',async()=>{
 const context=makeContext(),root=new Node(),signals=[];
 const mounted=context.exports.mountPromptComparison({root,fetch:(_url,{signal})=>new Promise((_resolve,reject)=>{signals.push(signal);signal.addEventListener('abort',()=>reject(new Error('aborted')));})});mounted.setActive(true);assert.equal(signals.length,1);
 context.document.hidden=true;context.document.dispatchEvent(new Event('visibilitychange'));assert.ok(signals[0].aborted);await new Promise(resolve=>setImmediate(resolve));
 context.document.hidden=false;context.document.dispatchEvent(new Event('visibilitychange'));assert.equal(signals.length,2);mounted.setActive(false);assert.ok(signals[1].aborted);await new Promise(resolve=>setImmediate(resolve));context.tick();assert.equal(signals.length,2);mounted.destroy();
});
