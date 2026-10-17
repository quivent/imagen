import { studioLive } from './live-store.js';
import './performance.css';

export function mountPerformance({ root, isActive = () => true }) {
  const $ = id => root.querySelector('#performance-' + id);
  const profiles = [['flux1-dev', 'FLUX.1 dev'], ['flux2-dev-nf4', 'FLUX.2 dev']];
  const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
  let archive = null;
  let archiveConnected = false;
  let generation = null;
  let telemetryConnected = false;
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
  function render() { renderArchive(); renderGPUs(); }
  function sync() {
    const active = !disposed && enabled && !document.hidden && isActive();
    if (active && !releases.length) {
      releases = [
        studioLive.subscribe('gallery', snapshot => { archiveConnected = snapshot.available === true && Array.isArray(snapshot.data?.jobs); if (archiveConnected) archive = snapshot.data; renderArchive(); }),
        studioLive.subscribe('monitor', snapshot => { telemetryConnected = snapshot.available === true; if (telemetryConnected) generation = snapshot.data?.generation || null; renderGPUs(); }),
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
