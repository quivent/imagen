import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import WebSocket, { WebSocketServer } from 'ws';
import { createStudioBridge, targetPath } from '../server/vercel-studio.mjs';

test('bridge routes only studio APIs and public runtime records', () => {
  assert.equal(targetPath('/api/studio?__studio_path=/api/gallery&key=one'), '/api/gallery?key=one');
  const identity = 'job=existing&sha256=' + 'a'.repeat(64);
  assert.equal(targetPath('/api/studio?__studio_path=/api/local-gallery/image&path=local-gallery/image&' + identity), '/api/local-gallery/image?' + identity);
  for (const path of ['/.runtime/service-env.json', '/scripts/file.py', '/api/studio', '/api/studio?__studio_path=//evil.test/api/test', '/api/studio?__studio_path=/api/../secret', '/api/studio?__studio_path=/api/%2e%2e/secret']) assert.equal(targetPath(path), null, path);
});

test('HTTP, streaming and WebSocket bridge preserve existing sessions and reject foreign writes', async t => {
  let hits = 0;
  const upstream = createServer((req, res) => {
    hits++;
    if (req.url === '/api/seers/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: ready\n\n'); setTimeout(() => res.end('data: done\n\n'), 20); return;
    }
    let body = ''; req.on('data', data => { body += data; });
    req.on('end', () => { res.setHeader('Set-Cookie', '__Host-artwork-control=signed; Secure; Path=/; HttpOnly'); res.end(JSON.stringify({ url: req.url, origin: req.headers.origin, cookie: req.headers.cookie, body })); });
  });
  const wss = new WebSocketServer({ server: upstream });
  wss.on('connection', (socket, req) => { socket.send(JSON.stringify({ origin: req.headers.origin, cookie: req.headers.cookie })); socket.on('message', data => socket.send(data.toString())); });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const origin = `http://127.0.0.1:${upstream.address().port}`;
  const bridge = createStudioBridge({ origin });
  bridge.listen(0, '127.0.0.1'); await once(bridge, 'listening');
  const base = `http://127.0.0.1:${bridge.address().port}`;
  t.after(() => { for (const socket of wss.clients) socket.terminate(); bridge.closeAllConnections(); bridge.close(); upstream.closeAllConnections(); upstream.close(); wss.close(); });
  const rejected = await fetch(base + '/api/control/submit', { method: 'POST', headers: { Origin: 'https://foreign.test' }, body: 'no' });
  assert.equal(rejected.status, 403); assert.equal(hits, 0);
  const response = await fetch(base + '/api/studio?__studio_path=/api/control/session', { method: 'POST', headers: { Origin: base, Cookie: '__Host-artwork-control=retained' }, body: 'payload' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('set-cookie'), /^__Host-artwork-control=/);
  assert.deepEqual(await response.json(), { url: '/api/control/session', origin, cookie: '__Host-artwork-control=retained', body: 'payload' });
  const stream = await fetch(base + '/api/seers/events');
  assert.equal(stream.headers.get('content-type'), 'text/event-stream');
  assert.equal(await stream.text(), 'data: ready\n\ndata: done\n\n');
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/api/studio?__studio_path=/api/studio-events', { origin: base, headers: { Cookie: '__Host-artwork-control=retained' } });
  const first = once(socket, 'message');
  await once(socket, 'open');
  assert.deepEqual(JSON.parse((await first)[0]), { origin, cookie: '__Host-artwork-control=retained' });
  const echo = once(socket, 'message'); socket.send('subscribe'); assert.equal((await echo)[0].toString(), 'subscribe');
  socket.close(); await once(socket, 'close');
  const foreign = new WebSocket(base.replace('http:', 'ws:') + '/api/studio-events', { origin: 'https://foreign.test' });
  const [error] = await once(foreign, 'error'); assert.match(error.message, /403/);
});

test('working studio retains all tools; Vercel remembers explicit active studio mode', () => {
  const source = readFileSync(new URL('../public/studio-access.js', import.meta.url), 'utf8');
  const values = new Map();
  const run = (hostname, search = '') => {
    const document = { documentElement: { dataset: {} } };
    vm.runInNewContext(source, { document, URLSearchParams, location: { hostname, search, hash: '' }, sessionStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) } });
    return document.documentElement.dataset.studioMode;
  };
  for (const hostname of ['localhost', '127.0.0.1', 'artwork.influx.vision']) {
    assert.equal(run(hostname), 'studio');
    assert.equal(run(hostname, '?studio=0'), 'studio');
  }
  const hosted = 'imagen-studio-hazel.vercel.app';
  assert.equal(run(hosted), 'public');
  assert.equal(run(hosted, '?studio=1'), 'studio');
  assert.equal(run(hosted, '?tab=controls'), 'studio');
  assert.equal(run(hosted, '?studio=0'), 'public');
  const css = readFileSync(new URL('../src/worlds.css', import.meta.url), 'utf8');
  const rule = css.split('\n')[0];
  for (const name of ['controls', 'tasks', 'performance', 'metrics', 'agents', 'daemons', 'monitor', 'seers', 'rules', 'protocol']) assert.ok(rule.includes('#tab-' + name));
  for (const name of ['stream', 'gallery', 'models', 'worlds', 'winners']) assert.ok(!rule.includes('#tab-' + name));
});
