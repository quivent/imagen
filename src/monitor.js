import { studioLive } from './live-store.js';
import './monitor.css';
import { agentView, dispatchView, taskAssignment } from './agent-state.js';

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
        Object.assign(record, { status: 'unconfirmed', authNeeded: true, detail: 'The studio connection is unavailable. This correction has not been applied.' });
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
  let enabled = false;
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
  function agents(section, snapshot) {
    source('agents', section);
    const view = agentView(snapshot);
    if (!view.fresh) {
      unknown('agents', section, 'Current agent runtime evidence is unavailable or older than 12 seconds.');
      list('agents-list', []); return;
    }
    const dispatch = dispatchView(snapshot);
    if (dispatch.state === 'violation') state('agents', 'Dispatch violation', 'attention');
    else if (dispatch.state === 'ok') state('agents', `${view.running} running · ${view.available} available`, 'active');
    else state('agents', 'Dispatch unknown', 'unknown');
    $('agents-evidence').textContent = `${view.running} running · ${view.available} available · ${view.agents.length} agents in this session. Coordinator ${view.coordinator.status}.${dispatch.state === 'violation' ? ` Ready work is not being dispatched (${Array.isArray(dispatch.readyTaskIds) ? dispatch.readyTaskIds.length : 'unknown'} ready tasks).` : dispatch.state === 'unknown' ? ' Dispatch compliance has no fresh enforcement observation.' : ' Dispatch compliance is verified by the current enforcement observation.'}${Number.isFinite(dispatch.score) ? ` Enforcement score: ${dispatch.score}.` : ''}`;
    list('agents-list', view.agents.map(agent => `${agent.name || agent.id} · ${agent.status} · ${agent.status === 'running' ? 'current assignment' : 'last assignment'}: ${agent.task || 'not recorded'}${agent.currentTaskId ? ' · task ' + agent.currentTaskId : ''}`));
  }
  function tasks(section, snapshot) {
    source('tasks', section);
    const view = agentView(snapshot);
    if (section?.ok !== true || !fresh(section.observedAt) || !Array.isArray(section.working) || !view.fresh) {
      unknown('tasks', section, 'Current task records and matching live assignments could not both be verified.');
      list('tasks-list', []); return;
    }
    const working = section.working;
    const matched = working.filter(task => taskAssignment(view, task));
    state('tasks', matched.length ? `${matched.length} tasks running` : 'No matching task running', matched.length ? 'active' : 'attention');
    $('tasks-evidence').textContent = `${matched.length} task records match a running agent and current task ID. ${working.length - matched.length} recorded in progress without a matching running assignment. Full task history is on the Tasks tab.`;
    list('tasks-list', working.map(task => { const agent = taskAssignment(view, task); return `${task.id} · ${task.title || 'Project work'} · ${agent ? 'running: ' + (agent.name || agent.id) : 'recorded in progress; no matching running assignment'}`; }));
  }
  function render(data) {
    generation(data.generation); agents(data.agents, data); tasks(data.tasks, data); updateCorrections();
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
  function receive(observation) {
    if (!alive()) return;
    root.dataset.monitorReady = 'true';
    const data = observation?.data;
    if (observation?.available !== true || data?.ok !== true || !fresh(data.observedAt)) {
      lastResponse = null; disconnected(); return;
    }
    lastResponse = data; lastConnectedAt = Date.now(); render(data);
  }
  function refresh() {
    if (!alive()) return;
    if (lastResponse && !fresh(lastResponse.observedAt)) {
      lastResponse = null; disconnected();
    }
  }
  function stop() {
    if (timer !== null) clearInterval(timer);
    timer = null; releaseTopic?.(); releaseTopic = null;
  }
  function sync() {
    if (!alive()) { stop(); return; }
    if (!releaseTopic) releaseTopic = studioLive.subscribe('monitor', receive);
    if (timer === null) timer = setInterval(refresh, interval);
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
