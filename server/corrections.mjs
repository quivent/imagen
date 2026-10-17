import { execFile } from 'node:child_process';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/corrections.py', import.meta.url));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const rules = new Set(['generation', 'agents', 'tasks']);
let pending = null;

function authorized(request) {
  // Existing Controls validates its signed, expiring HttpOnly cookie server side.
  const cookie = String(request.headers.cookie || '').replace(/(?:^|;\s*)artwork-dev-control=/g,
    match => match.replace('artwork-dev-control=', '__Host-artwork-control='));
  if (!cookie || cookie.length > 8192) return Promise.resolve(false);
  return new Promise(resolve => {
    const probe = https.get('https://artwork-comparison.vercel.app/api/control/state', {
      headers: { Cookie: cookie }, timeout: 7000,
    }, response => {
      let body = ''; response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; if (body.length > 1000000) probe.destroy(); });
      response.on('end', () => {
        try { const data = JSON.parse(body); resolve(response.statusCode === 200 && data.ok === true); }
        catch { resolve(false); }
      });
      response.on('error', () => resolve(false));
    });
    probe.on('timeout', () => probe.destroy());
    probe.on('error', () => resolve(false));
  });
}
function invoke(args) {
  return new Promise((resolve, reject) => {
    execFile('python3', ['-B', script, ...args], { timeout: 45000, maxBuffer: 16384 }, (error, output) => {
      if (error) { reject(error); return; }
      try { resolve(JSON.parse(output)); } catch (problem) { reject(problem); }
    });
  });
}
export function installCorrections(server) {
  server.middlewares.use(async (request, response, next) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname !== '/api/studio-corrections') { next(); return; }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (code, value) => { response.writeHead(code).end(JSON.stringify(value)); };
    if (!['GET', 'POST'].includes(request.method)) { send(405, { ok: false }); return; }
    if (request.method === 'POST') {
      const allowed = new Set(['https://artwork.influx.vision',
        `http://127.0.0.1:${server.config.server.port}`, `http://localhost:${server.config.server.port}`,
        `http://127.0.0.1:${server.config.preview.port}`, `http://localhost:${server.config.preview.port}`]);
      if (!allowed.has(request.headers.origin)) { send(403, { ok: false, detail: 'Open the correction from the studio.' }); return; }
    }
    if (!await authorized(request)) { send(403, { ok: false, detail: 'Open Controls with your access key before requesting a correction.' }); return; }
    try {
      if (request.method === 'GET') {
        const id = url.searchParams.get('requestId');
        if (!uuid.test(id || '')) { send(400, { ok: false }); return; }
        send(200, await invoke(['status', '--request-id', id])); return;
      }
      if (!String(request.headers['content-type'] || '').startsWith('application/json')) { send(415, { ok: false }); return; }
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (Buffer.byteLength(body) > 1024) { send(413, { ok: false }); return; }
      }
      const data = JSON.parse(body);
      if (!data || Object.keys(data).sort().join(',') !== 'requestId,rule' || !rules.has(data.rule) || !uuid.test(data.requestId || '')) { send(400, { ok: false }); return; }
      // One outstanding correction execution; repeated clicks reuse their identity.
      if (pending && (pending.id !== data.requestId || pending.rule !== data.rule)) { send(409, { ok: false, detail: 'A correction request is being recorded. Please wait for its result.' }); return; }
      if (!pending) {
        const work = { id: data.requestId, rule: data.rule };
        work.promise = invoke(['request', '--rule', data.rule, '--request-id', data.requestId])
          .finally(() => { if (pending === work) pending = null; });
        pending = work;
      }
      send(202, await pending.promise);
    } catch { send(503, { ok: false, detail: 'The correction could not be confirmed. Retry with the same request identity.' }); }
  });
}

export { authorized as authorizedStudioRequest };
