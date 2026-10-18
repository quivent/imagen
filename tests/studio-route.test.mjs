import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {studioTabs,studioPaths,studioTab,studioTabURL,studioRedirect,studioPageRequest} from '../src/studio-route.js';
test('all studio tabs have canonical routes with matching early boot state',async()=>{
 const boot=await readFile(new URL('../public/boot.js',import.meta.url),'utf8');
 for(const tab of studioTabs){
  const route=studioPaths[tab];assert.equal(studioTab(route),tab);assert.equal(studioTabURL('http://studio.test/?tab='+tab,tab).pathname,route);assert.equal(studioPageRequest(route),'/index.html');
  const document={documentElement:{dataset:{}},addEventListener(){}};
  vm.runInNewContext(boot,{location:{pathname:route,search:'',hash:''},URLSearchParams,localStorage:{getItem(){return null;}},document,window:{addEventListener(){}},MutationObserver:class{observe(){}disconnect(){}}});
  assert.equal(document.documentElement.dataset.bootTab,tab,route);
 }
});
test('legacy links canonicalize and unrelated endpoints remain untouched',()=>{
 assert.equal(studioRedirect('/?tab=gallery&comparison=abc'),'/compare?comparison=abc');
 assert.equal(studioRedirect('/?tab=controls'),'/controls');
 assert.equal(studioRedirect('/metrics.html'),'/metrics');
 assert.equal(studioRedirect('/monitor/'),'/monitor');
 assert.equal(studioTab('/collections'),'winners');
 assert.equal(studioTab('/active'),'stream');
 assert.equal(studioTabURL('/workbench?experiment=2&method=pixel&page=3','models').search,'');
 for(const path of ['/api/world-experiments','/data/image.png','/worlds/draa-valley/']){assert.equal(studioRedirect(path),null);assert.equal(studioPageRequest(path),null);}
});
