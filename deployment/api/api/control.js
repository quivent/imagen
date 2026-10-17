const { Client } = require('ssh2');
const crypto = require('node:crypto');

const COOKIE = '__Host-artwork-control';
const ORIGIN = 'https://artwork.influx.vision';
const LIFE = 12 * 60 * 60;

function equal(a, b) {
  const left = crypto.createHash('sha256').update(String(a)).digest();
  const right = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(left, right);
}

function signature(value) {
  return crypto.createHmac('sha256', process.env.ARTWORK_CONTROL_TOKEN).update(value).digest('base64url');
}

function authenticated(req) {
  const cookies = String(req.headers.cookie || '').split(';').map(part => part.trim());
  const value = cookies.find(part => part.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || '';
  const [expires, nonce, signed] = value.split('.');
  return /^\d+$/.test(expires || '') && Number(expires) > Date.now() / 1000 &&
    Number(expires) < Date.now() / 1000 + LIFE + 60 && /^[A-Za-z0-9_-]{24}$/.test(nonce || '') &&
    equal(signature(expires + '.' + nonce), signed || '');
}

function bridge(payload) {
  return new Promise((resolve, reject) => {
    const connection = new Client();
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      connection.end();
      error ? reject(error) : resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('transport_timeout')), 24000);
    connection.on('error', () => finish(new Error('transport_unavailable')));
    connection.on('ready', () => {
      connection.exec('artwork-control-v1', (error, stream) => {
        if (error) return finish(new Error('transport_unavailable'));
        const chunks = [];
        let bytes = 0;
        stream.on('data', chunk => {
          chunks.push(chunk);
          bytes += chunk.length;
          if (bytes > 2500000) finish(new Error('response_too_large'));
        });
        stream.stderr.resume();
        stream.on('error', () => finish(new Error('transport_unavailable')));
        stream.on('close', code => {
          if (code !== 0) return finish(new Error('transport_unavailable'));
          try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { finish(new Error('invalid_response')); }
        });
        stream.end(JSON.stringify(payload));
      });
    });
    connection.connect({
      host: process.env.ARTWORK_SSH_HOST, port: Number(process.env.ARTWORK_SSH_PORT), username: 'root',
      privateKey: Buffer.from(process.env.ARTWORK_SSH_KEY_B64, 'base64'),
      readyTimeout: 10000, hostHash: 'sha256',
      hostVerifier: hash => equal(hash, process.env.ARTWORK_SSH_HOST_SHA256),
      algorithms: { serverHostKey: ['ssh-ed25519'] },
    });
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  const respond = (status, body) => res.status(status).json(body);
  if (!process.env.ARTWORK_CONTROL_TOKEN) return respond(503, { ok: false, problem: 'Controls are being connected.' });
  const action = String(req.query.action || '');
  if (!['state', 'session', 'jobs', 'pause'].includes(action)) return respond(404, { ok: false });
  if (req.method !== (action === 'state' ? 'GET' : 'POST')) return respond(405, { ok: false });
  if (req.method === 'POST' && req.headers.origin !== ORIGIN) return respond(403, { ok: false, problem: 'Open Controls from the artwork page.' });
  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return respond(400, { ok: false, problem: 'The request could not be read.' }); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body)) > 30000) return respond(400, { ok: false, problem: 'The request is too large or malformed.' });
  if (action === 'session') {
    if (typeof body.token !== 'string' || !equal(body.token, process.env.ARTWORK_CONTROL_TOKEN)) return respond(403, { ok: false, problem: 'This access key was not recognized.' });
    const value = Math.floor(Date.now() / 1000 + LIFE) + '.' + crypto.randomBytes(18).toString('base64url');
    res.setHeader('Set-Cookie', `${COOKIE}=${value}.${signature(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${LIFE}`);
    return respond(200, { ok: true });
  }
  if (!authenticated(req)) return respond(403, { ok: false, problem: 'Unlock Controls with your access key.' });
  if (action === 'jobs' && !body.requestId) body.requestId = crypto.randomUUID();
  try {
    const result = await bridge({ action, body });
    if (action === 'jobs') result.requestId = body.requestId;
    return respond(result.ok ? 200 : (result.status === 400 ? 400 : 503), result);
  } catch {
    return respond(503, { ok: false, requestId: body.requestId, problem: 'The worker is not responding. Keep this request ID when retrying.' });
  }
};
