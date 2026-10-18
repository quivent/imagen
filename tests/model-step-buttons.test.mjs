import assert from 'node:assert/strict';
import test from 'node:test';
import { mountModelStepButtons } from '../src/model-step-buttons.js';

test('each model retains its own selected steps across clicks and saved-state refreshes', () => {
  const profiles = ['flux1-dev', 'flux2-dev-nf4'];
  const buttons = profiles.flatMap(profile => (profile === 'flux1-dev' ? [16, 28, 36] : [28, 40, 50]).map(steps => ({
    dataset: { stepButtonProfile: profile, steps: String(steps) }, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(_name, handler) { this.click = handler; }, removeEventListener() {},
  })));
  const modelSteps = { 'flux1-dev': 28, 'flux2-dev-nf4': 28 };
  const saved = [];
  const controls = mountModelStepButtons({ root: { querySelectorAll: () => buttons }, modelSteps, changed: () => saved.push({ ...modelSteps }) });
  buttons.find(button => button.dataset.stepButtonProfile === 'flux2-dev-nf4' && button.dataset.steps === '50').click();
  assert.deepEqual(modelSteps, { 'flux1-dev': 28, 'flux2-dev-nf4': 50 });
  buttons.find(button => button.dataset.stepButtonProfile === 'flux1-dev' && button.dataset.steps === '16').click();
  assert.deepEqual(modelSteps, { 'flux1-dev': 16, 'flux2-dev-nf4': 50 });
  assert.deepEqual(saved.at(-1), modelSteps);
  for (const profile of profiles) assert.deepEqual(buttons.filter(button => button.dataset.stepButtonProfile === profile && button.attributes['aria-pressed'] === 'true').map(button => Number(button.dataset.steps)), [modelSteps[profile]]);
  modelSteps['flux1-dev'] = 36; controls.refresh();
  assert.equal(modelSteps['flux2-dev-nf4'], 50);
  assert.equal(buttons.find(button => button.dataset.stepButtonProfile === 'flux2-dev-nf4' && button.dataset.steps === '50').attributes['aria-pressed'], 'true');
  controls.destroy();
});
