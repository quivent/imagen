import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import WebSocket, { WebSocketServer } from 'ws';

const hopHeaders = new Set(['connection', 'upgrade', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'host']);
const records = new Set(['/tasks.json', '/agent-status.json', '/monitor-state.json', '/winners.json', '/data/comparisons.json']);
export function targetPath(raw) {
  const url = new URL(raw, 'http://localhost');
  const route = url.searchParams.get('__studio_path');
  url.searchParams.delete('__studio_path');
  const pathname = route || url.pathname;
  if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('%') || pathname.split('/').some(part => part === '..' || part === '.')) return null;
  if (!pathname.startsWith('/api/') && !records.has(pathname) && !/^\/data\/[A-Za-z0-9_/-]+\.(png|jpe?g|webp|avif)$/.test(pathname)) return null;
  if (pathname === '/api/studio') return null;
  // Platform routing can attach captured route parameters. The local image
  // endpoint deliberately accepts exactly the immutable job/hash identity.
  if (pathname === '/api/local-gallery/image') {
    const job = url.searchParams.get('job');
    const sha256 = url.searchParams.get('sha256');
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(job || '') || !/^[a-f0-9]{64}$/.test(sha256 || '')) return null;
    return pathname + '?' + new URLSearchParams({ job, sha256 });
  }
  return pathname + url.search;
}

function sameOrigin(req) {
  try { return new URL(req.headers.origin).host === req.headers.host; }
  catch { return false; }
}
function forwardHeaders(req, origin) {
  const headers = Object.fromEntries(Object.entries(req.headers).filter(([key]) => !hopHeaders.has(key) && !key.startsWith('x-forwarded-') && !key.startsWith('x-vercel-')));
  headers.origin = origin.origin;
  return headers;
}

// Vercel hosts the UI and this connection bridge; persistent work stays on the
// existing studio. No SSH keys, model credentials or daemon state are deployed.
export function createStudioBridge({ origin = process.env.ARTWORK_STUDIO_ORIGIN || 'https://artwork.influx.vision' } = {}) {
  const upstream = new URL(origin);
  if (upstream.username || upstream.password || upstream.pathname !== '/' || upstream.search || upstream.hash || !['http:', 'https:'].includes(upstream.protocol)) throw new Error('ARTWORK_STUDIO_ORIGIN must be an HTTP(S) origin');
  if (process.env.VERCEL && upstream.protocol !== 'https:') throw new Error('The deployed studio backend must use HTTPS');
  const server = createServer((req, res) => {
    const path = targetPath(req.url);
    if (!path) { res.writeHead(404).end(); return; }
    if (!['GET', 'HEAD', 'POST'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD, POST' }).end(); return; }
    if (req.method === 'POST' && !sameOrigin(req)) { res.writeHead(403).end(); return; }
    const send = upstream.protocol === 'https:' ? httpsRequest : httpRequest;
    const pending = send(new URL(path, upstream), { method: req.method, headers: forwardHeaders(req, upstream) }, response => {
      const headers = Object.fromEntries(Object.entries(response.headers).filter(([key]) => !hopHeaders.has(key)));
      // Operational snapshots and authenticated responses must not become CDN cache entries.
      if (!/\/(?:image|images)(?:\/|\?|$)/.test(path) && !/^\/data\/.*\.(png|jpe?g|webp|avif)(\?|$)/.test(path)) headers['cache-control'] = 'no-store';
      res.writeHead(response.statusCode, headers);
      res.flushHeaders();
      response.pipe(res);
      response.on('error', () => res.destroy());
    });
    pending.setTimeout(65000, () => pending.destroy());
    pending.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'Cache-Control': 'no-store' }).end('Studio backend unavailable'); else res.destroy(); });
    req.on('aborted', () => pending.destroy());
    res.on('close', () => pending.destroy());
    req.pipe(pending);
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536 });
  server.on('upgrade', (req, socket, head) => {
    const path = targetPath(req.url);
    if (path?.split('?')[0] !== '/api/studio-events' || !sameOrigin(req)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    const destination = new URL(path, upstream); destination.protocol = upstream.protocol === 'https:' ? 'wss:' : 'ws:';
    const remote = new WebSocket(destination, { headers: { Origin: upstream.origin, ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {}) }, handshakeTimeout: 10000, maxPayload: 32 * 1024 * 1024 });
    socket.once('close', () => { if (remote.readyState !== WebSocket.CLOSED) remote.terminate(); });
    remote.once('open', () => {
      wss.handleUpgrade(req, socket, head, client => {
        remote.on('message', (data, binary) => {
          if (client.readyState !== WebSocket.OPEN) return;
          if (client.bufferedAmount > 32 * 1024 * 1024) { client.close(1013); return; }
          client.send(data, { binary });
        });
        client.on('message', (data, binary) => { if (remote.readyState === WebSocket.OPEN) remote.send(data, { binary }); });
        client.on('close', () => remote.close());
        client.on('error', () => remote.terminate());
        remote.on('close', () => client.close(1012, 'Reconnect to studio'));
        remote.on('error', () => client.close(1011));
      });
    });
    remote.on('error', () => { if (!socket.destroyed) socket.destroy(); });
  });
  return server;
}
