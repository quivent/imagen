import { WebSocketServer, WebSocket } from 'ws';
import { readFile, watch } from 'node:fs';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectLocalGallery, subscribeLocalGallery } from './local-gallery.mjs';
import { collectStudioMonitor, subscribeMonitor } from './studio-monitor.mjs';
import { createGalleryPatch, recentGallery } from '../src/gallery-patch.js';
import { createComparisonsPatch } from '../src/comparisons-patch.js';
import { pollArchiveGallery } from './archive-gallery.mjs';
import { collectArchiveGallery } from './r2-gallery.mjs';
import { withImageNames } from './image-names.mjs';

const read = promisify(readFile);
const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const api = process.env.ARTWORK_API_ORIGIN || 'https://artwork-comparison.vercel.app';
const publicOrigin = 'https://artwork.influx.vision';
const files = { tasks: 'tasks.json', winners: 'winners.json', comparisons: 'data/comparisons.json', agents: 'agent-status.json' };
const topics = new Set([...Object.keys(files), 'gallery', 'monitor', 'controls']);
const deliveryPriority = ['monitor', 'agents', 'winners', 'controls', 'tasks', 'comparisons', 'gallery-recent', 'gallery'];
const patchWriters = { gallery: createGalleryPatch, comparisons: createComparisonsPatch };
function allowedOrigin(origin, server) {
  if (origin === publicOrigin) return true;
  try {
    const url = new URL(origin);
    const ports = [server.config.server.port, server.config.preview.port].map(String);
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && ports.includes(url.port);
  }
  catch { return false; }
}
function controlCookie(header = '') {
  const match = header.match(/(?:^|;\s*)(?:__Host-artwork-control|artwork-dev-control)=([A-Za-z0-9_.-]{1,1000})(?:;|$)/);
  return match ? '__Host-artwork-control=' + match[1] : null;
}
async function getJSON(path, cookie) {
  const response = await fetch(api + path, {
    headers: cookie ? { Cookie: cookie } : {}, signal: AbortSignal.timeout(6000), redirect: 'error',
  });
  if (!response.ok) { const error = new Error('Source unavailable'); error.status = response.status; throw error; }
  const text = await response.text();
  if (Buffer.byteLength(text) > (path === '/api/gallery' ? 16 : 2) * 1024 * 1024) throw new Error('Source too large');
  return JSON.parse(text);
}

async function curated(topic, data) {
  if (!['gallery', 'comparisons', 'winners'].includes(topic)) return data;
  // A failed overlay read fails the topic closed rather than silently restoring excluded work.
  const overlay = JSON.parse(await read(root + 'exclusions.json', 'utf8'));
  if (overlay.schemaVersion !== 1 || !Array.isArray(overlay.exclusions)) throw new Error('Unknown exclusion format');
  const active = overlay.exclusions.filter(row => row.enabled === true);
  if (active.some(row => typeof row.comparisonId !== 'string' || !Array.isArray(row.jobIds) || row.jobIds.length !== 2 || row.jobIds.some(id => typeof id !== 'string'))) throw new Error('Unknown exclusion entry');
  const ids = new Set(active.flatMap(row => row.jobIds));
  const key = topic === 'gallery' ? 'jobs' : topic;
  if (!Array.isArray(data[key])) throw new Error('Unknown collection format');
  const rows = data[key].filter(row => {
    if (topic === 'gallery') return !ids.has(row.id);
    if (topic === 'winners') return !ids.has(row.selection?.jobId);
    return !active.some(item => item.comparisonId === row.id &&
      item.jobIds.includes(row.left?.jobId) && item.jobIds.includes(row.right?.jobId));
  });
  return { ...data, [key]: rows, exclusions: {
    source: 'exclusions.json', count: data[key].length - rows.length,
    reason: 'Initial oversized setup pair omitted; originals retained.',
  } };
}

export function installStudioEvents(server) {
  const wss = new WebSocketServer({
    noServer: true, maxPayload: 4096,
    // The archive is repetitive JSON (~2 MB). Independent, low-cost messages
    // cut public transfer size without retaining compression history per tab.
    perMessageDeflate: {
      serverNoContextTakeover: true, clientNoContextTakeover: true,
      threshold: 1024, concurrencyLimit: 2,
      zlibDeflateOptions: { level: 1, memLevel: 4 },
    },
  });
  const states = new Map();
  const groups = new Map();
  const clients = new Set();
  const watchers = [];
  let closed = false;
  let comparisonSync;
  let comparisonDirty = false;
  function syncComparisons() {
    if (closed) return;
    if (comparisonSync) { comparisonDirty = true; return; }
    comparisonSync = execute(process.env.ARTWORK_PYTHON || 'python3', ['-I', '-B', root + 'scripts/sync_comparisons.py'], {
      timeout: 30000, maxBuffer: 65536, env: process.env,
    }).then(() => { if (!closed && interested('comparisons')) refresh('comparisons'); })
      .catch(() => { /* Keep the last verified comparison collection on source failure. */ })
      .finally(() => {
        comparisonSync = null;
        if (comparisonDirty) { comparisonDirty = false; syncComparisons(); }
      });
  }
  let remoteGallery = { jobs: [] };
  const mergeGallery = local => {
    const rows = new Map(remoteGallery.jobs.map(row => [row.id, row]));
    for (const row of local.jobs) if (!rows.has(row.id)) rows.set(row.id, row);
    return { ...remoteGallery, updatedAt: local.updatedAt || remoteGallery.updatedAt, jobs: [...rows.values()] };
  };
  const interested = topic => [...clients].some(socket => socket.topics.has(topic));
  const archive = pollArchiveGallery({
    load: collectArchiveGallery,
    onChange(data) {
      if (closed) return;
      remoteGallery = data;
      if (interested('gallery')) return refresh('gallery');
    },
  });
  // Drain one message at a time. A valid initial gallery plus the other topics
  // can exceed the socket buffer budget even for a fast client. Keep only the
  // latest unsent observation per topic instead of disconnecting that client
  // halfway through its initial subscription burst.
  const drain = socket => {
    if (socket.readyState !== WebSocket.OPEN || socket.sending || !socket.outbox.size) return;
    const key = socket.outbox.has('hello') ? 'hello' : deliveryPriority.find(topic => socket.outbox.has(topic));
    const message = socket.outbox.get(key);
    socket.outbox.delete(key);
    const epoch = socket.patchEpochs.get(message.topic) || 0;
    const patching = socket.patchTopics.has(message.topic);
    const baseline = socket.patchBaselines.get(message.topic);
    const wire = patching && message.type === 'snapshot' && baseline ? patchWriters[message.topic](baseline, message) : message;
    const body = JSON.stringify(wire);
    if (Buffer.byteLength(body) > 8 * 1024 * 1024) { socket.close(1013); return; }
    socket.sending = true;
    const stalled = setTimeout(() => socket.terminate(), 10000);
    socket.send(body, error => {
      clearTimeout(stalled);
      socket.sending = false;
      if (error) { socket.terminate(); return; }
      // Update only after this baseline has reached the transport. Coalesced
      // pending versions then diff against what this client actually received.
      if (patching && epoch === (socket.patchEpochs.get(message.topic) || 0)) {
        if (message.type === 'snapshot') socket.patchBaselines.set(message.topic, message);
        else socket.patchBaselines.delete(message.topic);
      }
      drain(socket);
    });
  };
  const send = (socket, message) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    // Keys are limited to supported topics, the recent preview and greeting.
    socket.outbox.set(message.topic || 'hello', message);
    drain(socket);
  };
  function deliver(topic, state, recipients = clients) {
    for (const socket of recipients) if (socket.topics.has(topic)) {
      if (state.error) send(socket, { type: 'unavailable', topic, observedAt: state.observedAt, status: state.status || 503 });
      else if (state.data) {
        if (topic === 'gallery' && socket.galleryPreview && (socket.galleryRecentOnly || !socket.patchBaselines.has('gallery'))) {
          send(socket, { type: 'snapshot', topic: 'gallery-recent', version: state.version, observedAt: state.observedAt, data: recentGallery(state.data) });
        }
        if (topic === 'gallery' && socket.galleryRecentOnly) continue;
        send(socket, { type: 'snapshot', topic, version: state.version, observedAt: state.observedAt, data: state.data });
      }
    }
  }
  function publish(topic, data, target, recipients) {
    const signature = JSON.stringify(data);
    if (signature === target.signature && !target.error) return;
    Object.assign(target, { data, signature, error: false, version: (target.version || 0) + 1, observedAt: new Date().toISOString() });
    deliver(topic, target, recipients);
  }
  async function refresh(topic) {
    let state = states.get(topic);
    if (!state) { state = {}; states.set(topic, state); }
    if (state.pending) { state.dirty = true; return; }
    if (closed || !interested(topic)) return;
    state.pending = true;
    try {
      const data = files[topic] ? JSON.parse(await read(root + files[topic], 'utf8'))
        : topic === 'gallery' ? await withImageNames(mergeGallery(await collectLocalGallery())) : await collectStudioMonitor();
      publish(topic, await curated(topic, data), state);
    } catch {
      Object.assign(state, { error: true, observedAt: new Date().toISOString() });
      deliver(topic, state);
    } finally {
      state.pending = false;
      if (state.dirty) { state.dirty = false; refresh(topic); }
    }
  }
  function detachPrivate(socket) {
    if (!socket.group) return;
    socket.group.clients.delete(socket);
    if (!socket.group.clients.size) groups.delete(socket.group.key);
    socket.group = null;
  }
  async function refreshControl(group) {
    if (group.pending || group.rejected || closed || !group.clients.size) return;
    group.pending = true;
    try {
      const data = await getJSON('/api/control/state', group.cookie);
      if (data.ok !== true) throw new Error('Unconfirmed authorization');
      publish('controls', data, group, group.clients);
    } catch (error) {
      group.rejected = [401, 403].includes(error.status);
      Object.assign(group, { data: null, signature: null, error: true, status: [401, 403].includes(error.status) ? 403 : 503, observedAt: new Date().toISOString() });
      deliver('controls', group, group.clients);
    } finally { group.pending = false; }
  }
  function subscribe(socket, requested) {
    // Current status must not wait behind the multi-megabyte image archive on
    // a public connection. Deliver small cached observations before gallery.
    socket.topics = new Set(requested.filter(topic => topics.has(topic)).sort((a, b) => deliveryPriority.indexOf(a) - deliveryPriority.indexOf(b)));
    if (!socket.topics.has('controls')) detachPrivate(socket);
    for(const topic of socket.patchBaselines.keys())if(!socket.topics.has(topic)||(topic==='gallery'&&socket.galleryRecentOnly))socket.patchBaselines.delete(topic);
    for(const topic of socket.outbox.keys())if(topic!=='hello'&&!socket.topics.has(topic)&&!(topic==='gallery-recent'&&socket.topics.has('gallery')))socket.outbox.delete(topic);
    for (const topic of socket.topics) {
      if (topic === 'controls') {
        if (socket.group) { deliver(topic, socket.group, [socket]); refreshControl(socket.group); continue; }
        if (!socket.cookie) { send(socket, { type: 'unavailable', topic, status: 403, observedAt: new Date().toISOString() }); continue; }
        const key = createHash('sha256').update(socket.cookie).digest('hex');
        let group = groups.get(key);
        if (!group) {
          if (groups.size >= 8) { send(socket, { type: 'unavailable', topic, status: 503, observedAt: new Date().toISOString() }); continue; }
          group = { key, cookie: socket.cookie, clients: new Set() }; groups.set(key, group);
        }
        socket.group = group; group.clients.add(socket);
        deliver(topic, group, [socket]); refreshControl(group);
      } else {
        const state = states.get(topic);
        if (state) deliver(topic, state, [socket]);
        refresh(topic);
      }
    }
  }
  function upgrade(request, socket, head) {
    let pathname;
    try { pathname = new URL(request.url, 'http://localhost').pathname; } catch { return; }
    if (pathname !== '/api/studio-events') return;
    if (!allowedOrigin(request.headers.origin, server) || clients.size >= 32) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    wss.handleUpgrade(request, socket, head, connection => {
      connection.outbox = new Map(); connection.sending = false;
      connection.patchBaselines = new Map(); connection.patchEpochs = new Map(); connection.patchTopics = new Set(); connection.galleryPreview = false;
      connection.topics = new Set(); connection.cookie = controlCookie(request.headers.cookie); connection.alive = true;
      clients.add(connection);
      send(connection, { type: 'hello', protocol: 1, observedAt: new Date().toISOString(), topics: [...topics] });
      connection.on('pong', () => { connection.alive = true; });
      connection.on('message', bytes => {
        try {
          const message = JSON.parse(bytes.toString());
          if (message.type === 'resync' && Object.hasOwn(patchWriters, message.topic) && connection.topics.has(message.topic)) {
            connection.patchBaselines.delete(message.topic);
            connection.patchEpochs.set(message.topic, (connection.patchEpochs.get(message.topic) || 0) + 1);
            const state = states.get(message.topic); if (state) deliver(message.topic, state, [connection]);
            return;
          }
          if (message.type !== 'subscribe' || !Array.isArray(message.topics) || message.topics.length > topics.size || message.topics.some(topic => typeof topic !== 'string')) throw new Error('Unsupported message');
          const features = Array.isArray(message.features) ? message.features : [];
          for (const topic of Object.keys(patchWriters)) {
            if (features.includes(topic === 'gallery' ? 'gallery-patch-v1' : 'comparisons-patch-v1')) connection.patchTopics.add(topic);
            else {
              connection.patchTopics.delete(topic); connection.patchBaselines.delete(topic);
              connection.patchEpochs.set(topic, (connection.patchEpochs.get(topic) || 0) + 1);
            }
          }
          connection.galleryRecentOnly = features.includes('gallery-recent-only-v1');
          if (connection.galleryRecentOnly) connection.outbox.delete('gallery');
          connection.galleryPreview = connection.patchTopics.has('gallery') && features.includes('gallery-preview-v1');
          subscribe(connection, message.topics);
        } catch { connection.close(1008); }
      });
      connection.on('close', () => { connection.outbox.clear(); connection.patchBaselines.clear(); detachPrivate(connection); clients.delete(connection); });
      connection.on('error', () => {});
    });
  }
  server.httpServer.on('upgrade', upgrade);
  const releaseMonitor = subscribeMonitor(async () => {
    if (interested('monitor')) refresh('monitor');
    try {
      const observation = await collectStudioMonitor();
      if (observation.generation?.ok) for (const group of groups.values()) {
        if (group.data && !group.rejected) publish('controls', { ...group.data, workers: observation.generation.workers, gpus: observation.generation.gpus || [] }, group, group.clients);
      }
    } catch { /* The monitor topic carries unavailable source evidence. */ }
  });
  const releaseGallery = subscribeLocalGallery(() => {
    if (interested('gallery')) refresh('gallery');
    syncComparisons();
    for (const group of groups.values()) refreshControl(group);
  });
  syncComparisons();
  const heartbeat = setInterval(() => {
    for (const socket of clients) {
      if (!socket.alive) { socket.terminate(); continue; }
      socket.alive = false; socket.ping();
    }
  }, 20000);
  const changed = file => {
    if (file === 'exclusions.json') for (const topic of ['gallery', 'comparisons', 'winners']) refresh(topic);
    for (const [topic, name] of Object.entries(files)) if (name === file) refresh(topic);
  };
  try { watchers.push(watch(root, (_event, name) => { if (name) changed(String(name)); })); } catch {}
  try { watchers.push(watch(root + 'data', (_event, name) => { if (name) changed('data/' + String(name)); })); } catch {}
  for (const watcher of watchers) watcher.on('error', () => {});
  server.httpServer.once('close', () => {
    closed = true; archive.stop(); releaseMonitor(); releaseGallery(); clearInterval(heartbeat);
    server.httpServer.off('upgrade', upgrade);
    for (const watcher of watchers) watcher.close();
    for (const socket of clients) socket.terminate();
    wss.close();
  });
}
