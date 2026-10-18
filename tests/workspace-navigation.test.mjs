import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {workspaceTabs,workspaceForTab} from '../src/workspace-navigation.js';
import {studioTabs,studioPaths} from '../src/studio-route.js';
test('requested split shares Stream and Compare and separates operational contexts',()=>{
 assert.deepEqual([...new Set(Object.values(workspaceTabs).flat())].sort(),[...studioTabs].sort());
 assert.deepEqual(workspaceTabs.worlds,['worlds']);
 for(const area of Object.keys(workspaceTabs))assert.equal(workspaceForTab('worlds',area),'worlds');
 assert.deepEqual(workspaceTabs.workbench,['workbench','research','stream','gallery','workbench-controls','workbench-tasks','workbench-agents','qwen','pixtral-chat']);
 for(const tab of ['stream','gallery'])for(const area of ['production','workbench'])assert.equal(workspaceForTab(tab,area),area);
 for(const tab of ['winners','controls','tasks','agents','protocol','rules','monitor'])assert.equal(workspaceForTab(tab,'workbench'),'production');
 for(const tab of ['workbench','research','workbench-controls','workbench-tasks','workbench-agents'])assert.equal(workspaceForTab(tab,'production'),'workbench');
});
test('early boot agrees with workspace ownership for every route and saved workspace',async()=>{
 const boot=await readFile(new URL('../public/boot.js',import.meta.url),'utf8');
 for(const preferred of Object.keys(workspaceTabs))for(const tab of studioTabs){
  const document={documentElement:{dataset:{}},addEventListener(){}};
  vm.runInNewContext(boot,{location:{pathname:studioPaths[tab],search:'',hash:''},URLSearchParams,localStorage:{getItem(key){return key==='imagen:workspace'?preferred:null;}},document,window:{addEventListener(){}},MutationObserver:class{observe(){}disconnect(){}}});
  assert.equal(document.documentElement.dataset.workspace,workspaceForTab(tab,preferred),preferred+' '+tab);
  assert.equal(document.documentElement.dataset.bootTab,tab);
 }
});
