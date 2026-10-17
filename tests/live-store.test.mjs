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
    const source = (await readFile(new URL('../src/live-store.js', import.meta.url), 'utf8')).replace("'./site-performance.js'", JSON.stringify(new URL('../src/site-performance.js', import.meta.url).href));
    const { studioLive } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
    const keepAlive = studioLive.subscribe('comparisons', () => {});
    await Promise.resolve();
    const socket = connections[0]; socket.open();
    const publish = (topic, version, data) => socket.message({ type: 'snapshot', topic, version, data });
    publish('gallery', 1, { jobs: [{ id: 'existing-archive' }] });
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
