import assert from 'node:assert/strict';
import test from 'node:test';
import { modelRequest } from '../src/model-parameters.js';

test('both-model requests use each model’s own parameters', () => {
  const state = {
    modelSteps: { f1: 16, f2: 50 }, modelResolution: { f1: 512, f2: 1024 }, modelGuidance: { f1: null, f2: 5 },
    modelParameters: { f1: { seed: 42, count: 2, guidance_scale: 3.5 }, f2: { seed: 123, count: 4, guidance_scale: 4 } },
  };
  const first = modelRequest({ prompt: 'Same existing scene', width: 256, steps: 28, count: 1 }, 'f1', state);
  const second = modelRequest({ prompt: 'Same existing scene', width: 256, steps: 28, count: 1 }, 'f2', state);
  assert.deepEqual(first, { profile: 'f1', prompt: 'Same existing scene', width: 512, height: 512, steps: 16, count: 2, seed: 42, guidance_scale: 3.5 });
  assert.deepEqual(second, { profile: 'f2', prompt: 'Same existing scene', width: 1024, height: 1024, steps: 50, count: 4, seed: 123, guidance_scale: 5 });
  state.modelParameters.f2.seed = 2026;
  assert.deepEqual(modelRequest({ prompt: 'Same existing scene', width: 256, steps: 28, count: 1 }, 'f1', state), first);
});
