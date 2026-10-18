import {scopeAgentView} from './workspace-scope.js';
import { studioLive } from './live-store.js';
import './agents.css';
import { agentView } from './agent-state.js';

export function mountAgents({ root, isActive = () => true, workspace = 'production' }) {
  const $ = id => root.querySelector('[data-agents-id="' + id + '"]');
  $('scope').textContent=workspace==='workbench'?'WORKBENCH':'PRODUCTION';
  const statuses = new Set(['running', 'available', 'waiting', 'failed', 'interrupted', 'assigned', 'stopped', 'closed', 'unknown']);
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
  let snapshot = null;
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
    const badge = text('span', status.charAt(0).toUpperCase() + status.slice(1), 'agents-state');
    badge.dataset.state = status === 'working' ? 'running' : status;
    heading.append(text('h3', coordinator ? 'Coordinator' : displayName(agent)), badge);
    const assignment = typeof agent.task === 'string' && agent.task.trim() ? agent.task : null;
    node.append(heading, text('p', assignment ? `${status === 'running' ? 'Current assignment' : 'Last assignment'}: ${assignment}` : 'Current assignment is not recorded.', 'agents-task'));
    if (status === 'running' && agent.currentTaskId) node.append(text('p', 'Task: ' + String(agent.currentTaskId), 'agents-task-id'));
    const measures = document.createElement('dl');
    measures.className = 'agents-timing';
    const started = timestamp(agent.startedAt);
    const transition = timestamp(agent.lastTransitionAt);
    const elapsedStart = started ?? transition;
    const entries = [[started === null ? 'State since' : 'Started', stamp(started ?? agent.lastTransitionAt)]];
    if (elapsedStart !== null && elapsedStart <= Date.now() && fresh && ['running', 'waiting', 'assigned'].includes(status)) entries.push([started === null ? 'Time in state' : 'Elapsed', duration(elapsedStart)]);
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
    const observation = snapshot?.agents;
    const observed = timestamp(observation?.observedAt);
    const view = scopeAgentView(agentView(snapshot, connected),workspace);
    const fresh = view.fresh;
    const label=workspace==='workbench'?'Workbench':'Production';
    $('connection').textContent = fresh ? 'Live' : connected ? 'Unknown · stale source' : 'Disconnected';
    $('connection').dataset.state = fresh ? 'running' : 'unknown';
    $('summary').textContent = fresh ? `${view.running} running · ${view.available} available · ${view.agents.length} agents assigned to ${label}` : 'Current activity is unknown until a fresh session observation arrives.';
    $('capacity').textContent = `· ${view.agents.length} assigned`;
    $('coordinator').replaceChildren(view.coordinator?card(view.coordinator, fresh, true):text('p','No coordinator is explicitly assigned to '+label+'.','agents-source'));
    $('workers').replaceChildren(...(view.agents.length ? view.agents.map(agent => card(agent, fresh)) : [text('p', fresh ? 'No workers are assigned to this workspace.' : 'Worker activity is not available yet.', 'agents-source')]));
    $('observed').textContent = observed === null ? 'Source observation is not available yet.' : `Session source observed ${stamp(observed)}${fresh ? '' : ' · current states are unknown'}`;
  }
  function sync() {
    const active = !disposed && enabled && !document.hidden && isActive();
    if (active && !release) {
      release = studioLive.subscribe('monitor', incoming => {
        connected = incoming.available === true;
        if (connected) snapshot = incoming.data || null;
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
