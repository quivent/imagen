import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readWorkbenchRoute,workbenchURL,isWorkbenchPath} from '../src/workbench-route.js';
test('canonical route roundtrips readable experiment, method and page state',()=>{
 const state={studyId:'experiment-2',method:1,page:3};
 const url=workbenchURL('https://studio.test/?tab=workbench&study=experiment-1&comparison=old&studio=1',state);
 assert.equal(url.pathname,'/workbench');assert.equal(url.search,'?studio=1&experiment=2&method=pixel&page=3');
 assert.deepEqual(readWorkbenchRoute(url),{...state,legacyRun:null});
 assert.equal(workbenchURL(url,{...state,page:null}).searchParams.has('page'),false);
 for(const method of [1,2,3,4,5])assert.equal(readWorkbenchRoute(workbenchURL(url,{...state,method})).method,method);
 assert.ok(isWorkbenchPath('/workbench/'));assert.equal(isWorkbenchPath('/worlds/'),false);
});
test('legacy study and run selections retain source and method context',()=>{
 assert.equal(readWorkbenchRoute('/?tab=workbench&study=experiment-1&method=2').studyId,'experiment-1');
 const old=readWorkbenchRoute('/?experiment=method1-exp2-run1');assert.equal(old.studyId,'experiment-2');assert.equal(old.method,1);
 assert.equal(readWorkbenchRoute('/?experiment=method2-run2').studyId,'experiment-1');
 assert.equal(readWorkbenchRoute('/workbench?method=999&page=-3').method,1);
});
