import assert from 'node:assert/strict';
import test from 'node:test';
import { createSitePerformance } from '../src/site-performance.js';

test('site observations distinguish navigation, frame scheduling, resource delays and socket cache age', () => {
  let time = 0;
  let wall = 10000;
  const frames = [];
  const observers = new Map();
  class Observer {
    static supportedEntryTypes = ['resource', 'paint', 'largest-contentful-paint', 'longtask'];
    constructor(callback) { this.callback = callback; }
    observe({ type, buffered }) { assert.equal(buffered, true); observers.set(type, this); }
    disconnect() { this.disconnected = true; }
  }
  const win = new EventTarget(); win.location = { href: 'https://example.test/?control=secret' };
  const metrics = createSitePerformance({ perf: { now: () => time, getEntriesByType: () => [{ startTime: 0, responseStart: 25, domContentLoadedEventEnd: 80, loadEventEnd: 0 }] }, now: () => wall, Observer, frame: callback => frames.push(callback), win });
  const emit = (type, entries) => observers.get(type).callback({ getEntries: () => entries });
  emit('resource', [{ name: 'https://example.test/assets/main.js?token=private#secret', initiatorType: 'script', duration: 1400, transferSize: 2048, responseStatus: 200 }]);
  emit('paint', [{ name: 'first-contentful-paint', startTime: 95 }]);
  emit('largest-contentful-paint', [{ startTime: 160 }]);
  emit('longtask', [{ startTime: 110, duration: 65 }]);
  metrics.registerTabs(['stream', 'performance']);
  time = 200; const finish = metrics.beginTab('performance'); time = 210; finish();
  time = 220; frames.shift()(); time = 240; frames.shift()();
  metrics.socketStart(); time = 270; metrics.socketOpen();
  time = 310;
  metrics.socketTopic('monitor', { type: 'snapshot', observedAt: new Date(8000).toISOString(), data: { observedAt: new Date(7000).toISOString() } }, 300);
  time = 320; frames.shift()(); time = 340; frames.shift()();
  const error = new Event('error'); Object.defineProperty(error, 'filename', { value: 'https://example.test/app.js?private=secret' }); win.dispatchEvent(error);
  const data = metrics.snapshot();
  assert.deepEqual(data.navigation, { ttfb: 25, dom: 80, load: null, fcp: 95, lcp: 160 });
  assert.equal(data.resources[0].path, '/assets/main.js');
  assert.deepEqual(data.groups, [{ type: 'script', count: 1, totalMs: 1400, worstMs: 1400, bytes: 2048 }]);
  assert.equal(data.tabs[0].count, 0, 'unvisited tabs remain unmeasured');
  assert.equal(data.tabs[1].latestMs, 40);
  assert.equal(data.tabs[1].handlerMs, 10);
  assert.equal(data.socket.connectMs, 30);
  assert.equal(data.topics[0].initialMs, 40);
  assert.equal(data.topics[0].handlerMs, 10);
  assert.equal(data.topics[0].frameMs, 40);
  assert.equal(data.topics[0].receivedAt - data.topics[0].publicationAt, 2000, 'cached publication age is distinct from connection and frame timing');
  assert.equal(data.errors[0].path, '/app.js');
  assert.equal(data.longTasks[0].duration, 65);
  emit('resource', Array.from({ length: 550 }, () => ({ name: 'https://example.test/item', duration: 1, initiatorType: 'fetch', transferSize: 0 })));
  emit('longtask', Array.from({ length: 110 }, () => ({ startTime: 1, duration: 60 })));
  for (let count = 0; count < 60; count++) win.dispatchEvent(new Event('unhandledrejection'));
  assert.equal(metrics.snapshot().resources.length, 500);
  assert.equal(metrics.snapshot().resourceCount, 551);
  assert.equal(metrics.snapshot().longTasks.length, 100);
  assert.equal(metrics.snapshot().errors.length, 50);
  metrics.socketClose(); assert.equal(metrics.snapshot().topics[0].available, false);
  metrics.socketStart(); assert.equal(metrics.snapshot().socket.reconnects, 1);
  metrics.socketOpen(); assert.equal(metrics.snapshot().topics[0].initialMs, null);
  metrics.socketClose(false); metrics.socketStart();
  assert.equal(metrics.snapshot().socket.reconnects, 1, 'visibility resumes do not inflate failure reconnects');
  metrics.destroy(); assert.ok([...observers.values()].every(observer => observer.disconnected));
});

test('unsupported APIs stay unknown', () => {
  const metrics = createSitePerformance({ perf: { now: () => 0, getEntriesByType: () => [] }, Observer: null, frame: null, win: null });
  metrics.registerTabs(['stream']); metrics.beginTab('stream')();
  const data = metrics.snapshot();
  assert.equal(data.supported.longtask, false);
  assert.equal(data.frameSupported, false);
  assert.equal(data.tabs[0].latestMs, null);
  assert.equal(data.navigation.ttfb, null);
  assert.deepEqual(data.resources, []);
  metrics.destroy();
});

test('background suspension does not become a false slow frame', () => {
  let time = 0;
  const frames = [];
  const doc = new EventTarget(); doc.hidden = false;
  const metrics = createSitePerformance({ perf: { now: () => time }, Observer: null, frame: callback => frames.push(callback), win: null, doc });
  metrics.registerTabs(['tasks']); metrics.beginTab('tasks')();
  frames.shift()();
  doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
  doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange'));
  time = 60000; frames.shift()();
  assert.equal(metrics.snapshot().tabs[0].latestMs, null);
  metrics.destroy();
});
