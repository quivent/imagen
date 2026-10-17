import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const cache = fileURLToPath(new URL('../.runtime/seers/images/', import.meta.url));
const imagePattern = /^[a-f0-9]{64}\.(png|jpg|webp)$/;
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

function remote(args = []) {
  const host = process.env.ARTWORK_SSH_HOST || 'root@184.186.104.194';
  const port = process.env.ARTWORK_SSH_PORT || '11012';
  if (!/^(?:root@)?[A-Za-z0-9.-]+$/.test(host) || !/^\d{1,5}$/.test(port)) throw new Error('Invalid worker endpoint');
  const command = ['python3', '/workspace/artwork/judges/seers_snapshot.py', ...args].map(quote).join(' ');
  return spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5',
    '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2', '-p', port,
    host.includes('@') ? host : 'root@' + host, command], { stdio: ['ignore', 'pipe', 'ignore'] });
}

export function installSeers(server) {
  const clients = new Set();
  const imageRequests = new Map();
  let child = null, snapshot = null, restart = null, idle = null, closed = false, lastAt = 0;
  const fresh = () => snapshot && Date.now() - lastAt < 8000;
  const unavailable = () => ({ ok: false, observedAt: Date.now() / 1000, models: snapshot?.models || [] });
  function send(res, value) {
    if (!res.destroyed && res.writableLength < 256 * 1024) res.write('data: ' + JSON.stringify(value) + '\n\n');
  }
  function broadcast(value) { for (const res of clients) send(res, value); }
  function start() {
    clearTimeout(idle);
    if (child || restart || closed) return;
    const process = remote(['--watch']); child = process;
    process.stdout.setEncoding('utf8');
    let buffer = '';
    process.stdout.on('data', data => {
      buffer += data.toString();
      if (buffer.length > 512 * 1024) { process.kill(); return; }
      let line;
      while ((line = buffer.indexOf('\n')) >= 0) {
        const raw = buffer.slice(0, line); buffer = buffer.slice(line + 1);
        try {
          const value = JSON.parse(raw);
          if (value.ok !== true || !Array.isArray(value.models) || !Number.isFinite(value.observedAt)) continue;
          snapshot = value; lastAt = Date.now(); broadcast(value);
        } catch { /* Ignore non-record output; stale observations expire. */ }
      }
    });
    process.on('error', () => {});
    process.once('close', () => {
      if (child !== process) return;
      child = null; lastAt = 0; broadcast(unavailable());
      if (clients.size && !closed) restart = setTimeout(() => { restart = null; start(); }, 2000);
    });
  }
  function release() {
    if (clients.size) return;
    clearTimeout(idle);
    idle = setTimeout(() => { clearTimeout(restart); restart = null; child?.kill(); }, 10000);
  }
  const heartbeat = setInterval(() => { if (clients.size && !fresh()) broadcast(unavailable()); }, 3000);
  heartbeat.unref?.();

  async function image(name) {
    if (!imagePattern.test(name)) throw new Error('Invalid image identity');
    try { return await readFile(cache + name); } catch { /* Fetch captured content by its hash. */ }
    if (imageRequests.has(name)) return imageRequests.get(name);
    const pending = new Promise((resolve, reject) => {
      const process = remote(['--image', name]);
      const chunks = []; let size = 0;
      const timeout = setTimeout(() => { process.kill(); reject(new Error('Image unavailable')); }, 15000);
      process.stdout.on('data', data => {
        size += data.length;
        if (size > 24 * 1024 * 1024) { process.kill(); return; }
        chunks.push(data);
      });
      process.on('error', reject);
      process.on('close', async code => {
        clearTimeout(timeout);
        if (code || size > 24 * 1024 * 1024) { reject(new Error('Image unavailable')); return; }
        const data = Buffer.concat(chunks);
        if (createHash('sha256').update(data).digest('hex') !== name.split('.')[0]) { reject(new Error('Image integrity mismatch')); return; }
        try {
          await mkdir(cache, { recursive: true });
          const temp = cache + name + '.tmp'; await writeFile(temp, data); await rename(temp, cache + name);
        } catch { /* Verified content can still be served without a cache. */ }
        resolve(data);
      });
    }).finally(() => imageRequests.delete(name));
    imageRequests.set(name, pending);
    return pending;
  }

  server.middlewares.use(async (req, res, next) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (!path.startsWith('/api/seers/')) { next(); return; }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    if (path.startsWith('/api/seers/image/')) {
      const name = path.slice('/api/seers/image/'.length);
      try {
        const data = await image(name);
        res.setHeader('Content-Type', name.endsWith('.png') ? 'image/png' : name.endsWith('.jpg') ? 'image/jpeg' : 'image/webp');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('ETag', '"' + name.split('.')[0] + '"');
        res.end(data);
      } catch { res.writeHead(404).end(); }
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    if (path === '/api/seers/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no', 'Connection': 'keep-alive' });
      res.flushHeaders(); clients.add(res); start();
      if (fresh()) send(res, snapshot);
      else res.write(': connected\n\n');
      res.once('close', () => { clients.delete(res); release(); });
    } else if (path === '/api/seers/state') {
      start(); release();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(fresh() ? snapshot : unavailable()));
    } else res.writeHead(404).end();
  });
  server.httpServer?.once('close', () => {
    closed = true; clearInterval(heartbeat); clearTimeout(restart); clearTimeout(idle);
    child?.kill(); for (const res of clients) res.end(); clients.clear();
  });
}
