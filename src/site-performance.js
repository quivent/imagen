// Session-only observations. No requests, polling, URL queries, or artwork work.
export function createSitePerformance({ perf = globalThis.performance, Observer = globalThis.PerformanceObserver, frame = globalThis.requestAnimationFrame?.bind(globalThis), win = globalThis.window, doc = globalThis.document, now = Date.now } = {}) {
  const state = { resources: [], tabs: new Map(), topics: new Map(), errors: [], longTasks: [], observers: [], paints: {}, socket: { state: 'Not connected', attempts: 0, reconnects: 0, disconnects: 0, connectMs: null, openedAt: null }, supported: {} };
  let resourceCount = 0;
  let visibilityVersion = 0;
  const visibility = () => { visibilityVersion++; };
  doc?.addEventListener('visibilitychange', visibility);
  const clock = () => perf?.now?.() ?? 0;
  const path = name => { try { return new URL(name, win?.location?.href || 'http://localhost').pathname; } catch { return 'Unknown resource'; } };
  const keep = (list, item, limit = 100) => { list.push(item); if (list.length > limit) list.splice(0, list.length - limit); };
  function observe(type, callback) {
    state.supported[type] = Boolean(Observer?.supportedEntryTypes?.includes(type));
    if (!state.supported[type]) return;
    try { const observer = new Observer(list => list.getEntries().forEach(callback)); observer.observe({ type, buffered: true }); state.observers.push(observer); }
    catch { state.supported[type] = false; }
  }
  observe('resource', entry => {
    resourceCount++;
    keep(state.resources, { path: path(entry.name), type: entry.initiatorType || 'other', duration: entry.duration, bytes: entry.transferSize, status: entry.responseStatus || null }, 500);
  });
  observe('paint', entry => { state.paints[entry.name] = entry.startTime; });
  observe('largest-contentful-paint', entry => { state.paints.lcp = entry.startTime; });
  observe('longtask', entry => { keep(state.longTasks, { start: entry.startTime, duration: entry.duration }); });
  const error = event => keep(state.errors, { type: event.type === 'unhandledrejection' ? 'Unhandled promise rejection' : event.target?.src || event.target?.href ? 'Resource load error' : 'JavaScript error', path: path(event.filename || event.target?.src || event.target?.href || win?.location?.href), at: clock() }, 50);
  win?.addEventListener('error', error, true);
  win?.addEventListener('unhandledrejection', error);
  const afterFrame = callback => {
    const version = visibilityVersion;
    if (frame && !doc?.hidden) frame(() => frame(() => {
      if (!doc?.hidden && version === visibilityVersion) callback(clock());
    }));
  };
  return {
    registerTabs(names) { for (const name of names) if (!state.tabs.has(name)) state.tabs.set(name, { name, count: 0, latestMs: null, worstMs: null, handlerMs: null }); },
    beginTab(name) {
      const started = clock();
      return () => {
        const row = state.tabs.get(name) || { name, count: 0, worstMs: null };
        state.tabs.set(name, row); row.count++; row.handlerMs = clock() - started;
        afterFrame(ended => { row.latestMs = ended - started; row.worstMs = Math.max(row.worstMs ?? 0, row.latestMs); });
      };
    },
    socketStart() { if (state.socket.state === 'Disconnected') state.socket.reconnects++; state.socket.state = 'Connecting'; state.socket.attempts++; state.socket.started = clock(); },
    socketOpen() {
      state.socket.state = 'Connected'; state.socket.connectMs = clock() - state.socket.started;
      state.socket.openedAt = clock();
      for (const row of state.topics.values()) { row.initialMs = null; row.available = false; }
    },
    socketClose(unexpected = true) { state.socket.state = unexpected ? 'Disconnected' : 'Paused'; if (unexpected) state.socket.disconnects++; for (const row of state.topics.values()) row.available = false; },
    socketTopic(topic, message, started) {
      const row = state.topics.get(topic) || { topic, count: 0, initialMs: null };
      state.topics.set(topic, row); row.count++; row.available = message.type === 'snapshot';
      row.receivedAt = now(); row.publicationAt = Date.parse(message.observedAt);
      row.sourceAt = Date.parse(message.data?.observedAt || '');
      row.handlerMs = clock() - started;
      if (row.initialMs === null && state.socket.openedAt !== null) row.initialMs = clock() - state.socket.openedAt;
      afterFrame(ended => { row.frameMs = ended - started; });
    },
    snapshot() {
      const navigation = perf?.getEntriesByType?.('navigation')?.[0];
      const navigationMs = key => navigation && navigation[key] > 0 ? navigation[key] - (navigation.startTime || 0) : null;
      const groups = new Map();
      for (const row of state.resources) {
        const group = groups.get(row.type) || { type: row.type, count: 0, totalMs: 0, worstMs: 0, bytes: 0 };
        groups.set(row.type, group); group.count++; group.totalMs += row.duration; group.worstMs = Math.max(group.worstMs, row.duration); group.bytes += row.bytes || 0;
      }
      return { ...state, navigation: { ttfb: navigationMs('responseStart'), dom: navigationMs('domContentLoadedEventEnd'), load: navigationMs('loadEventEnd'), fcp: state.paints['first-contentful-paint'] ?? null, lcp: state.paints.lcp ?? null }, groups: [...groups.values()], resourceCount, clock: clock(), now: now(), frameSupported: Boolean(frame), tabs: [...state.tabs.values()], topics: [...state.topics.values()] };
    },
    destroy() { for (const observer of state.observers) observer.disconnect(); win?.removeEventListener('error', error, true); win?.removeEventListener('unhandledrejection', error); doc?.removeEventListener('visibilitychange', visibility); },
  };
}
export const sitePerformance = createSitePerformance();
if (import.meta.hot) import.meta.hot.dispose(() => sitePerformance.destroy());
