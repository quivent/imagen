import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { authorizedStudioRequest } from './corrections.mjs';
const file = fileURLToPath(new URL('../winners.json', import.meta.url));
const helper = fileURLToPath(new URL('../scripts/winners.py', import.meta.url));
export function installWinners(server) {
  server.middlewares.use(async (request, response, next) => {
    if (new URL(request.url, 'http://localhost').pathname !== '/api/studio-winners') { next(); return; }
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', 'application/json');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (code, data) => response.writeHead(code).end(JSON.stringify(data));
    try {
      if (request.method === 'GET') { send(200, JSON.parse(await readFile(file, 'utf8'))); return; }
      if (request.method !== 'POST') { send(405, { ok: false }); return; }
      const origins = new Set(['https://artwork.influx.vision', ...[server.config.server.port, server.config.preview.port].flatMap(port => [`http://127.0.0.1:${port}`, `http://localhost:${port}`])]);
      if (!origins.has(request.headers.origin) || !await authorizedStudioRequest(request)) { send(403, { ok: false }); return; }
      if (!String(request.headers['content-type'] || '').startsWith('application/json')) { send(415, { ok: false }); return; }
      let body = ''; for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 2048) { send(413, { ok: false }); return; } }
      const data = JSON.parse(body);
      if (!data || typeof data.comparisonId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.comparisonId) || typeof data.requestId !== 'string') { send(400, { ok: false }); return; }
      await new Promise(resolve => {
        const child = execFile('python3', ['-B', helper], { timeout: 10000, maxBuffer: 2 * 1024 * 1024 }, (error, output) => {
          try { const result = error ? { ok: false, status: 503 } : JSON.parse(output); send(result.status || (result.ok ? 200 : 503), result); }
          catch { send(503, { ok: false }); }
          resolve();
        });
        child.stdin.end(body);
      });
    } catch { send(503, { ok: false }); }
  });
}
