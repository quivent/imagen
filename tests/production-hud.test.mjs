import test from 'node:test';
import assert from 'node:assert/strict';
import {productionHUD} from '../server/production-hud.mjs';
const now=1800000000000;
const flow={totalPairs:9,daemon:{currentPackage:'x',lanes:[{gpuIndex:0,workerPort:18761,runnerAlive:true,enabled:true,heartbeatAt:now/1000}]},pairs:[{images:{left:{seconds:2},right:{seconds:4}}}]};
const monitor={generation:{observedAt:new Date(now).toISOString(),workers:[{port:18761,phase:'ready',running:1}],archive:{alive:true,pendingJobs:0,observedAt:new Date(now).toISOString()}}};
test('green requires fresh worker evidence; render mean uses receipts',()=>{
 const h=productionHUD({flow,monitor,now});assert.equal(h.lanes[0].state,'running');assert.equal(h.averageRenderSeconds,3);assert.equal(h.samples,2);assert.equal(h.completedImages,18);assert.equal(h.stages[2].state,'ready');
 const idle=structuredClone(monitor);idle.generation.workers[0].running=0;assert.equal(productionHUD({flow,monitor:idle,now}).lanes[0].state,'waiting');
});
test('loaded models, stale observations and stopped runners cannot claim rendering',()=>{
 assert.equal(productionHUD({flow,monitor,now:now+20000}).lanes[0].state,'error');
 const stale=structuredClone(monitor);stale.generation.observedAt=new Date(now-20000).toISOString();assert.equal(productionHUD({flow,monitor:stale,now}).lanes[0].state,'unknown');
 const stopped=structuredClone(flow);stopped.daemon.lanes[0].runnerAlive=false;const idle=structuredClone(monitor);idle.generation.workers[0].running=0;assert.equal(productionHUD({flow:stopped,monitor:idle,now}).lanes[0].state,'error');
});
test('a paused scheduler still reports its observed in-flight image; R2 freshness is independent',()=>{
 const paused=structuredClone(flow);paused.daemon.lanes[0].enabled=false;
 assert.equal(productionHUD({flow:paused,monitor,now}).lanes[0].label,'Finishing current image');
 const stale=structuredClone(monitor);stale.generation.archive.observedAt=new Date(now-60000).toISOString();
 assert.equal(productionHUD({flow,monitor:stale,now}).stages[2].state,'unknown');
});
