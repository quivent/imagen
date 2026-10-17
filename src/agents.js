import { studioLive } from './live-store.js';
import './agents.css';

export function mountAgents({ root, isActive = () => true }) {
  const $ = id => root.querySelector('#agents-' + id);
  const statuses = new Set(['running', 'working', 'idle', 'waiting', 'done', 'failed', 'interrupted', 'assigned', 'unknown']);
  const names = {
    '/root': 'Coordinator',
    '/root/model_downloads': 'Model Downloads',
    '/root/vast_site': 'Site Setup',
    '/root/task_list': 'Task Keeper',
    '/root/repo_organization': 'Frontend',
  };
  const displayName = agent => {
    if (typeof agent.name === 'string' && agent.name.trim()) return agent.name.trim();
    if (names[agent.id]) return names[agent.id];
    const name = String(agent.id || '').split('/').filter(Boolean).at(-1) || 'Unnamed worker';
    return name.replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  };
  let observation = null;
  let connected = false;
  let enabled = false;
  let disposed = false;
  let release = null;
  let timer = null;
  const timestamp = value => {
    if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
    if (typeof value !== 'string' || !value.trim()) return null;
    const result = Date.parse(value);
    return Number.isFinite(result) ? result : null;
  };
  const stamp = value => timestamp(value) === null ? 'Not recorded' : new Date(timestamp(value)).toLocaleString();
  const duration = value => {
    const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
    const minutes = Math.floor(seconds / 60);
    return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
  };
  const text = (tag, value, className) => {
    const node = document.createElement(tag);
    node.textContent = value;
    if (className) node.className = className;
    return node;
  };
  function card(agent, fresh, coordinator = false) {
    const node = document.createElement('article');
    node.className = 'agents-card';
    const heading = document.createElement('div');
    heading.className = 'agents-card-heading';
    const status = fresh && statuses.has(agent.status) ? agent.status : 'unknown';
    const badge = text('span', status === 'working' ? 'Running' : status.charAt(0).toUpperCase() + status.slice(1), 'agents-state');
    badge.dataset.state = status === 'working' ? 'running' : status;
    heading.append(text('h3', coordinator ? 'Coordinator' : displayName(agent)), badge);
    node.append(heading, text('p', typeof agent.task === 'string' && agent.task.trim() ? agent.task : 'Current assignment is not recorded.', 'agents-task'));
    if (agent.currentTaskId) node.append(text('p', 'Task: ' + String(agent.currentTaskId), 'agents-task-id'));
    const measures = document.createElement('dl');
    measures.className = 'agents-timing';
    const started = timestamp(agent.startedAt);
    const transition = timestamp(agent.lastTransitionAt);
    const elapsedStart = started ?? transition;
    const entries = [[started === null ? 'State since' : 'Started', stamp(started ?? agent.lastTransitionAt)]];
    if (elapsedStart !== null && elapsedStart <= Date.now() && fresh && ['running', 'working', 'waiting', 'idle', 'assigned'].includes(status)) entries.push([started === null ? 'Time in state' : 'Elapsed', duration(elapsedStart)]);
    if (agent.lastEventAt) entries.push(['Last event', stamp(agent.lastEventAt)]);
    for (const [label, value] of entries) {
      const item = document.createElement('div');
      item.append(text('dt', label), text('dd', value));
      measures.append(item);
    }
    node.append(measures);
    return node;
  }
  function render() {
    const observed = timestamp(observation?.observedAt);
    const fresh = connected && observation?.ok === true && observation?.live === true && observed !== null && Date.now() - observed >= -30000 && Date.now() - observed <= 12000;
    $('connection').textContent = fresh ? 'Live' : connected ? 'Unknown · stale source' : 'Disconnected';
    $('connection').dataset.state = fresh ? 'running' : 'unknown';
    const agents = Array.isArray(observation?.agents) ? observation.agents.filter(agent => agent && typeof agent.id === 'string') : [];
    const running = agents.filter(agent => ['running', 'working'].includes(agent.status)).length;
    $('summary').textContent = fresh ? `${running} running · ${agents.length} workers observed in this session` : 'Current activity is unknown until a fresh session observation arrives.';
    $('capacity').textContent = Number.isInteger(observation?.capacity) && observation.capacity >= 0 ? `· ${observation.capacity} slots observed` : '';
    $('coordinator').replaceChildren(card({ status: observation?.coordinator, task: observation?.coordinatorTask, startedAt: observation?.coordinatorStartedAt, lastTransitionAt: observation?.coordinatorLastTransitionAt }, fresh, true));
    $('workers').replaceChildren(...(agents.length ? agents.map(agent => card(agent, fresh)) : [text('p', fresh ? 'No workers are currently recorded in this session.' : 'Worker activity is not available yet.', 'agents-source')]));
    $('observed').textContent = observed === null ? 'Source observation is not available yet.' : `Session source observed ${stamp(observed)}${fresh ? '' : ' · current states are unknown'}`;
  }
  function sync() {
    const active = !disposed && enabled && !document.hidden && isActive();
    if (active && !release) {
      release = studioLive.subscribe('monitor', snapshot => {
        connected = snapshot.available === true;
        if (connected) observation = snapshot.data?.agents || null;
        render();
      });
      timer = setInterval(render, 1000);
    } else if (!active && release) {
      release(); release = null;
      clearInterval(timer); timer = null;
      connected = false;
    }
    if (active) render();
  }
  document.addEventListener('visibilitychange', sync);
  return {
    setActive(value) { enabled = value; sync(); },
    destroy() { disposed = true; sync(); document.removeEventListener('visibilitychange', sync); },
  };
}
