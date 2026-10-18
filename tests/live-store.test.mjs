import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('wire topics follow active consumers, gallery mode releases, and patch recovery preserves other topics', async () => {
  const previous = Object.fromEntries(['document', 'window', 'location', 'WebSocket'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const document = new EventTarget(); document.hidden = false;
  const window = new EventTarget();
  const connections = [];
  class Socket extends EventTarget {
    static OPEN = 1;
    readyState = 0;
    sent = [];
    constructor() { super(); connections.push(this); }
    send(value) { this.sent.push(JSON.parse(value)); }
    open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
    message(value) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  }
  for (const [key, value] of Object.entries({ document, window, location: { href: 'http://localhost/' }, WebSocket: Socket })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  try {
    const source = (await readFile(new URL('../src/live-store.js', import.meta.url), 'utf8'))
      .replace("'./site-performance.js'", JSON.stringify(new URL('../src/site-performance.js', import.meta.url).href))
      .replace("'./gallery-patch.js'", JSON.stringify(new URL('../src/gallery-patch.js', import.meta.url).href))
      .replace("'./comparisons-patch.js'", JSON.stringify(new URL('../src/comparisons-patch.js', import.meta.url).href));
    const { studioLive } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
    const keepAlive = studioLive.subscribe('comparisons', () => {});
    await Promise.resolve();
    const socket = connections[0]; socket.open();
    const publish = (topic, version, data) => socket.message({ type: 'snapshot', topic, version, data });
    assert.deepEqual(socket.sent[0].topics,['comparisons']);
    assert.ok(socket.sent[0].features.includes('gallery-preview-v1'));
    const recentRelease=studioLive.subscribe('gallery-recent',()=>{});await Promise.resolve();
    assert.deepEqual(socket.sent.at(-1).topics,['comparisons','gallery']);
    assert.ok(socket.sent.at(-1).features.includes('gallery-recent-only-v1'));
    publish('gallery-recent',1,{jobs:[{id:'preview',profile:'flux1-dev'}],counts:{'flux1-dev':3}});
    assert.equal((await studioLive.read('gallery-recent')).jobs[0].id,'preview');
    const fullRelease=studioLive.subscribe('gallery',()=>{});await Promise.resolve();
    assert.ok(!socket.sent.at(-1).features.includes('gallery-recent-only-v1'));
    publish('gallery',2,{jobs:[{id:'archive',profile:'flux1-dev'}]});
    assert.equal((await studioLive.read('gallery')).jobs[0].id,'archive');
    socket.message({type:'patch',topic:'gallery',baseVersion:2,version:4,metadata:{updatedAt:'latest'},removed:[],upserts:[{index:0,job:{id:'incremental'}}]});
    assert.deepEqual((await studioLive.read('gallery')).jobs.map(row=>row.id),['incremental','archive']);
    socket.message({type:'patch',topic:'gallery',baseVersion:1,version:5,metadata:{},removed:[],upserts:[]});
    assert.equal(socket.sent.at(-1).type,'resync');
    await assert.rejects(studioLive.read('gallery'));
    publish('gallery',5,{jobs:[{id:'recovered'}]});
    assert.equal((await studioLive.read('gallery')).jobs[0].id,'recovered');
    fullRelease();await Promise.resolve();
    assert.ok(socket.sent.at(-1).features.includes('gallery-recent-only-v1'),'last archive consumer releases full-gallery mode');
    assert.ok(socket.sent.at(-1).topics.includes('gallery'),'recent consumer still receives gallery preview');
    recentRelease();await Promise.resolve();
    assert.deepEqual(socket.sent.at(-1).topics,['comparisons']);
    publish('comparisons',10,{schemaVersion:1,comparisons:[{id:'kept-pair'}]});
    for(let visit=0;visit<10;visit++){
      const received=[],release=studioLive.subscribe('comparisons',value=>received.push(value));await Promise.resolve();
      assert.equal(received[0].data.comparisons[0].id,'kept-pair');release();await Promise.resolve();
    }
    assert.equal(connections.length,1,'tab switches reuse the shared socket');
    socket.message({type:'patch',topic:'comparisons',baseVersion:10,version:13,metadata:{schemaVersion:1},removed:[],upserts:[{index:1,job:{id:'new-pair'}}]});
    assert.deepEqual((await studioLive.read('comparisons')).comparisons.map(row=>row.id),['kept-pair','new-pair']);
    socket.message({type:'patch',topic:'comparisons',baseVersion:11,version:14,metadata:{},removed:[],upserts:[]});
    assert.deepEqual(socket.sent.at(-1),{type:'resync',topic:'comparisons'});
    await assert.rejects(studioLive.read('comparisons'));
    publish('comparisons',14,{schemaVersion:1,comparisons:[{id:'recovered-pair'}]});
    const privateSnapshots=[],privateRelease=studioLive.subscribe('controls',value=>privateSnapshots.push(value));await Promise.resolve();
    publish('controls',1,{authorized:true});privateRelease();await Promise.resolve();
    assert.ok(!socket.sent.at(-1).topics.includes('controls'));
    const reopen=studioLive.subscribe('controls',value=>privateSnapshots.push(value));await Promise.resolve();
    assert.equal(privateSnapshots.length,1,'private cache does not survive leaving Controls');reopen();
    socket.close();await assert.rejects(studioLive.read('comparisons'),error=>error.status===503);
    document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));await Promise.resolve();
    keepAlive();await Promise.resolve();
  } finally {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
