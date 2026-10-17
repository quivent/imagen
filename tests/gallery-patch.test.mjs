import assert from 'node:assert/strict';
import test from 'node:test';
import { createGalleryPatch, applyGalleryPatch } from '../src/gallery-patch.js';

const snapshot = (version, jobs, metadata = {}) => ({ type: 'snapshot', topic: 'gallery', version, observedAt: '2026-10-17T23:00:00Z', available: true, data: { ...metadata, jobs } });
const row = (id, seconds = 3) => ({ id, profile: 'flux1-dev', seconds });

test('coalesced versions preserve the entire archive and exact ordering with insertions, corrections and removals', () => {
  const before = snapshot(1, [row('a'), row('b'), row('c')], { oldMetadata: true });
  const next = snapshot(4, [row('new'), row('a', 4), row('c')], { updatedAt: 'new', exclusions: { count: 1 } });
  const patch = createGalleryPatch(before, next);
  assert.equal(patch.baseVersion, 1);
  assert.equal(patch.version, 4);
  assert.deepEqual(patch.removed, ['flux1-dev:b']);
  assert.equal(patch.order, undefined, 'ordinary insertions need no full order vector');
  const merged = applyGalleryPatch(before, patch);
  assert.deepEqual(merged.data, next.data);
  assert.equal(merged.data.jobs[2], before.data.jobs[2], 'unchanged cached rows preserve identity');
  assert.equal(merged.data.oldMetadata, undefined);
});

test('archive reconciliation can reorder unchanged rows without losing any record', () => {
  const before = snapshot(7, [row('a'), row('b'), row('c')]);
  const next = snapshot(8, [row('c'), row('b'), row('a')]);
  const patch = createGalleryPatch(before, next);
  assert.deepEqual(patch.order, ['flux1-dev:c', 'flux1-dev:b', 'flux1-dev:a']);
  assert.deepEqual(applyGalleryPatch(before, patch).data, next.data);
});

test('a new observation is small while a fresh connection still receives the full snapshot', () => {
  const archive = Array.from({ length: 1000 }, (_, index) => row('archived-' + index));
  const before = snapshot(1, archive);
  const next = snapshot(2, [row('new'), ...archive]);
  const patch = createGalleryPatch(before, next);
  assert.ok(JSON.stringify(patch).length < JSON.stringify(next).length / 100);
  assert.equal(applyGalleryPatch(before, patch).data.jobs.length, 1001);
});

test('missing or inconsistent baselines and malformed updates require a full resync', () => {
  const before = snapshot(1, [row('a')]);
  const patch = createGalleryPatch(before, snapshot(2, [row('new'), row('a')]));
  assert.throws(() => applyGalleryPatch(null, patch));
  assert.throws(() => applyGalleryPatch({ ...before, version: 0 }, patch));
  assert.throws(() => applyGalleryPatch(before, { ...patch, upserts: [{ index: 99, job: row('new') }] }));
  assert.throws(() => applyGalleryPatch(before, { ...patch, order: ['flux1-dev:new', 'flux1-dev:new'] }));
});
