import assert from 'node:assert/strict';
import test from 'node:test';
import { createGenerationSteps } from '../src/generation-steps.js';
const response = modelSteps => ({ ok: true, json: async () => ({ ok: true, modelSteps }) });

test('changing steps persists both independent counts and coalesces a newer edit without losing it', async () => {
  const counts = { 'flux1-dev': 16, 'flux2-dev-nf4': 50 };
  const writes = []; const messages = []; let release;
  const first = new Promise(resolve => { release = resolve; });
  const controller = createGenerationSteps({ read: () => counts, apply: values => Object.assign(counts, values), status: message => messages.push(message),
    request: async (url, options) => { assert.equal(url, '/api/generation-steps'); assert.equal(options.credentials, 'same-origin'); const value = JSON.parse(options.body).modelSteps; writes.push(value); if (writes.length === 1) await first; return response(value); } });
  const saving = controller.save(); counts['flux2-dev-nf4'] = 36; controller.save(); release(); await saving;
  assert.deepEqual(writes, [{ 'flux1-dev': 16, 'flux2-dev-nf4': 50 }, { 'flux1-dev': 16, 'flux2-dev-nf4': 36 }]);
  assert.equal(counts['flux1-dev'], 16); assert.equal(counts['flux2-dev-nf4'], 36);
  assert.match(messages.at(-1), /FLUX.1 16 steps · FLUX.2 36 steps/);
});

test('unauthorized changes are never described as applied and retry after unlock retains the chosen counts', async () => {
  const counts = { 'flux1-dev': 20, 'flux2-dev-nf4': 50 }; const messages = []; let unlocked = false; let writes = 0;
  const controller = createGenerationSteps({ read: () => counts, apply: values => Object.assign(counts, values), status: message => messages.push(message),
    request: async (_url, options) => { writes++; const values = JSON.parse(options.body).modelSteps; return unlocked ? response(values) : { ok: false, status: 403 }; } });
  await controller.save(); assert.equal(messages.at(-1), 'The studio connection is unavailable. These steps have not been applied.');
  unlocked = true; await controller.retry(); assert.equal(writes, 2); assert.match(messages.at(-1), /Next images/);
});

test('an older server read cannot overwrite a step edit', async () => {
  let finishRead; const counts = { 'flux1-dev': 28, 'flux2-dev-nf4': 28 };
  const controller = createGenerationSteps({ read: () => counts, apply: value => Object.assign(counts, value), status: () => {},
    request: async (_url, options) => options.method === 'POST' ? response(JSON.parse(options.body).modelSteps) : await new Promise(resolve => { finishRead = resolve; }) });
  const loading = controller.load(); counts['flux1-dev'] = 16; counts['flux2-dev-nf4'] = 50; await controller.save();
  finishRead(response({ 'flux1-dev': 28, 'flux2-dev-nf4': 28 })); await loading;
  assert.deepEqual(counts, { 'flux1-dev': 16, 'flux2-dev-nf4': 50 });
});
