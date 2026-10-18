import assert from 'node:assert/strict';
import test from 'node:test';
import {createFrameScheduler} from '../public/worlds/draa-valley/frame-scheduler.js';
function harness(){
 let clock=0,sequence=0,shown=true,animated=false,movement=false;
 const pending=new Map(),frames=[];
 const scheduler=createFrameScheduler({request:fn=>{pending.set(++sequence,fn);return sequence;},cancel:id=>pending.delete(id),now:()=>clock,visible:()=>shown,continuous:()=>animated,moving:()=>movement,draw:(time,dt)=>frames.push({time,dt})});
 return {scheduler,pending,frames,setVisible:value=>shown=value,setAnimated:value=>animated=value,setMoving:value=>movement=value,tick(){clock+=16;const [id,fn]=pending.entries().next().value;pending.delete(id);fn(clock);},advance:ms=>clock+=ms};
}
test('fixed-clock views coalesce changes and stop requesting frames when idle',()=>{
 const h=harness();h.scheduler.invalidate();h.scheduler.invalidate();assert.equal(h.pending.size,1);h.tick();assert.equal(h.frames.length,1);assert.equal(h.pending.size,0);
 h.advance(30000);h.scheduler.invalidate();h.tick();assert.ok(h.frames[1].dt<=.05);assert.equal(h.pending.size,0);
});
test('animation and held movement continue with one queued frame',()=>{
 const h=harness();h.setAnimated(true);h.scheduler.invalidate();h.tick();assert.equal(h.pending.size,1);h.setAnimated(false);h.setMoving(true);h.tick();assert.equal(h.pending.size,1);h.setMoving(false);h.tick();assert.equal(h.pending.size,0);
});
test('hidden and suspended views stop, then resume on explicit invalidation',()=>{
 const h=harness();h.setAnimated(true);h.scheduler.invalidate();h.scheduler.suspend();assert.equal(h.pending.size,0);h.setVisible(false);h.scheduler.invalidate();assert.equal(h.pending.size,0);h.setVisible(true);h.scheduler.invalidate();h.tick();assert.equal(h.frames.length,1);h.scheduler.destroy();assert.equal(h.pending.size,0);h.scheduler.invalidate();assert.equal(h.pending.size,0);
});
