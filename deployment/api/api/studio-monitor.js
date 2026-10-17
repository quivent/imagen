'use strict';
const https = require('node:https');

// Cached DNS may still reach this old origin. Read the current Mac through its
// fixed TLS gateway, without trusting client-supplied hosts, paths or headers.
module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') { res.status(405).end('{"ok":false}'); return; }
  const upstream = https.request({
    hostname: '88.216.68.234', servername: 'artwork.influx.vision', port: 443,
    path: '/api/studio-monitor', method: 'GET',
    headers: { Host: 'artwork.influx.vision', Accept: 'application/json' },
    timeout: 8000,
  }, response => {
    const chunks = []; let size = 0;
    response.on('data', chunk => {
      size += chunk.length;
      if (size > 128 * 1024) { upstream.destroy(); return; }
      chunks.push(chunk);
    });
    response.on('end', () => {
      if (res.writableEnded) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (response.statusCode !== 200 || body.ok !== true) throw new Error('Unavailable source');
        res.status(200).end(JSON.stringify(body));
      } catch { res.status(503).end('{"ok":false}'); }
    });
    response.on('error', () => { if (!res.writableEnded) res.status(503).end('{"ok":false}'); });
  });
  upstream.on('timeout', () => upstream.destroy());
  upstream.on('error', () => { if (!res.writableEnded) res.status(503).end('{"ok":false}'); });
  upstream.end();
};
