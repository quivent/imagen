import test from 'node:test';
import assert from 'node:assert/strict';
import {createComparisonPages} from '../src/comparison-pages.js';
const rows = Array.from({length:65},(_,id)=>({id:String(id)}));
test('Compare displays twenty pairs and opens the page containing a deep link',()=>{
 const pages=createComparisonPages();
 assert.equal(pages.update(rows,'44')[0].id,'40');
 assert.equal(pages.update(rows,'44').length,20);
 pages.move(1);assert.equal(pages.update(rows,'44').length,5);
 pages.move('latest');assert.equal(pages.update(rows,'44')[0].id,'0');
});
test('new generations retain the current older page anchor',()=>{
 const pages=createComparisonPages();pages.update(rows,'0');pages.move(1);
 assert.equal(pages.update(rows,'0')[0].id,'20');
 assert.equal(pages.update([{id:'new'},...rows],'0')[0].id,'20');
 assert.equal(pages.position.start,21);
 pages.move(-1);assert.equal(pages.update([{id:'new'},...rows],'0')[0].id,'0');
});
test('deleted records and empty collections stay bounded',()=>{
 const pages=createComparisonPages();pages.update(rows,'64');
 assert.equal(pages.update([],null).length,0);assert.equal(pages.position.start,0);
 assert.equal(pages.update(rows.slice(0,3),'2').length,3);
});
