import { studioLive } from './live-store.js';
import './daemons.css';

const errorLabels = {
  archive_backlog: 'Completed images are waiting for verified archival.',
  queue_nonzero_requires_reconciliation: 'Request notification failed; delivery needs checking.',
  queue_timeout_requires_reconciliation: 'Request notification timed out; delivery needs checking.',
  queue_executable_missing: 'The request notification command is unavailable.',
  interrupted_delivery_requires_reconciliation: 'Notification was interrupted; delivery needs checking.',
  queue_oserror_requires_reconciliation: 'The request notification command could not run.',
};

export function mountDaemons({ root, isActive = () => true }) {
  const $ = id => root.querySelector('#daemons-' + id);
  let observation = null;
  let connected = false;
  let enabled = false;
  let disposed = false;
  let release = null;
  let timer = null;
  const time = value => {
    if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
    if (typeof value !== 'string' || !value.trim()) return null;
    const stamp = Date.parse(value);
    return Number.isFinite(stamp) ? stamp : null;
  };
  const stamp = value => time(value) === null ? 'Not observed' : new Date(time(value)).toLocaleString();
  const text = (tag, value, className) => {
    const node = document.createElement(tag);
    node.textContent = value;
    if (className) node.className = className;
    return node;
  };
  function card(item, sourceFresh) {
    const node = document.createElement('article');
    node.className = 'daemons-card';
    const observed = time(item.observedAt ?? observation?.observedAt);
    const maxAge = Number.isFinite(item.staleAfterSeconds) ? item.staleAfterSeconds * 1000 : 15000;
    const fresh = sourceFresh && observed !== null && Date.now() - observed >= -30000 && Date.now() - observed <= maxAge;
    const alive = item.alive ?? item.running;
    const state = fresh && typeof alive === 'boolean' ? alive ? 'running' : 'stopped' : 'unknown';
    const heading = text('div', '', 'daemons-card-heading');
    const badge = text('span', state === 'running' ? 'Running' : state === 'stopped' ? 'Stopped' : 'Unknown', 'daemons-state');
    badge.dataset.state = state;
    heading.append(text('h2', typeof item.name === 'string' ? item.name : 'Background service'), badge);
    node.append(heading, text('p', typeof item.description === 'string' ? item.description : 'Service description is not recorded.', 'daemons-description'));
    const measures = text('dl', '', 'daemons-measures');
    const activity = time(item.lastActivityAt);
    const entries = [['Process', fresh && typeof alive === 'boolean' ? alive ? 'Alive' : 'Not running' : 'Unknown'],
      ['Last activity', activity === null ? 'Not observed' : `${stamp(activity)}${fresh ? '' : ' · historical'}`]];
    if (Number.isInteger(item.pid) && item.pid > 0 && fresh && alive) entries.push(['Process ID', String(item.pid)]);
    if (Number.isFinite(item.activityCount) && item.activityCount >= 0) entries.push([typeof item.activityLabel === 'string' ? item.activityLabel : 'Recorded events', `${item.activityCount}${fresh ? '' : ' · historical'}`]);
    if (item.heartbeatAt) entries.push(['Heartbeat', stamp(item.heartbeatAt)]);
    if (item.id === 'archive') {
      const heartbeat = time(item.heartbeatAt);
      const coverageFresh = fresh && heartbeat !== null && Date.now() - heartbeat <= 30000;
      entries.push(['Archive coverage', coverageFresh ? item.archiveStatus === 'healthy' ? 'Verified current' : 'Reconciliation in progress' : 'Unknown · archive observation stale'],
        ['Pending uploads', coverageFresh && Number.isFinite(item.pendingJobs) ? String(item.pendingJobs) : 'Unknown'],
        ['Verification due', coverageFresh && Number.isFinite(item.verificationDueJobs) ? String(item.verificationDueJobs) : 'Unknown']);
      if (coverageFresh && Number.isFinite(item.oldestPendingSeconds)) entries.push(['Oldest pending', `${Math.round(item.oldestPendingSeconds)} seconds`]);
    }
    if (item.id === 'performance') {
      const activities = { watching: 'Watching Performance engineer', blocked: 'Blocked · lifecycle source unavailable', unknown: 'Unknown' };
      entries.push(['Activity', fresh && alive ? activities[item.activityState] || 'Unknown' : 'Unknown'],
        ['Engineer', fresh ? ({ running: 'Running', done: 'Idle', available: 'Available', idle: 'Idle' }[item.agentState] || 'Unknown') : 'Unknown'],
        ['Activation', item.wakeQueued ? 'Coordinator wake queued; agent activation uses the coordinator' : 'Watching for the engineer becoming idle']);
    }
    for (const [label, value] of entries) {
      const pair = text('div', '');
      pair.append(text('dt', label), text('dd', value));
      measures.append(pair);
    }
    node.append(measures);
    // Errors are fixed labels only. Never render arbitrary process stderr,
    // logs, command lines or potentially private service error payloads.
    const error = item.errorCode ?? item.error;
    if (error) node.append(text('p', errorLabels[error] || 'A service error was reported; private diagnostics need checking.', 'daemons-error'));
    return node;
  }
  function render() {
    const observed = time(observation?.observedAt);
    const maxAge = Number.isFinite(observation?.staleAfterSeconds) ? observation.staleAfterSeconds * 1000 : 15000;
    const fresh = connected && observation?.ok !== false && observed !== null && Date.now() - observed >= -30000 && Date.now() - observed <= maxAge;
    $('connection').textContent = fresh ? 'Live observations' : connected ? 'Unknown · stale source' : 'Disconnected';
    $('connection').dataset.state = fresh ? 'running' : 'unknown';
    const items = Array.isArray(observation?.items) ? observation.items : Array.isArray(observation?.daemons) ? observation.daemons : [];
    const rows = items.filter(item => item && typeof item.id === 'string');
    $('list').replaceChildren(...(rows.length ? rows.map(item => card(item, fresh)) : [text('p', 'No service observations are available yet.', 'daemons-source')]));
    $('observed').textContent = observed === null ? 'Source observation is not available yet.' : `Services observed ${stamp(observed)}${fresh ? '' : ' · current liveness is unknown'}`;
  }
  function sync() {
    const active = !disposed && enabled && !document.hidden && isActive();
    if (active && !release) {
      release = studioLive.subscribe('monitor', snapshot => {
        connected = snapshot.available === true;
        if (connected) observation = snapshot.data?.daemons || null;
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
