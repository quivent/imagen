import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';
import { applyComparisonsPatch } from '../src/comparisons-patch.js';

const origin = process.env.STUDIO_TEST_ORIGIN;
test('natural Compare updates use deltas, preserve exact provenance and support complete resync', { skip: !origin, timeout: 60000 }, async t => {
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(new URL('/api/studio-events', origin).href.replace(/^http/, 'ws'), { origin });
    let state;
    let initialBytes;
    let patches = 0;
    let resyncVersion = null;
    let resynced = false;
    let complete = false;
    const samples = [];
    const timeout = setTimeout(() => { socket.terminate(); reject(new Error('No natural Compare update; no generation was requested by this test')); }, 55000);
    const fail = error => { clearTimeout(timeout); socket.terminate(); reject(error); };
    socket.on('open', () => socket.send(JSON.stringify({ type: 'subscribe', topics: ['comparisons'], features: ['comparisons-patch-v1'] })));
    socket.on('error', fail);
    socket.on('message', bytes => {
      try {
        const message = JSON.parse(bytes);
        if (message.topic !== 'comparisons') return;
        assert.notEqual(message.type, 'unavailable');
        if (message.type === 'snapshot') {
          if (resyncVersion !== null) {
            assert.ok(message.version >= resyncVersion);
            if (message.version === state.version) assert.deepEqual(message.data, state.data, 'complete resync equals the reconstructed archive including provenance');
            resynced = true;
          }
          state = { ...message, available: true }; initialBytes ??= bytes.length;
        } else if (message.type === 'patch') {
          assert.equal(message.baseVersion, state.version);
          state = applyComparisonsPatch(state, message); patches++;
          assert.equal(new Set(state.data.comparisons.map(row => row.id)).size, state.data.comparisons.length);
          samples.push({ bytes: bytes.length, changedPairs: message.upserts.length, retainedPairs: state.data.comparisons.length, publicationAgeMs: Date.now() - Date.parse(message.observedAt) });
          if (patches === 1) { resyncVersion = state.version; socket.send(JSON.stringify({ type: 'resync', topic: 'comparisons' })); }
        }
        if (patches >= 2 && resynced) {
          assert.ok(samples.some(sample => sample.bytes < initialBytes / 10));
          clearTimeout(timeout); complete = true; socket.close(); t.diagnostic(JSON.stringify({ initialBytes, samples })); resolve();
        }
      } catch (error) { fail(error); }
    });
    socket.on('close', code => { if (!complete) fail(new Error('Unexpected close ' + code)); });
  });
});
