import assert from 'node:assert/strict';
import test from 'node:test';
import { pollArchiveGallery } from '../server/archive-gallery.mjs';

test('periodic archive discovery publishes new jobs, suppresses duplicates and survives failure', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let value = { ok: true, jobs: [{ id: 'first' }] };
  const observed = [];
  const poller = pollArchiveGallery({ load: async () => { if (value instanceof Error) throw value; return value; }, onChange: data => observed.push(data) });
  t.after(() => poller.stop());
  await poller.refresh(); assert.equal(observed.length, 1);
  t.mock.timers.tick(10000); await poller.refresh(); assert.equal(observed.length, 1);
  value = { ok: true, jobs: [{ id: 'first' }, { id: 'new-r2-only' }] };
  t.mock.timers.tick(10000); await poller.refresh(); assert.equal(observed[1].jobs[1].id, 'new-r2-only');
  value = Error('Archive temporarily unavailable');
  t.mock.timers.tick(10000); await poller.refresh(); assert.equal(observed.length, 2);
  value = { ok: true, jobs: [{ id: 'recovered' }] };
  t.mock.timers.tick(10000); await poller.refresh(); assert.equal(observed[2].jobs[0].id, 'recovered');
  value = { jobs: [] };
  await poller.refresh(); assert.equal(observed.length, 3);
  poller.stop(); t.mock.timers.tick(10000); await poller.refresh(); assert.equal(observed.length, 3);
});

test('overlapping requests share one fetch; stopping prevents late publication', async () => {
  let calls = 0, finish;
  const observed = [];
  const poller = pollArchiveGallery({ load: () => { calls++; return new Promise(resolve => { finish = resolve; }); }, onChange: value => observed.push(value) });
  const first = poller.refresh(); const second = poller.refresh();
  await Promise.resolve(); assert.equal(calls, 1);
  assert.equal(first, second);
  poller.stop(); finish({ ok: true, jobs: [] }); await first;
  assert.deepEqual(observed, []);
});
