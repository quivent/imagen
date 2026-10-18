// One socket per document; every tab shares its current topic observations.
import { sitePerformance } from './site-performance.js';
import { applyGalleryPatch, recentGallery } from './gallery-patch.js';
import { applyComparisonsPatch } from './comparisons-patch.js';
const patchReaders = { gallery: applyGalleryPatch, comparisons: applyComparisonsPatch };
const topics = new Set(['gallery', 'gallery-recent', 'comparisons', 'tasks', 'agents', 'monitor', 'controls', 'winners']);
const listeners = new Map();
const snapshots = new Map();
let socket = null;
let reconnectTimer = null;
let retry = 500;
let suspended = false;
let destroyed = false;
let scheduled = false;
let subscriptionJSON = null;
const resyncPending = new Set();
const active = () => !destroyed && !suspended && !document.hidden && listeners.size > 0;
function problem(status = 503) { const issue = new Error('Live studio observation unavailable'); issue.status = status; return issue; }
function emit(topic, value) {
  snapshots.set(topic, value);
  for (const listener of [...(listeners.get(topic) || [])]) listener(value);
  if (topic === 'gallery') emit('gallery-recent', value.available ? { ...value, topic: 'gallery-recent', data: recentGallery(value.data) } : { ...value, topic: 'gallery-recent' });
}
function unavailable() {
  for (const topic of topics) if (snapshots.has(topic) || listeners.has(topic)) emit(topic, { available: false, topic, status: 503 });
}
function sendSubscriptions() {
  if (socket?.readyState !== WebSocket.OPEN) return;
  const requested=new Set([...listeners.keys()].map(topic=>topic==='gallery-recent'?'gallery':topic));
  const value = JSON.stringify({ type: 'subscribe', features: ['gallery-patch-v1', 'gallery-preview-v1', 'comparisons-patch-v1', ...(!listeners.has('gallery') ? ['gallery-recent-only-v1'] : [])], topics: [...requested] });
  if (value !== subscriptionJSON) { subscriptionJSON = value; socket.send(value); }
}
function connect() {
  if (!active() || socket) return;
  const url = new URL('/api/studio-events', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  sitePerformance.socketStart();
  const connection = new WebSocket(url); socket = connection;
  connection.addEventListener('open', () => { if (socket === connection) { sitePerformance.socketOpen(); retry = 500; subscriptionJSON = null; sendSubscriptions(); } });
  connection.addEventListener('message', event => {
    if (socket !== connection) return;
    const started = performance.now();
    let value;
    try { value = JSON.parse(event.data); } catch { return; }
    if (value.type === 'hello') { snapshots.clear(); resyncPending.clear(); return; }
    if (!topics.has(value.topic)) return;
    if(value.topic==='gallery'&&!listeners.has('gallery')){
      if(value.type==='snapshot'&&listeners.has('gallery-recent'))emit('gallery-recent',{...value,topic:'gallery-recent',data:recentGallery(value.data),available:true});
      return;
    }
    if(!listeners.has(value.topic))return;
    if (value.type === 'snapshot') {
      const previous = snapshots.get(value.topic);
      if (previous?.available && value.version <= previous.version) return;
      resyncPending.delete(value.topic);
      emit(value.topic, { ...value, available: true });
    } else if (value.type === 'patch' && patchReaders[value.topic]) {
      const previous = snapshots.get(value.topic);
      if (previous?.available && value.version <= previous.version) return;
      try {
        const merged = patchReaders[value.topic](previous, value);
        resyncPending.delete(value.topic); emit(value.topic, merged);
        value = merged;
      } catch {
        emit(value.topic, { available: false, topic: value.topic, status: 503 });
        if (!resyncPending.has(value.topic)) { resyncPending.add(value.topic); connection.send(JSON.stringify({ type: 'resync', topic: value.topic })); }
        return;
      }
    } else if (value.type === 'unavailable') emit(value.topic, { ...value, available: false });
    sitePerformance.socketTopic(value.topic, value, started);
  });
  connection.addEventListener('error', () => connection.close());
  connection.addEventListener('close', () => {
    if (socket !== connection) return;
    sitePerformance.socketClose();
    socket = null; unavailable();
    if (active()) { reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, retry); retry = Math.min(10000, retry * 2); }
  });
}
function stop() {
  clearTimeout(reconnectTimer); reconnectTimer = null;
  const previous = socket; socket = null;
  if (previous) sitePerformance.socketClose(false);
  previous?.close(); snapshots.clear(); unavailable();
}
function sync() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    if (!active()) { stop(); return; }
    connect(); sendSubscriptions();
  });
}
function subscribe(topic, listener) {
  if (!topics.has(topic)) throw new Error('Unsupported studio topic');
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic).add(listener);
  const cached = snapshots.get(topic);
  if (cached) queueMicrotask(() => { if (listeners.get(topic)?.has(listener)) listener(cached); });
  sync();
  return () => {
    listeners.get(topic)?.delete(listener);
    if (listeners.get(topic)?.size === 0) {
      listeners.delete(topic);
      // Public snapshots remain available without retaining unwanted wire topics.
      // Full archives and private state are released when their final reader leaves.
      if (topic === 'controls' || topic === 'gallery') snapshots.delete(topic);
    }
    sync();
  };
}
function read(topic) {
  const cached = snapshots.get(topic);
  if (cached) return cached.available ? Promise.resolve(cached.data) : Promise.reject(problem(cached.status));
  return new Promise((resolve, reject) => {
    let release;
    const timeout = setTimeout(() => { release?.(); reject(problem()); }, 12000);
    release = subscribe(topic, observation => {
      clearTimeout(timeout); release?.();
      observation.available ? resolve(observation.data) : reject(problem(observation.status));
    });
  });
}
function reconnect() { stop(); sync(); }
const visibility = () => sync();
const pagehide = () => { suspended = true; stop(); };
const pageshow = () => { suspended = false; sync(); };
document.addEventListener('visibilitychange', visibility);
window.addEventListener('pagehide', pagehide);
window.addEventListener('pageshow', pageshow);
export const studioLive = { subscribe, read, reconnect };
if (import.meta.hot) import.meta.hot.dispose(() => {
  destroyed = true; stop(); listeners.clear();
  document.removeEventListener('visibilitychange', visibility);
  window.removeEventListener('pagehide', pagehide);
  window.removeEventListener('pageshow', pageshow);
});
