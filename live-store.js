// One socket per document; every tab shares its current topic observations.
const topics = new Set(['gallery', 'comparisons', 'tasks', 'agents', 'monitor', 'controls', 'winners']);
const listeners = new Map();
const snapshots = new Map();
let socket = null;
let reconnectTimer = null;
let retry = 500;
let suspended = false;
let destroyed = false;
let scheduled = false;
const active = () => !destroyed && !suspended && !document.hidden && listeners.size > 0;
function problem(status = 503) { const issue = new Error('Live studio observation unavailable'); issue.status = status; return issue; }
function emit(topic, value) {
  snapshots.set(topic, value);
  for (const listener of [...(listeners.get(topic) || [])]) listener(value);
}
function unavailable() {
  for (const topic of listeners.keys()) emit(topic, { available: false, topic, status: 503 });
}
function sendSubscriptions() {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'subscribe', topics: [...listeners.keys()] }));
}
function connect() {
  if (!active() || socket) return;
  const url = new URL('/api/studio-events', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const connection = new WebSocket(url); socket = connection;
  connection.addEventListener('open', () => { if (socket === connection) { retry = 500; sendSubscriptions(); } });
  connection.addEventListener('message', event => {
    if (socket !== connection) return;
    let value;
    try { value = JSON.parse(event.data); } catch { return; }
    if (value.type === 'hello') { snapshots.clear(); return; }
    if (!topics.has(value.topic) || !listeners.has(value.topic)) return;
    if (value.type === 'snapshot') {
      const previous = snapshots.get(value.topic);
      if (previous?.available && value.version < previous.version) return;
      emit(value.topic, { ...value, available: true });
    } else if (value.type === 'unavailable') emit(value.topic, { ...value, available: false });
  });
  connection.addEventListener('error', () => connection.close());
  connection.addEventListener('close', () => {
    if (socket !== connection) return;
    socket = null; unavailable();
    if (active()) { reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, retry); retry = Math.min(10000, retry * 2); }
  });
}
function stop() {
  clearTimeout(reconnectTimer); reconnectTimer = null;
  const previous = socket; socket = null;
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
    if (listeners.get(topic)?.size === 0) { listeners.delete(topic); snapshots.delete(topic); }
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
