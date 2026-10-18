import assert from 'node:assert/strict';
import test from 'node:test';
import { localWorkstationRequest } from '../server/workstation-session.mjs';

test('workstation authorization requires loopback transport, Host and matching Origin', () => {
  const request = { socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:48624', origin: 'http://127.0.0.1:48624' } };
  assert.equal(localWorkstationRequest(request), true);
  for (const headers of [
    { host: 'artwork.influx.vision', origin: 'https://artwork.influx.vision' },
    { host: '127.0.0.1:48624', origin: 'https://imagen-studio-hazel.vercel.app' },
    { host: '127.0.0.1:48624', origin: 'https://foreign.test' },
    { host: 'foreign.test', origin: 'http://foreign.test' },
    { host: '127.0.0.1:48624' },
  ]) assert.equal(localWorkstationRequest({ ...request, headers }), false);
  assert.equal(localWorkstationRequest({ ...request, socket: { remoteAddress: '192.0.2.1' } }), false);
});
