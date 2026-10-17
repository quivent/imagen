import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('a usable response reaches the browser before durable cache writing finishes', { timeout: 1000 }, async () => {
  const handlers = new Map();
  let finishWrite;
  let writing = false;
  const write = new Promise(resolve => { finishWrite = resolve; });
  // No image bytes: this tests fetch-event lifetime and response ordering only.
  const response = { ok: true, status: 200, headers: new Headers({ 'Content-Type': 'image/png' }), clone: () => ({ cachedCopy: true }) };
  const context = vm.createContext({ URL, Headers, fetch: async () => response,
    caches: { open: async () => ({ match: async () => undefined, put: () => { writing = true; return write; } }) },
    self: { location: { origin: 'https://example.test' }, addEventListener: (name, callback) => handlers.set(name, callback) },
  });
  vm.runInContext(await readFile(new URL('../public/image-cache-sw.js', import.meta.url), 'utf8'), context);
  let delivered;
  let lifetime;
  handlers.get('fetch')({ request: { method: 'GET', url: 'https://example.test/data/ordinary.png', headers: new Headers() }, respondWith: value => { delivered = value; }, waitUntil: value => { lifetime = value; } });
  assert.equal(await delivered, response);
  assert.equal(writing, true);
  let finished = false;
  lifetime.then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false, 'worker lifetime still protects the pending durable write');
  finishWrite(); await lifetime;
  assert.equal(finished, true);
});
