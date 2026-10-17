import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';

// Explicit opt-in: observes existing telemetry only; never requests generation.
const origin = process.env.STUDIO_TEST_ORIGIN;
test('all public topics survive the initial gallery burst on one socket', { skip: !origin, timeout: 30000 }, async t => {
  const topics = ['gallery', 'comparisons', 'tasks', 'agents', 'monitor', 'winners'];
  const results = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((resolve, reject) => {
      const started = performance.now();
      const socket = new WebSocket(new URL('/api/studio-events', origin).href.replace(/^http/, 'ws'), { origin });
      const seen = new Map();
      let complete = false;
      const timeout = setTimeout(() => { socket.terminate(); reject(new Error(`Missing topics: ${topics.filter(topic => !seen.has(topic))}`)); }, 10000);
      socket.on('error', reject);
      socket.on('open', () => socket.send(JSON.stringify({ type: 'subscribe', topics })));
      socket.on('message', bytes => {
        const message = JSON.parse(bytes);
        if (!topics.includes(message.topic) || seen.has(message.topic)) return;
        try { assert.equal(message.type, 'snapshot', `${message.topic} available`); }
        catch (error) { clearTimeout(timeout); socket.terminate(); reject(error); return; }
        seen.set(message.topic, { ms: +(performance.now() - started).toFixed(2), bytes: bytes.length });
        if (seen.size !== topics.length) return;
        try {
          assert.ok([...seen.keys()].indexOf('monitor') < [...seen.keys()].indexOf('gallery'), 'current status arrives before the full archive');
        } catch (error) { clearTimeout(timeout); socket.terminate(); reject(error); return; }
        complete = true;
        results.push({ compression: socket.extensions || 'none', ...Object.fromEntries(seen) });
        clearTimeout(timeout);
        // Keep the first socket alive across ordinary telemetry updates too.
        if (attempt === 0) setTimeout(() => { socket.close(); resolve(); }, 4500);
        else { socket.close(); resolve(); }
      });
      socket.on('close', code => {
        if (!complete || code !== 1005) {
          clearTimeout(timeout);
          reject(new Error(`Unexpected close ${code}, received: ${[...seen.keys()]}`));
        }
      });
    });
  }
  t.diagnostic(JSON.stringify({ initialSnapshots: results }));
});
