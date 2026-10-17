import { studioLive } from './live-store.js';
import { sitePerformance } from './site-performance.js';
import './performance.css';

export function mountPerformance({ root, isActive = () => true }) {
  const $ = id => root.querySelector('#performance-' + id);
  const profiles = [['flux1-dev', 'FLUX.1 dev'], ['flux2-dev-nf4', 'FLUX.2 dev']];
  const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
  let archive = null;
  let archiveConnected = false;
  let generation = null;
  let telemetryConnected = false;
  let daemon = null;
  let enabled = false;
  let disposed = false;
  let releases = [];
  let timer = null;
  const timestamp = value => {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 1e12 ? value * 1000 : value;
    if (typeof value !== 'string' || !value.trim()) return null;
    const result = Date.parse(value);
    return Number.isFinite(result) ? result : null;
  };
  const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const value = (input, unit = '') => finite(input) ? number.format(input) + unit : 'Not recorded';
  const stamp = input => timestamp(input) === null ? 'Not recorded' : new Date(timestamp(input)).toLocaleString();
  const text = (tag, content, className) => {
    const node = document.createElement(tag);
    node.textContent = content;
    if (className) node.className = className;
    return node;
  };
  const milliseconds = input => finite(input) ? `${number.format(input)} ms` : 'Not observed';
  const bytes = input => input > 0 ? `${number.format(input / 1024)} KB` : 'Cached / unavailable';
  function siteTable(id, rows) {
    if (!rows.length) {
      const row = document.createElement('tr'); const cell = text('td', 'No observations yet');
      cell.colSpan = $(id).closest('table').querySelectorAll('thead th').length;
      row.append(cell); $(id).replaceChildren(row); return;
    }
    $(id).replaceChildren(...rows.map(fields => {
      const row = document.createElement('tr');
      fields.forEach((field, index) => { const cell = text(index ? 'td' : 'th', String(field)); if (!index) cell.scope = 'row'; row.append(cell); });
      return row;
    }));
  }
  function renderSite() {
    const data = sitePerformance.snapshot();
    const nav = data.navigation;
    const cards = [['First byte (TTFB)', nav.ttfb], ['DOM ready', nav.dom], ['Window load', nav.load], ['First contentful paint', nav.fcp], ['Largest contentful paint', nav.lcp]];
    $('site-overview').replaceChildren(...cards.map(([label, duration]) => {
      const card = text('dl', '', 'performance-site-measure'); card.append(text('dt', label), text('dd', milliseconds(duration))); return card;
    }));
    const slowResources = data.resources.filter(row => row.duration >= 1000).length;
    const slowTabs = data.tabs.filter(row => row.worstMs >= 100).length;
    const staleMonitor = data.topics.find(row => row.topic === 'monitor' && row.available && Number.isFinite(row.sourceAt) && data.now - row.sourceAt > 12000);
    const issues = [`${slowResources} requests ≥ 1 s`, `${slowTabs} tabs with frames ≥ 100 ms`, `${data.longTasks.length} retained long tasks`, `${data.errors.length} retained errors`];
    if (staleMonitor) issues.push('Monitor source is stale');
    $('site-status').textContent = `${issues.join(' · ')}. ${data.resourceCount} resource observations this session. ${!data.supported.resource ? 'Resource observation unsupported. ' : ''}${!data.supported.paint ? 'Paint observation unsupported. ' : ''}${!data.supported['largest-contentful-paint'] ? 'Largest-contentful-paint unsupported. ' : ''}${!data.frameSupported ? 'Animation-frame measurements unsupported.' : ''}`;
    $('site-status').classList.toggle('performance-slow', slowResources > 0 || slowTabs > 0 || Boolean(staleMonitor) || data.errors.length > 0);
    siteTable('site-tabs', data.tabs.map(row => [row.name, row.count, milliseconds(row.latestMs), milliseconds(row.worstMs), milliseconds(row.handlerMs), !row.count ? 'Visit to measure' : row.latestMs === null ? 'Frame pending / unavailable' : row.latestMs >= 100 ? 'Slow frame' : 'Under 100 ms']));
    siteTable('site-resource-types', data.groups.map(row => [row.type, row.count, milliseconds(row.totalMs / row.count), milliseconds(row.worstMs), bytes(row.bytes)]));
    siteTable('site-resources', [...data.resources].sort((a, b) => b.duration - a.duration).slice(0, 15).map(row => [row.path, row.type, milliseconds(row.duration), bytes(row.bytes), row.status ?? 'Unavailable']));
    $('site-socket').textContent = `${data.socket.state} · latest connection ${milliseconds(data.socket.connectMs)} · ${data.socket.attempts} attempts · ${data.socket.reconnects} reconnect attempts after disconnect · ${data.socket.disconnects} unexpected disconnects`;
    const age = input => Number.isFinite(input) && input >= 0 ? milliseconds(input) : 'Unknown / clock difference';
    siteTable('site-topics', data.topics.map(row => [row.topic, milliseconds(row.initialMs), row.count, milliseconds(row.handlerMs), milliseconds(row.frameMs), age(data.now - row.receivedAt), age(row.receivedAt - row.publicationAt), !row.available ? 'Unavailable' : row.topic === 'monitor' ? `${!Number.isFinite(row.sourceAt) || data.now - row.sourceAt > 12000 ? 'Stale / unknown' : 'Available'} · source age ${age(data.now - row.sourceAt)}` : 'Available']));
    $('site-longtasks').textContent = data.supported.longtask ? `${data.longTasks.length} retained tasks over 50 ms · ${milliseconds(data.longTasks.reduce((sum, row) => sum + row.duration, 0))} total occupied time. Latest 10 below; session retains up to 100.` : 'Long-task observation is unsupported in this browser; main-thread blocking is unknown.';
    siteTable('site-longtask-list', data.longTasks.slice(-10).reverse().map(row => [milliseconds(row.start), milliseconds(row.duration)]));
    $('site-errors').textContent = `${data.errors.length} retained JavaScript, promise or resource load errors (up to 50). HTTP failures are shown in the requests table when the browser exposes status codes.`;
    $('site-error-list').replaceChildren(...data.errors.slice(-10).reverse().map(row => text('li', `${row.type} · ${row.path} · ${milliseconds(row.at)} since navigation`)));
  }
  function renderDaemon() {
    const observed = timestamp(daemon?.observedAt);
    const fresh = telemetryConnected && daemon?.ok === true && observed !== null && Date.now() - observed <= 20000 && Date.now() - observed >= -1000;
    const states = { watching: 'Watching Performance engineer', blocked: 'Blocked · engineer lifecycle source unavailable' };
    const status = fresh ? states[daemon.state] || 'Unknown activity' : 'Unknown · daemon source unavailable or stale';
    $('daemon-status').textContent = `${status} · process ${daemon?.alive === true && telemetryConnected ? 'alive' : 'unknown'} · heartbeat ${stamp(daemon?.heartbeatAt)} · ${daemon?.activityCount ?? 'Unknown'} lifecycle observations · engineer ${fresh ? daemon.agentState || 'unknown' : 'unknown'}${daemon?.wakeQueued ? ' · coordinator wake queued' : ''}`;
    $('daemon-events').textContent = daemon?.events?.length ? 'Recent activation events: ' + daemon.events.slice(-5).map(event => `${event.event.replaceAll('_', ' ')} (${stamp(event.at)})`).join(' · ') : 'No recorded engineer activation events yet.';
  }
  function renderArchive() {
    const now = Date.now();
    const unique = new Map();
    for (const job of archive?.jobs || []) {
      if (job && typeof job.id === 'string' && profiles.some(([id]) => id === job.profile)) unique.set(job.profile + ':' + job.id, job);
    }
    const jobs = [...unique.values()];
    $('models').replaceChildren(...profiles.map(([profile, name]) => {
      const rows = jobs.filter(job => job.profile === profile).map(job => ({ ...job, completed: timestamp(job.created) })).filter(job => job.completed !== null && job.completed <= now).sort((a, b) => b.completed - a.completed);
      const recent = rows.slice(0, 20);
      const durations = recent.map(job => job.seconds).filter(seconds => finite(seconds) && seconds > 0).sort((a, b) => a - b);
      const median = durations.length ? (durations[Math.floor(durations.length / 2)] + durations[Math.floor((durations.length - 1) / 2)]) / 2 : null;
      const latest = rows[0];
      const latestDuration = latest && finite(latest.seconds) && latest.seconds > 0 ? value(latest.seconds, ' s') : 'Not recorded';
      const settings = latest ? [finite(latest.width) && finite(latest.height) ? `${latest.width} × ${latest.height}` : 'size not recorded', finite(latest.settings?.steps) ? `${latest.settings.steps} steps` : 'steps not recorded'].join(' · ') : 'Not recorded';
      const hourCount = rows.filter(job => job.completed > now - 3600000).length;
      const row = document.createElement('tr');
      const fields = [name, latestDuration, median === null ? 'Not recorded' : value(median, ' s'), `${durations.length} / ${recent.length} recent`, archive ? `${hourCount} / h` : 'Unknown', settings];
      fields.forEach((field, index) => { const cell = text(index ? 'td' : 'th', field); if (!index) cell.scope = 'row'; row.append(cell); });
      return row;
    }));
    const undated = jobs.filter(job => timestamp(job.created) === null || timestamp(job.created) > now).length;
    $('archive-status').textContent = `${archiveConnected ? 'Archive connected' : archive ? 'Archive disconnected · showing last recorded timings' : 'Archive unavailable'}${archive ? ` · updated ${stamp(archive.updatedAt)} · ${undated} records without valid completion times excluded` : ''}`;
  }
  function renderGPUs() {
    const gpus = Array.isArray(generation?.gpus) ? generation.gpus.filter(gpu => gpu && typeof gpu === 'object') : [];
    let live = 0;
    $('gpus').replaceChildren(...(gpus.length ? gpus.map(gpu => {
      const observedAt = gpu.observedAt ?? generation.observedAt;
      const observed = timestamp(observedAt);
      const fresh = telemetryConnected && observed !== null && Date.now() - observed >= -30000 && Date.now() - observed <= 12000;
      if (fresh) live++;
      const card = document.createElement('article'); card.className = 'performance-gpu';
      card.append(text('h3', `GPU ${gpu.index ?? '—'} · ${typeof gpu.name === 'string' ? gpu.name : 'Name not recorded'}`));
      const measures = document.createElement('dl');
      const fields = [
        ['Utilization', value(gpu.utilization_percent, '%')],
        ['Memory', finite(gpu.memory_used_mb) ? value(gpu.memory_used_mb, ' MB') + (finite(gpu.memory_total_mb) ? ' / ' + value(gpu.memory_total_mb, ' MB') : '') : 'Not recorded'],
        ['Power', finite(gpu.power_watts) ? value(gpu.power_watts, ' W') + (finite(gpu.power_limit_watts) ? ' / ' + value(gpu.power_limit_watts, ' W') : '') : 'Not recorded'],
        ['Temperature', value(gpu.temperature_c, ' °C')],
      ];
      for (const [label, reading] of fields) { const entry = document.createElement('div'); entry.append(text('dt', label), text('dd', fresh ? reading : 'Unknown')); measures.append(entry); }
      card.append(measures, text('p', `${fresh ? 'Live' : 'Unknown · source unavailable or stale'} · observed ${stamp(observedAt)}`, 'performance-source'));
      return card;
    }) : [text('p', 'GPU telemetry is not available yet.', 'performance-source')]));
    $('gpu-status').textContent = live ? `${live} GPUs with fresh telemetry. Observations older than 12 seconds become unknown.` : 'Current GPU readings are unknown until fresh telemetry arrives.';
  }
  function render() { renderDaemon(); renderSite(); renderArchive(); renderGPUs(); }
  function sync() {
    const active = !disposed && enabled && !document.hidden && isActive();
    if (active && !releases.length) {
      releases = [
        studioLive.subscribe('gallery', snapshot => { archiveConnected = snapshot.available === true && Array.isArray(snapshot.data?.jobs); if (archiveConnected) archive = snapshot.data; renderArchive(); }),
        studioLive.subscribe('monitor', snapshot => { telemetryConnected = snapshot.available === true; if (telemetryConnected) { generation = snapshot.data?.generation || null; daemon = snapshot.data?.performanceDaemon || null; } renderGPUs(); renderDaemon(); }),
      ];
      timer = setInterval(render, 1000);
    } else if (!active && releases.length) {
      for (const release of releases) release(); releases = [];
      clearInterval(timer); timer = null;
      archiveConnected = false; telemetryConnected = false;
    }
    if (active) render();
  }
  document.addEventListener('visibilitychange', sync);
  return { setActive(value) { enabled = value; sync(); }, destroy() { disposed = true; sync(); document.removeEventListener('visibilitychange', sync); } };
}
