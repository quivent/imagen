import test from 'node:test';
import assert from 'node:assert/strict';
import { galleryPage } from '../server/gallery-pagination.mjs';
const row = (id, created, profile = 'flux1-dev') => ({ id, created, profile });
test('stable pages retain every image through inserts and equal timestamps', () => {
  const collection = { jobs: [row('a', 3), row('b', 2), row('c', 2), row('d', 1), row('other', 9, 'flux2-dev-nf4')] };
  const params = new URLSearchParams({ limit: '2', profile: 'flux1-dev' });
  const first = galleryPage(collection, params);
  assert.equal(first.totalJobs, 4); assert.equal(first.jobs.length, 2);
  collection.jobs.push(row('new', 10));
  params.set('cursor', first.nextCursor);
  const second = galleryPage(collection, params);
  assert.deepEqual(new Set([...first.jobs, ...second.jobs].map(r => r.id)), new Set(['a','b','c','d']));
  assert.equal(second.nextCursor, null);
});
test('invalid bounds and cursors fail instead of returning the full archive', () => {
  for (const query of ['limit=0', 'limit=101', 'limit=NaN', 'cursor=bad', 'profile=unknown']) assert.throws(() => galleryPage({ jobs: [] }, new URLSearchParams(query)));
  assert.equal(galleryPage({ jobs: [] }, new URLSearchParams()).nextCursor, null);
});
