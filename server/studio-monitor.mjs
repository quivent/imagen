import { execFile } from 'node:child_process';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';

const collector = fileURLToPath(new URL('../scripts/studio_monitor.py', import.meta.url));
const runtime = fileURLToPath(new URL('../.runtime/monitor/', import.meta.url));
const events = new EventEmitter();
let observation = null;
let pending = null;
let timer = null;
let child = null;
let stopped = false;
const intervalMs = 2000;
const startedAt = new Date().toISOString();
async function sample() {
  if (pending || stopped) return pending;
  pending = new Promise(resolve => {
    child = execFile('python3', ['-B', collector], { timeout: 10000, maxBuffer: 256 * 1024 }, async (error, stdout) => {
      child = null;
      let next;
      try {
        if (error) throw error;
        next = JSON.parse(stdout);
        if (next.ok !== true || !Number.isFinite(Date.parse(next.observedAt))) throw new Error('Invalid observation');
      } catch {
        next = { ok: false, observedAt: new Date().toISOString(), generation: null, agents: null, tasks: null };
      }
      if (!stopped) {
        next.watcher = { pid: process.pid, startedAt, intervalMs, mode: 'persistent', transport: 'websocket' };
        observation = next;
        try {
          await mkdir(runtime, { recursive: true, mode: 0o700 });
          await writeFile(runtime + 'status.tmp', JSON.stringify(next), { mode: 0o600 });
          await rename(runtime + 'status.tmp', runtime + 'status.json');
        } catch { /* Live observation remains available if local storage fails. */ }
        events.emit('sample');
      }
      resolve(observation);
    });
  }).finally(() => { pending = null; if (!stopped) timer = setTimeout(sample, intervalMs); });
  return pending;
}
function start() { if (!timer && !pending && !stopped) sample(); }
export function subscribeMonitor(listener) { events.on('sample', listener); start(); return () => events.off('sample', listener); }
export async function collectStudioMonitor() {
  start();
  if (!observation && pending) await pending;
  if (!observation || Date.now() - Date.parse(observation.observedAt) > 12000) throw new Error('Observation unavailable');
  return observation;
}
export function installStudioMonitor(server) {
  start();
  server.middlewares.use(async (request, response, next) => {
    if (new URL(request.url, 'http://localhost').pathname !== '/api/studio-monitor') { next(); return; }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method !== 'GET') { response.writeHead(405).end('{"ok":false}'); return; }
    try { response.end(JSON.stringify(await collectStudioMonitor())); }
    catch { response.writeHead(503).end('{"ok":false}'); }
  });
  server.httpServer?.once('close', () => { stopped = true; clearTimeout(timer); child?.kill(); events.removeAllListeners(); });
}
