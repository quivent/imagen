import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
test('two study buttons persist selection and preserve explicit historical experiment links',async()=>{
 const code=(await readFile(new URL('../src/study-context.js',import.meta.url),'utf8')).replaceAll('export ','');
 const values=new Map();
 const boot=(pathname='/research',search='')=>{const c={location:{pathname,search},URLSearchParams,localStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)}};vm.runInNewContext(code+'\nglobalThis.study={workbenchStudies,selectedStudy,selectStudy,observeStudy};',c);return c.study;};
 let study=boot();assert.equal(study.selectedStudy(),'flux1-prompt-clarity');assert.equal(study.workbenchStudies.length,2);
 let calls=0;const release=study.observeStudy(()=>calls++);study.selectStudy('not-a-study');assert.equal(calls,0);study.selectStudy('glsl-worlds');assert.equal(calls,1);study.selectStudy('glsl-worlds');assert.equal(calls,1);release();
 study=boot();assert.equal(study.selectedStudy(),'glsl-worlds');study.selectStudy('flux1-prompt-clarity');assert.equal(boot().selectedStudy(),'flux1-prompt-clarity');assert.equal(boot('/workbench','?experiment=4').selectedStudy(),'glsl-worlds');
});
test('Production study selection persists independently from Workbench',async()=>{
 const code=(await readFile(new URL('../src/study-context.js',import.meta.url),'utf8')).replaceAll('export ','');
 const values=new Map(),boot=()=>{const c={location:{pathname:'/stream',search:''},URLSearchParams,localStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)}};vm.runInNewContext(code+'\nglobalThis.study={productionStudies,selectedProductionStudy,selectProductionStudy,observeProductionStudy,selectedStudy,selectStudy};',c);return c.study;};
 let study=boot();assert.equal(study.selectedProductionStudy(),'flux1-prompt-clarity');assert.equal(study.productionStudies.length,2);
 let calls=0;const release=study.observeProductionStudy(()=>calls++);study.selectProductionStudy('glsl-worlds');assert.equal(calls,0);study.selectProductionStudy('production');assert.equal(calls,1);study.selectProductionStudy('production');assert.equal(calls,1);study.selectStudy('glsl-worlds');assert.equal(study.selectedProductionStudy(),'production');assert.equal(calls,1);release();
 study=boot();assert.equal(study.selectedProductionStudy(),'production');assert.equal(study.selectedStudy(),'glsl-worlds');study.selectProductionStudy('flux1-prompt-clarity');assert.equal(boot().selectedProductionStudy(),'flux1-prompt-clarity');
});
