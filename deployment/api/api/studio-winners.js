'use strict';
const https = require('node:https');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ORIGIN = 'https://artwork.influx.vision';

// Compatibility origin only: fixed gateway, certificate/SNI, and endpoint.
module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const send = (code, data) => { if (!res.writableEnded) res.status(code).end(JSON.stringify(data)); };
  if (!['GET', 'POST'].includes(req.method)) return send(405, { ok: false });
  if (req.method === 'POST' && req.headers.origin !== ORIGIN) return send(403, { ok: false });
  let path = '/api/studio-winners';
  let body = null;
  if (req.method === 'POST') {
    try {
      const data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!data || Object.keys(data).sort().join(',') !== 'comparisonId,expectedRevision,requestId,side'
          || !UUID.test(data.requestId || '') || !['left', 'right', null].includes(data.side)
          || typeof data.comparisonId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.comparisonId)
          || !Number.isSafeInteger(data.expectedRevision) || data.expectedRevision < 0) return send(400, { ok: false });
      body = JSON.stringify(data);
      if (Buffer.byteLength(body) > 2048) return send(413, { ok: false });
    } catch { return send(400, { ok: false }); }
  }
  const cookie = String(req.headers.cookie || '');
  if (req.method === 'POST' && (!cookie || cookie.length > 8192)) return send(403, { ok: false, detail: 'Open Controls with your access key to keep choices.' });
  const headers = { Host: 'artwork.influx.vision', Accept: 'application/json', ...(cookie ? { Cookie: cookie } : {}) };
  if (body) Object.assign(headers, { Origin: ORIGIN, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  const upstream = https.request({ hostname: '88.216.68.234', servername: 'artwork.influx.vision', port: 443,
    path, method: req.method, headers, timeout: 20000 }, response => {
    const chunks = []; let size = 0;
    response.on('data', chunk => { size += chunk.length; if (size > 2 * 1024 * 1024) upstream.destroy(); else chunks.push(chunk); });
    response.on('end', () => {
      try { send([200, 202, 400, 403, 404, 409, 413, 415, 503].includes(response.statusCode) ? response.statusCode : 503, JSON.parse(Buffer.concat(chunks))); }
      catch { send(503, { ok: false }); }
    });
    response.on('error', () => send(503, { ok: false }));
  });
  upstream.on('timeout', () => upstream.destroy());
  upstream.on('error', () => send(503, { ok: false }));
  upstream.end(body);
};
