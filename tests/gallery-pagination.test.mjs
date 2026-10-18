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
test('Production → Precision filters before paging and counting, retaining model filters', () => {
  const study=(id,created,profile='flux1-dev')=>({...row(id,created,profile),scene:'adhc-'+id});
  const collection={jobs:[row('old',99),{...row('other',98),scene:'different-study'},study('a',3),study('b',2),study('c',1),study('second-model',4,'flux2-dev-nf4')]};
  const params=new URLSearchParams({collection:'production-precision',profile:'flux1-dev',limit:'2'});
  const first=galleryPage(collection,params);
  assert.equal(first.totalJobs,3);assert.deepEqual(first.jobs.map(job=>job.id),['a','b']);
  collection.jobs.unshift(study('new',100));params.set('cursor',first.nextCursor);
  const second=galleryPage(collection,params);
  assert.equal(second.totalJobs,4);assert.deepEqual(second.jobs.map(job=>job.id),['c']);assert.equal(second.nextCursor,null);
  const both=galleryPage(collection,new URLSearchParams({collection:'production-precision'}));
  assert.equal(both.totalJobs,5);assert.ok(both.jobs.some(job=>job.profile==='flux2-dev-nf4'));
});
test('All artworks and omitted collection preserve earlier source objects',()=>{
  const jobs=[row('legacy',5),{...row('new',4),scene:'adhc-new'},{...row('not-study',3),scene:'xadhc-no'},{...row('missing',2),scene:null}];
  for(const params of [new URLSearchParams(),new URLSearchParams({collection:'all'})]){
    const page=galleryPage({jobs},params);assert.equal(page.totalJobs,4);assert.deepEqual(page.jobs,jobs);
  }
  const page=galleryPage({jobs},new URLSearchParams({collection:'production-precision'}));assert.deepEqual(page.jobs.map(job=>job.id),['new']);
  assert.equal(jobs.length,4);assert.equal(jobs[0].id,'legacy');
  assert.throws(()=>galleryPage({jobs},new URLSearchParams({collection:'unknown'})),/Invalid collection/);
});
