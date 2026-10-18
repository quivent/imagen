import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('step presets update only the selected model and survive selection synchronization', async () => {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const start = source.indexOf("      generationField(key).value = value === 'random'");
  const end = source.indexOf('\n    });', start);
  assert.ok(start > 0 && end > start);
  const fields = { profile: { value: 'flux1-dev' }, steps: { value: '28' } };
  const modelSteps = { 'flux1-dev': 28, 'flux2-dev-nf4': 50 };
  const context = vm.createContext({ key: 'steps', value: 16, modelSteps, modelParameters: { 'flux1-dev': {}, 'flux2-dev-nf4': {} }, generationField: key => fields[key], syncSelection: () => { fields.steps.value = String(modelSteps[fields.profile.value]); } });
  vm.runInContext(source.slice(start, end), context);
  assert.equal(modelSteps['flux1-dev'], 16);
  assert.equal(modelSteps['flux2-dev-nf4'], 50);
  assert.equal(fields.steps.value, '16');
  fields.profile.value = 'flux2-dev-nf4'; context.value = 36;
  vm.runInContext(source.slice(start, end), context);
  assert.equal(modelSteps['flux1-dev'], 16);
  assert.equal(modelSteps['flux2-dev-nf4'], 36);
  assert.equal(fields.steps.value, '36');
});
