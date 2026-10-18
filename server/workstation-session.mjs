import { createHmac, randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function localWorkstationRequest(request) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket?.remoteAddress)) return false;
  try {
    const host = new URL('http://' + request.headers.host);
    const origin = new URL(request.headers.origin);
    return ['127.0.0.1', 'localhost'].includes(host.hostname) && origin.origin === host.origin;
  } catch { return false; }
}

export function installWorkstationSession(server) {
  const legacy = path.join(os.homedir(), 'kinship-of-cancer/tools/artwork/.state');
  const state = process.env.ARTWORK_FACTORY_STATE || (existsSync(legacy) ? legacy : fileURLToPath(new URL('../deployment/controller/tools/artwork/.state/', import.meta.url)));
  const tokenFile = process.env.ARTWORK_CONTROL_TOKEN_FILE || path.join(state, 'control/token');
  server.middlewares.use((request, response, next) => {
    if (new URL(request.url, 'http://localhost').pathname !== '/api/workstation-session') return next();
    if (request.method !== 'POST' || !localWorkstationRequest(request)) { response.writeHead(403).end(); return; }
    void (async () => {
      const info = await stat(tokenFile);
      if (!info.isFile() || info.size > 4096 || info.mode & 0o077) throw new Error('Private workstation key unavailable');
      const token = await readFile(tokenFile, 'utf8');
      if (!token) throw new Error('Empty workstation key');
      const value = Math.floor(Date.now() / 1000 + 12 * 3600) + '.' + randomBytes(18).toString('base64url');
      const signed = value + '.' + createHmac('sha256', token).update(value).digest('base64url');
      response.writeHead(200, {
        'Content-Type': 'application/json', 'Cache-Control': 'no-store',
        'Set-Cookie': 'artwork-dev-control=' + signed + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200',
      });
      response.end('{"ok":true}');
    })().catch(() => { response.writeHead(503, { 'Cache-Control': 'no-store' }).end('{"ok":false}'); });
  });
}
