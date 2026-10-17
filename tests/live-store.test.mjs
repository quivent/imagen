import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('unchanged public topics remain immediately readable across tab switches', async () => {
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
    assert.equal(socket.sent[0].topics.length, 6, 'preview feature does not add a wire subscription unsupported by older servers');
    assert.ok(socket.sent[0].features.includes('gallery-preview-v1'));
    publish('gallery-recent', 1, { jobs: [{ id: 'preview', profile: 'flux1-dev' }], counts: { 'flux1-dev': 3 } });
    assert.equal((await studioLive.read('gallery-recent')).jobs[0].id, 'preview');
    let archiveResolved = false;
    const archive = studioLive.read('gallery').then(() => { archiveResolved = true; });
    await Promise.resolve();
    assert.equal(archiveResolved, false, 'archive/statistics consumers never receive a partial preview');
    publish('gallery', 1, { jobs: [{ id: 'existing-archive', profile: 'flux1-dev' }, { id: 'older-a', profile: 'flux1-dev' }, { id: 'older-b', profile: 'flux1-dev' }] });
    await archive;
    assert.equal((await studioLive.read('gallery-recent')).counts['flux1-dev'], 3, 'full snapshots also supply recent data for older servers');
    for (let visit = 0; visit < 20; visit++) {
      const received = [];
      const release = studioLive.subscribe('gallery', snapshot => received.push(snapshot));
      await Promise.resolve();
      assert.equal(received[0]?.data.jobs[0].id, 'existing-archive');
      assert.equal((await studioLive.read('gallery')).jobs[0].id, 'existing-archive');
      release();
      await Promise.resolve();
    }
    assert.equal(socket.sent.length, 1, 'public tab switches do not resubscribe or open new sockets');
    assert.equal(connections.length, 1);
    publish('gallery', 2, { jobs: [{ id: 'newer' }] });
    publish('gallery', 1, { jobs: [{ id: 'older' }] });
    assert.equal((await studioLive.read('gallery')).jobs[0].id, 'newer');
    socket.message({ type: 'patch', topic: 'gallery', baseVersion: 2, version: 4, metadata: { updatedAt: 'latest' }, removed: [], upserts: [{ index: 0, job: { id: 'incremental' } }] });
    assert.deepEqual((await studioLive.read('gallery')).jobs.map(row => row.id), ['incremental', 'newer']);
    socket.message({ type: 'patch', topic: 'gallery', baseVersion: 1, version: 5, metadata: {}, removed: [], upserts: [] });
    assert.equal(socket.sent.at(-1).type, 'resync');
    await assert.rejects(studioLive.read('gallery'));
    publish('gallery', 5, { jobs: [{ id: 'recovered-full-archive' }] });
    assert.equal((await studioLive.read('gallery')).jobs[0].id, 'recovered-full-archive');
    publish('comparisons', 10, { schemaVersion: 1, comparisons: [{ id: 'kept-pair', left: { jobId: 'left-original' }, right: { jobId: 'right-original' } }] });
    publish('winners', 2, { winners: [{ comparisonId: 'kept-pair', side: 'left', selection: { jobId: 'left-original' } }] });
    socket.message({ type: 'patch', topic: 'comparisons', baseVersion: 10, version: 13, metadata: { schemaVersion: 1 }, removed: [], upserts: [{ index: 1, job: { id: 'new-pair', left: { jobId: 'left-new' }, right: { jobId: 'right-new' } } }] });
    assert.deepEqual((await studioLive.read('comparisons')).comparisons.map(row => row.id), ['kept-pair', 'new-pair']);
    assert.equal((await studioLive.read('winners')).winners[0].selection.jobId, 'left-original');
    socket.message({ type: 'patch', topic: 'comparisons', baseVersion: 11, version: 14, metadata: {}, removed: [], upserts: [] });
    assert.deepEqual(socket.sent.at(-1), { type: 'resync', topic: 'comparisons' });
    await assert.rejects(studioLive.read('comparisons'));
    assert.equal((await studioLive.read('gallery')).jobs[0].id, 'recovered-full-archive', 'comparison gap recovery does not discard gallery');
    publish('comparisons', 14, { schemaVersion: 1, comparisons: [{ id: 'full-recovered-pair' }] });
    assert.equal((await studioLive.read('comparisons')).comparisons[0].id, 'full-recovered-pair');
    const privateSnapshots = [];
    const privateRelease = studioLive.subscribe('controls', snapshot => privateSnapshots.push(snapshot));
    await Promise.resolve();
    publish('controls', 1, { authorized: true });
    privateRelease(); await Promise.resolve();
    const reopen = studioLive.subscribe('controls', snapshot => privateSnapshots.push(snapshot));
    await Promise.resolve();
    assert.equal(privateSnapshots.length, 1, 'private cache does not survive leaving Controls');
    reopen();
    socket.close();
    await assert.rejects(studioLive.read('gallery'), error => error.status === 503);
    document.hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    keepAlive();
    await Promise.resolve();
  } finally {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
