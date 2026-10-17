import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { reconcileComparisonOptions } from '../src/comparison-options.js';

class Node {
  constructor() { this.children = []; this.dataset = {}; this.textContent = ''; this.value = ''; this.classList = { toggle() {} }; }
  setAttribute() {}
  append(child) { this.insertBefore(child, null); }
  insertBefore(child, before) { child.remove(); const index = before ? this.children.indexOf(before) : this.children.length; this.children.splice(index, 0, child); child.parent = this; }
  replaceChildren(...children) { for (const child of [...this.children]) child.remove(); for (const child of children) this.append(child); }
  remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } }
  replaceWith(next) { const parent = this.parent; const following = parent.children[parent.children.indexOf(this) + 1]; this.remove(); parent.insertBefore(next, following || null); }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
}

test('growing Compare reuses options and selected image nodes, preserves rating focus, and defers hidden DOM', async () => {
  // Exercise the production render functions with metadata-only DOM doubles;
  // no artwork bytes, browser image loading, or synthetic images are involved.
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const gridCode = source.slice(source.indexOf('function renderComparisonGrid() {'), source.indexOf("$('comparison-grid').addEventListener('focusout'"));
  const renderCode = source.slice(source.indexOf('function render() {'), source.indexOf('function choose(id) {'));
  const nodes = new Map();
  const $ = id => { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); };
  const rows = Array.from({ length: 261 }, (_, index) => ({ id: 'pair-' + index, title: 'Pair ' + index, prompt: 'Recorded prompt', left: { model: 'Left', seconds: 3 }, right: { model: 'Right', seconds: 8 } }));
  const state = { rows, id: rows[0].id, loaded: true, swapped: false, renderedId: null };
  const counts = { options: 0, cards: 0, inspectorImages: 0, noteReads: 0 };
  const document = { activeElement: null };
  const context = vm.createContext({ state, activeTab: 'stream', document, $, current: () => state.rows.find(row => row.id === state.id), comparisonCards: new Map(),
    createComparisonCard: row => { counts.cards++; const card = new Node(); card.dataset.comparison = row.id; return card; },
    modelCard: side => { counts.inspectorImages++; const card = new Node(); card.side = side; return card; },
    detailPanel: () => new Node(),
    reconcileComparisonOptions: (select, values) => reconcileComparisonOptions(select, values, () => { counts.options++; return new Node(); }),
    localStorage: { getItem: () => { counts.noteReads++; return 'Saved note'; } },
  });
  vm.runInContext(gridCode + '\n' + renderCode, context);
  vm.runInContext('render()', context);
  assert.deepEqual(counts, { options: 0, cards: 0, inspectorImages: 0, noteReads: 0 }, 'hidden Compare creates no card, option or inspector DOM');
  context.activeTab = 'gallery'; vm.runInContext('render()', context);
  assert.deepEqual(counts, { options: 261, cards: 261, inspectorImages: 2, noteReads: 1 });
  const selectedImages = [...$('pair').children];
  const selectedOption = $('scene').children[0];
  const focusedCard = $('comparison-grid').children[10];
  document.activeElement = focusedCard;
  state.rows = [{ id: 'new-pair', title: 'Newest pair', left: {}, right: {} }, ...state.rows];
  vm.runInContext('render()', context);
  assert.equal(counts.options, 262, 'one new pair creates one option, not a new set of 262');
  assert.equal(counts.cards, 261, 'focused rating/card stays attached while grid updates wait');
  assert.equal($('scene').children[1], selectedOption);
  assert.equal($('pair').children[0], selectedImages[0]);
  assert.equal(counts.inspectorImages, 2);
  assert.equal(counts.noteReads, 1);
  assert.ok($('comparison-grid').contains(document.activeElement));
  document.activeElement = null; vm.runInContext('renderComparisonGrid()', context);
  assert.equal(counts.cards, 262);
  assert.equal($('comparison-grid').children[11], focusedCard, 'existing card survives the prepend');
  state.swapped = true; vm.runInContext('render()', context);
  assert.equal(counts.inspectorImages, 4, 'swapping still updates the inspector');
  state.rows[1] = { ...state.rows[1], left: { model: 'Left', seconds: 2.5 } };
  vm.runInContext('render()', context);
  assert.equal(counts.inspectorImages, 6, 'a corrected receipt invalidates the selected inspector');
  assert.equal($('pair').children[1].side.seconds, 2.5);
  assert.equal($('note').value, 'Saved note');
});
