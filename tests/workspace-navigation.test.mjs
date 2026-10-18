import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceTabs,workspaceForTab} from '../src/workspace-navigation.js';
import {studioTabs} from '../src/studio-route.js';
test('Production is focused, Workbench has research tools, and shared views retain either context',()=>{
 assert.deepEqual([...new Set(Object.values(workspaceTabs).flat())].sort(),[...studioTabs].sort());
 for(const tab of ['stream','gallery','models','worlds']){
  assert.equal(workspaceForTab(tab,'production'),'production');assert.equal(workspaceForTab(tab,'workbench'),'workbench');
 }
 for(const tab of ['workbench','research','agents','metrics'])assert.equal(workspaceForTab(tab,'production'),'workbench');
 assert.equal(workspaceForTab('controls','workbench'),'production');
 assert.ok(!workspaceTabs.production.includes('research'));
});
