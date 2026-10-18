import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldPageRequest,workbenchRedirect } from '../server/world-pages.mjs';
test('local world directories and legacy workbench links resolve correctly',()=>{
 assert.equal(worldPageRequest('/worlds/draa-valley/?recipe=abc'),'/worlds/draa-valley/index.html?recipe=abc');
 assert.equal(workbenchRedirect('/worlds/draa-valley/iterations/?method=2&page=3'),'/workbench?method=contour&page=3');
 assert.equal(workbenchRedirect('/worlds/draa-valley/algorithms/'),'/workbench?method=pixel');
 assert.equal(workbenchRedirect('/?tab=workbench&study=experiment-1&method=2&page=3'),'/workbench?experiment=1&method=contour&page=3');
 assert.equal(workbenchRedirect('/workbench/?experiment=2&method=pixel'),'/workbench?experiment=2&method=pixel');
 assert.equal(workbenchRedirect('/workbench?experiment=2&method=pixel'),null);
 for(const route of ['/api/world-experiments','/workbench','/worlds/draa-valley/scene.frag','/worlds/other/'])assert.equal(worldPageRequest(route),null);
});
