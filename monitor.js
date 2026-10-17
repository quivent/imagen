import { studioLive } from './live-store.js';
import './monitor.css';

export function mountMonitor({ root, isActive = () => true }) {
  const $ = id => root.querySelector('#monitor-' + id);
  const profiles = ['flux1-dev', 'flux2-dev-nf4'];
  const names = { 'flux1-dev': 'FLUX.1', 'flux2-dev-nf4': 'FLUX.2' };
  const correctionLabels = { generation: 'Restore generation dispatch', agents: 'Assign available subagents', tasks: 'Help current work' };
  const ruleKinds = new Map();
  const corrections = new Map();
  const actionListeners = [];
  const actionControllers = new Set();
  function saveCorrection(rule, record) {
    try {
      const key = 'artwork-studio:correction:' + rule;
      if (record) sessionStorage.setItem(key, JSON.stringify({ requestId: record.requestId, requestedAt: record.requestedAt }));
      else sessionStorage.removeItem(key);
    } catch { /* Live retry identity remains available in this mounted view. */ }
  }
  for (const rule of Object.keys(correctionLabels)) {
    try {
      const record = JSON.parse(sessionStorage.getItem('artwork-studio:correction:' + rule) || 'null');
      if (record && /^[a-f0-9-]{36}$/i.test(record.requestId) && Number.isFinite(record.requestedAt)) corrections.set(rule, { ...record, status: 'unconfirmed', detail: 'A previous request is unconfirmed. Retrying keeps its original request ID.' });
    } catch { /* An empty action state remains usable without browser storage. */ }
  }
  function updateCorrections() {
    for (const rule of Object.keys(correctionLabels)) {
      let record = corrections.get(rule);
      if (record?.status === 'verified' && ruleKinds.get(rule) !== 'active') { corrections.delete(rule); record = undefined; }
      const section = lastResponse?.[rule];
      if (['pending', 'unconfirmed'].includes(record?.status) && ruleKinds.get(rule) === 'active' && fresh(section?.observedAt) && date(section.observedAt) >= record.requestedAt) {
        record.status = 'verified'; record.detail = 'The current live source now observes this rule. Request acceptance alone was not treated as success.'; saveCorrection(rule, null);
      }
      if (record?.status === 'pending' && Date.now() - record.requestedAt > 120000) { record.status = 'unconfirmed'; record.detail = 'No verified change has arrived yet. Retry the same request without duplicating it.'; }
      const button = $(rule + '-correct');
      const text = record?.status === 'posting' ? 'Requesting correction…' : record?.status === 'pending' ? 'Correction pending' : record?.status === 'unconfirmed' ? 'Retry correction' : correctionLabels[rule];
      if (button.textContent !== text) button.textContent = text;
      button.disabled = ['posting', 'pending'].includes(record?.status) || ruleKinds.get(rule) === 'active';
      const detail = record?.detail || (ruleKinds.get(rule) === 'active' ? 'The current source observes this rule; no correction is needed.' : rule === 'generation' ? 'Restore bounded refill and dispatch services; ask the coordinator to review generator health. Deliberately paused dispatch is reviewed in Controls.' : 'Ask the coordinator to help existing work or finish its handoff. Queued work stays queued during wrap-up; the live source verifies the result.');
      const status = $(rule + '-action-status'); if (status.textContent !== detail) status.textContent = detail;
      $(rule + '-controls').hidden = !(record?.authNeeded || rule === 'generation' && section?.workers?.some(worker => worker.paused));
    }
  }
  async function correct(rule) {
    const previous = corrections.get(rule);
    if (['posting', 'pending'].includes(previous?.status) || ruleKinds.get(rule) === 'active') return;
    const record = previous && previous.status !== 'verified' ? previous : { requestId: crypto.randomUUID(), requestedAt: Date.now() };
    Object.assign(record, { status: 'posting', authNeeded: false, detail: 'Requesting a real correction. Current rule status still comes from its live source.' });
    corrections.set(rule, record); saveCorrection(rule, record); updateCorrections();
    const request = new AbortController(); actionControllers.add(request);
    const timeout = setTimeout(() => request.abort(), 55000);
    try {
      const response = await fetch('/api/studio-corrections', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rule, requestId: record.requestId }), signal: request.signal });
      const result = await response.json().catch(() => ({}));
      if ([401, 403].includes(response.status)) {
        Object.assign(record, { status: 'unconfirmed', authNeeded: true, detail: 'Open Controls to authorize corrections, then return and retry this same request.' });
      } else if (response.ok && result.ok === true && result.status === 'pending') {
        Object.assign(record, { status: result.handoff === 'accepted' ? 'pending' : 'unconfirmed', detail: result.handoff === 'accepted' ? 'Correction accepted and pending. Only a later live source observation can verify the rule.' : 'The request is recorded but coordinator handoff is unconfirmed. Retry the same request; it will not create a duplicate.' });
      } else {
        Object.assign(record, { status: 'unconfirmed', detail: 'The correction could not be confirmed. Retrying keeps the same request ID.' });
      }
    } catch {
      Object.assign(record, { status: 'unconfirmed', detail: 'The correction response did not arrive. Retry the same request to reconcile it without duplication.' });
    } finally {
      clearTimeout(timeout); actionControllers.delete(request);
      if (!disposed) updateCorrections();
    }
  }
  for (const rule of Object.keys(correctionLabels)) {
    const listener = () => correct(rule);
    $(rule + '-correct').addEventListener('click', listener);
    actionListeners.push([rule, listener]);
  }

  const interval = 2500;
  const freshFor = 12000;
  let enabled = true;
  let disposed = false;
  let suspended = false;
  let controller = null;
  let busy = false;
  let refreshRequested = false;
  let timer = null;
  let releaseTopic = null;
  let lastResponse = null;
  let lastConnectedAt = null;
  const alive = () => !disposed && !suspended && enabled && !document.hidden && isActive();
  function date(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
    if (typeof value !== 'string' || !value.trim()) return null;
    const result = Date.parse(value);
    return Number.isFinite(result) ? result : null;
  }
  const stamp = value => date(value) === null ? 'not recorded' : new Date(date(value)).toLocaleString();
  function age(value) {
    const time = date(value);
    return time === null ? 'age unknown' : `${Math.max(0, Math.floor((Date.now() - time) / 1000))} s ago`;
  }
  function fresh(value) {
    const time = date(value);
    return time !== null && Date.now() - time <= freshFor && Date.now() - time >= -30000;
  }
  function state(rule, label, kind = 'unknown') {
    const node = $(rule + '-state');
    if (node.textContent !== label) node.textContent = label;
    if (node.dataset.state !== kind) node.dataset.state = kind;
    if (['generation', 'agents', 'tasks'].includes(rule)) ruleKinds.set(rule, kind);
  }
  function list(id, values) {
    const node = $(id);
    const previous = [...node.children];
    values.forEach((value, index) => {
      let item = previous[index];
      if (!item) { item = document.createElement('li'); node.append(item); }
      if (item.textContent !== value) item.textContent = value;
    });
    for (const item of previous.slice(values.length)) item.remove();
  }
  function source(rule, section) {
    $(rule + '-time').textContent = `Source: ${section?.source || 'live studio server'} · observed ${stamp(section?.observedAt)} · ${age(section?.observedAt)}`;
  }
  function unknown(rule, section, explanation) {
    state(rule, 'Unknown');
    $(rule + '-evidence').textContent = explanation;
    source(rule, section);
  }
  function generation(section) {
    source('generation', section);
    if (section?.ok !== true || !fresh(section.observedAt) || !Array.isArray(section.workers)) {
      unknown('generation', section, 'Current worker health is unavailable or older than 12 seconds. Previous output does not establish current generation.');
      list('generation-lanes', []); return;
    }
    const workers = profiles.map(profile => section.workers.find(worker => worker.profile === profile));
    if (workers.some(worker => !worker || worker.problem || ['unavailable', 'unreachable'].includes(worker.phase))) {
      unknown('generation', section, 'At least one generator could not be observed. Both running cannot be established.');
    } else {
      const running = worker => worker.running === true || Number(worker.running) > 0 || Boolean(worker.current);
      const active = workers.filter(running).length;
      const paused = workers.some(worker => worker.paused === true);
      state('generation', paused ? 'Dispatch paused' : active === 2 ? 'Both running' : active === 1 ? 'One running' : 'Idle', active === 2 && !paused ? 'active' : 'attention');
      $('generation-evidence').textContent = `${active} of 2 resident generators have an active job in this server observation.${paused ? ' Future dispatch is paused on at least one lane.' : ''}`;
    }
    list('generation-lanes', workers.filter(Boolean).map(worker => `${names[worker.profile]} · ${Number(worker.running) > 0 || worker.current ? 'running' : worker.phase || 'unknown'} · ${worker.paused ? 'dispatch paused' : 'dispatch open'} · ${Number.isFinite(worker.queued) ? worker.queued : 'unknown'} queued${worker.current ? ' · job ' + worker.current : ''}`));
  }
  function agents(section) {
    source('agents', section);
    if (section?.ok !== true || section.live !== true || !fresh(section.observedAt) || section.capacity !== 3 || !Array.isArray(section.agents) || section.agents.length !== 3 || new Set(section.agents.map(agent => agent.id)).size !== 3 || section.agents.some(agent => typeof agent.id !== 'string' || !agent.id)) {
      unknown('agents', section, 'Current agent runtime evidence is unavailable or older than 12 seconds. A manually updated assignment file is not live agent health.');
      list('agents-list', []); return;
    }
    const running = section.agents.filter(agent => agent.status === 'running').length;
    const unknownStatus = section.agents.some(agent => !['running', 'idle', 'done', 'complete', 'completed', 'stopped', 'closed'].includes(agent.status));
    const full = running === 3 && section.coordinator === 'running';
    if (unknownStatus || !['running', 'idle'].includes(section.coordinator)) {
      unknown('agents', section, 'The runtime source does not establish the current state of every agent slot.');
    } else {
      state('agents', full ? 'All slots in use' : 'Capacity available', full ? 'active' : 'attention');
      $('agents-evidence').textContent = `${running} of 3 worker slots reported running; coordinator ${section.coordinator} is counted separately. These slots are not the task-record count.`;
    }
    list('agents-list', section.agents.map(agent => `${agent.id} · ${agent.status || 'unknown'} · ${agent.task || 'Task not recorded'}${agent.lastEventAt ? ' · latest lifecycle event ' + stamp(agent.lastEventAt) : ''}`));
  }
  function tasks(section) {
    source('tasks', section);
    if (section?.ok !== true || !fresh(section.observedAt) || !Array.isArray(section.working)) {
      unknown('tasks', section, 'Current claims and task work could not be read from the project sources.');
      list('tasks-list', []); return;
    }
    const working = section.working;
    const claims = Array.isArray(section.claims) ? section.claims.filter(claim => claim.active === true) : [];
    state('tasks', working.length ? 'Task records in progress' : 'No task record in progress', working.length ? 'active' : 'attention');
    $('tasks-evidence').textContent = `${working.length} task records marked working; ${claims.length} active claim leases. Task records, claim leases and worker slots count different things; a task can use more than one worker.`;
    list('tasks-list', working.map(task => `${task.id} · ${task.title || 'Active project work'}${claims.some(claim => claim.id === task.id) ? ' · active claim' : ''}`));
  }
  function render(data) {
    generation(data.generation); agents(data.agents); tasks(data.tasks); updateCorrections();
    state('connection', 'Connected', 'active');
    $('connection-time').textContent = `Response received ${stamp(lastConnectedAt)} · server observed ${stamp(data.observedAt)} · ${age(data.observedAt)}`;
    $('status').textContent = 'Live connection updates automatically. Each rule uses its own current source observation.';
  }
  function disconnected() {
    state('connection', 'Connection unavailable', 'disconnected');
    $('connection-time').textContent = `Last connected ${stamp(lastConnectedAt)} · checked ${new Date().toLocaleString()}`;
    for (const rule of ['generation', 'agents', 'tasks']) unknown(rule, lastResponse?.[rule], 'The live connection is unavailable. Current state is unknown until a new observation arrives.');
    $('status').textContent = 'The live monitor is reconnecting automatically. Previous observations are not shown as current compliance.';
    updateCorrections();
  }
  async function refresh() {
    if (!alive()) return;
    if (lastResponse) {
      if (!fresh(lastResponse.observedAt)) disconnected();
      else render(lastResponse);
    }
    if (busy) { refreshRequested = true; return; }
    refreshRequested = false; busy = true;
    const request = new AbortController(); controller = request;
    const timeout = setTimeout(() => request.abort(), 8000);
    try {
      const data = await studioLive.read('monitor');
      if (!alive()) return;
      if (data.ok !== true || !fresh(data.observedAt)) throw new Error('Live observation is old');
      lastResponse = data; lastConnectedAt = Date.now(); render(data);
    } catch {
      if (alive()) { disconnected(); lastResponse = null; }
    } finally {
      clearTimeout(timeout); controller = null; busy = false;
      if (refreshRequested && alive()) queueMicrotask(refresh);
    }
  }
  function stop() {
    if (timer !== null) clearInterval(timer);
    timer = null; releaseTopic?.(); releaseTopic = null; controller?.abort();
  }
  function sync() {
    if (!alive()) { stop(); return; }
    if (!releaseTopic) releaseTopic = studioLive.subscribe('monitor', refresh);
    if (timer === null) timer = setInterval(refresh, interval);
    refresh();
  }
  const visibility = () => sync();
  const pagehide = () => { suspended = true; stop(); };
  const pageshow = () => { suspended = false; sync(); };
  const recordUpdate = ({ path }) => { if (path === '/tasks.json') refresh(); };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', pagehide);
  window.addEventListener('pageshow', pageshow);
  if (import.meta.hot) import.meta.hot.on('artwork-record-update', recordUpdate);
  function destroy() {
    if (disposed) return;
    disposed = true; stop();
    for (const request of actionControllers) request.abort();
    for (const [rule, listener] of actionListeners) $(rule + '-correct').removeEventListener('click', listener);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', pagehide);
    window.removeEventListener('pageshow', pageshow);
    if (import.meta.hot) import.meta.hot.off('artwork-record-update', recordUpdate);
  }
  updateCorrections();
  sync();
  return { refresh, destroy, setActive(value) { enabled = Boolean(value); sync(); } };
}
