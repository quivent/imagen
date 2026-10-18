import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {galleryPageRequest} from '../server/gallery-page.mjs';
import {studioTab,studioPageRequest} from '../src/studio-route.js';
import {workspaceTabs,workspaceForTab} from '../src/workspace-navigation.js';
test('gallery-only entry stays separate from the studio and shares its archive component',async()=>{
 assert.equal(galleryPageRequest('/gallery'),'/gallery.html');assert.equal(galleryPageRequest('/gallery/?view=x'),'/gallery.html?view=x');
 assert.equal(galleryPageRequest('/gallery/studio'),null);assert.equal(studioTab('/gallery'),null);assert.equal(studioTab('/gallery/studio'),'archive');assert.equal(studioPageRequest('/gallery/studio'),'/index.html');assert.equal(workspaceForTab('archive'),'gallery');assert.deepEqual(workspaceTabs.gallery,['archive']);
 const html=await readFile(new URL('../gallery.html',import.meta.url),'utf8');assert.ok(html.includes('gallery-entry.js'));for(const text of ['studio-access','boot.js','src/app.js','workspace-navigation','control-panel','seers'])assert.ok(!html.includes(text));
 const entry=await readFile(new URL('../src/gallery-entry.js',import.meta.url),'utf8');assert.ok(entry.includes('mountArchiveGallery'));assert.ok(!entry.includes('studioLive'));
 const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));assert.equal(config.rewrites.find(r=>r.source==='/gallery').destination,'/gallery.html');
});
