import assert from 'node:assert/strict';
import test from 'node:test';
import { createComparisonsPatch, applyComparisonsPatch } from '../src/comparisons-patch.js';

const pair = id => ({ id, title: id, prompt: 'Recorded prompt', left: { jobId: id + '-left', imageSha256: 'recorded-left-hash', seconds: 3.25, precision: 'BF16' }, right: { jobId: id + '-right', imageSha256: 'recorded-right-hash', seconds: 8.5, precision: 'BF16 / NF4 encoder' } });
const snapshot = (version, rows, extra = {}) => ({ type: 'snapshot', topic: 'comparisons', version, available: true, observedAt: '2026-10-17T23:00:00Z', data: { schemaVersion: 1, ...extra, comparisons: rows } });

test('comparison deltas preserve exact pair identities, job provenance, corrections and full metadata across coalescing', () => {
  const before = snapshot(1, [pair('kept'), pair('corrected'), pair('excluded')], { obsolete: true });
  const corrected = { ...pair('corrected'), left: { ...pair('corrected').left, jobId: 'exact-new-job', seconds: 2.8125, imageSha256: 'exact-corrected-hash' } };
  const next = snapshot(5, [pair('kept'), corrected, pair('added')], { exclusions: { count: 1 } });
  const patch = createComparisonsPatch(before, next);
  assert.deepEqual(patch.removed, ['excluded']);
  assert.equal(patch.upserts.length, 2);
  const result = applyComparisonsPatch(before, patch);
  assert.deepEqual(result.data, next.data);
  assert.equal(result.data.comparisons[0], before.data.comparisons[0], 'unchanged pair keeps its object identity');
  assert.equal(result.data.comparisons[1].left.jobId, 'exact-new-job');
  assert.equal(result.data.comparisons[1].left.seconds, 2.8125);
  assert.equal(result.data.obsolete, undefined);
});

test('comparison ordering reconciles without truncation and a gap cannot use another collection baseline', () => {
  const before = snapshot(7, [pair('a'), pair('b'), pair('c')]);
  const next = snapshot(8, [pair('c'), pair('b'), pair('a')]);
  const patch = createComparisonsPatch(before, next);
  assert.deepEqual(applyComparisonsPatch(before, patch).data, next.data);
  assert.throws(() => applyComparisonsPatch({ ...before, topic: 'gallery' }, patch));
  assert.throws(() => applyComparisonsPatch({ ...before, version: 6 }, patch));
});

test('one changed pair does not retransmit hundreds of unchanged pairs', () => {
  const archive = Array.from({ length: 300 }, (_, index) => pair('pair-' + index));
  const before = snapshot(1, archive);
  const next = snapshot(2, [...archive, pair('next-pair')]);
  const patch = createComparisonsPatch(before, next);
  assert.equal(patch.upserts.length, 1);
  assert.ok(JSON.stringify(patch).length < JSON.stringify(next).length / 100);
  assert.equal(applyComparisonsPatch(before, patch).data.comparisons.length, 301);
});
