import { studioLive } from './live-store.js';
import './metrics.css';

export function mountMetrics({ root, isActive = () => true }) {
const $ = id => root.querySelector('#metrics-' + id);
let enabled = true;
let disposed = false;
let suspended = false;
const alive = () => !disposed && !suspended && enabled && !document.hidden && isActive();
const HOUR = 3600000;
const profiles = ['flux1-dev', 'flux2-dev-nf4'];
const names = { 'flux1-dev': 'FLUX.1 dev', 'flux2-dev-nf4': 'FLUX.2 dev' };
const integer = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const date = value => value === null ? 'Not recorded' : dateFormat.format(value);
const seconds = value => value === null ? 'Not recorded' : `${decimal.format(value)} s`;
const elapsed = value => value === null ? 'Not recorded' : `${decimal.format(value / HOUR)} h`;
const timestamp = value => {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 0 ? value * 1000 : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};
function text(tag, value) {
  const node = document.createElement(tag);
  node.textContent = value;
  return node;
}
function table(id, rows) {
  const body = $(id);
  body.replaceChildren(...rows.map(values => {
    const row = document.createElement('tr');
    values.forEach((value, index) => {
      const cell = text(index === 0 ? 'th' : 'td', value);
      if (index === 0) cell.scope = 'row';
      row.append(cell);
    });
    return row;
  }));
}
function durations(rows) {
  const values = rows.map(row => row.seconds).filter(value => typeof value === 'number' && Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  const middle = Math.floor(values.length / 2);
  return { count: values.length, sum, mean: values.length ? sum / values.length : null, median: values.length ? (values[middle] + values[Math.floor((values.length - 1) / 2)]) / 2 : null, min: values[0] ?? null, max: values.at(-1) ?? null };
}
function render(data, now) {
  const unique = new Map();
  for (const row of data.jobs) {
    if (row && profiles.includes(row.profile) && typeof row.id === 'string' && row.id) unique.set(`${row.profile}:${row.id}`, { ...row, completed: timestamp(row.created) });
  }
  const rows = [...unique.values()];
  const dated = rows.filter(row => row.completed !== null && row.completed <= now);
  const stamps = dated.map(row => row.completed);
  const first = stamps.length ? Math.min(...stamps) : null;
  const latest = stamps.length ? Math.max(...stamps) : null;
  const span = first !== null && latest !== null ? latest - first : null;
  const count = (items, start, end = now) => items.filter(row => row.completed !== null && row.completed > start && row.completed <= end).length;
  const recent = count(dated, now - HOUR);
  const cards = [
    ['Total archived generations', integer.format(rows.length), 'Completed and indexed originals'],
    ['Last hour', integer.format(recent), `${integer.format(recent)} generations per hour over the full last hour`],
    ['Observed completion span', elapsed(span), 'First to latest indexed completion; includes quiet time'],
    ['Observed study rate', span > 0 && stamps.length > 1 ? `${decimal.format((stamps.length - 1) / (span / HOUR))} / h` : 'Not enough data', 'Completion intervals divided by first-to-latest span'],
  ];
  $('overview').replaceChildren(...cards.map(([label, value, detail]) => {
    const card = document.createElement('dl'); card.className = 'card';
    const measure = text('dd', value); measure.append(text('small', detail));
    card.append(text('dt', label), measure); return card;
  }));
  table('models', profiles.map(profile => {
    const items = rows.filter(row => row.profile === profile);
    const times = items.map(row => row.completed).filter(value => value !== null && value <= now);
    const day = count(items, now - 24 * HOUR);
    return [names[profile], integer.format(items.length), integer.format(count(items, now - HOUR)), integer.format(day), `${decimal.format(day / 24)} / h`, date(times.length ? Math.max(...times) : null)];
  }));
  table('timings', profiles.map(profile => {
    const items = rows.filter(row => row.profile === profile); const timing = durations(items);
    return [names[profile], `${timing.count} / ${items.length}`, seconds(timing.mean), seconds(timing.median), seconds(timing.min), seconds(timing.max), timing.count ? elapsed(timing.sum * 1000) : 'Not recorded'];
  }));
  const groups = new Map();
  for (const row of rows) {
    const dimensions = Number.isFinite(row.width) && Number.isFinite(row.height) ? `${row.width} × ${row.height}` : 'Not recorded';
    const steps = Number.isFinite(row.settings?.steps) ? row.settings.steps : 'Not recorded';
    const key = JSON.stringify([row.profile, dimensions, steps]);
    if (!groups.has(key)) groups.set(key, { profile: row.profile, dimensions, steps, rows: [] });
    groups.get(key).rows.push(row);
  }
  table('settings', [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, group]) => {
    const timing = durations(group.rows);
    return [names[group.profile], group.dimensions, group.steps, `${timing.count} / ${group.rows.length}`, seconds(timing.mean), seconds(timing.median)];
  }));
  table('hours', Array.from({ length: 12 }, (_, index) => {
    const end = now - index * HOUR; const start = end - HOUR;
    const totals = profiles.map(profile => count(dated.filter(row => row.profile === profile), start, end));
    return [date(start), date(end), ...totals.map(value => integer.format(value)), integer.format(totals[0] + totals[1])];
  }));
  $('coverage').textContent = `${Number(data.exclusions?.count) || 0} initial setup records omitted; originals retained. First indexed completion: ${date(first)}. Latest: ${date(latest)}. ${rows.length - dated.length} archived records have a missing, invalid or future completion time and are excluded from rates. Duration samples with missing or nonpositive values are excluded from timing statistics.`;
  $('updated').textContent = `Archive updated: ${date(timestamp(data.updatedAt))}. Page checked: ${date(now)}.`;
}
let busy = false;
let refreshRequested = false;
let lastGood = null;
let lastVersion = null;
let controller = null;
async function refresh() {
  if (!alive()) return;
  if (busy) { refreshRequested = true; return; }
  refreshRequested = false;
  busy = true;
  controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const data = await studioLive.read('gallery');
    if (!alive()) return;
    if (data.ok === false || !Array.isArray(data.jobs)) throw new Error('archive_unavailable');
    const version = timestamp(data.updatedAt);
    if (lastVersion !== null && version !== null && version < lastVersion) throw new Error('older_snapshot');
    lastGood = data; lastVersion = version;
    render(data, Date.now());
    $('status').textContent = 'Archive connected. Updates appear automatically.';
  } catch {
    if (alive()) {
      if (lastGood) render(lastGood, Date.now());
      $('status').textContent = lastGood ? 'The archive connection is resting. The last good snapshot is still here.' : 'The archive is not available at the moment. This page will check again.';
    }
  } finally { clearTimeout(timeout); controller = null; busy = false;
    if (refreshRequested && alive()) queueMicrotask(refresh);
  }
}

let timer = null;
let releaseTopic = null;
function stop() {
  if (timer !== null) clearInterval(timer);
  timer = null;
  releaseTopic?.(); releaseTopic = null;
  controller?.abort();
}
function sync() {
  if (!alive()) { stop(); return; }
  if (!releaseTopic) releaseTopic = studioLive.subscribe('gallery', refresh);
  if (timer === null) timer = setInterval(refresh, 15000);
  refresh();
}
const visibility = () => sync();
const pagehide = () => { suspended = true; stop(); };
const pageshow = () => { suspended = false; sync(); };
document.addEventListener('visibilitychange', visibility);
window.addEventListener('pagehide', pagehide);
window.addEventListener('pageshow', pageshow);
const recordUpdate = ({ path }) => {
  if (['/tasks.json', '/monitor-state.json'].includes(path)) refresh();
};
if (import.meta.hot) import.meta.hot.on('artwork-record-update', recordUpdate);
function destroy() {
  if (disposed) return;
  disposed = true;
  stop();
  document.removeEventListener('visibilitychange', visibility);
  window.removeEventListener('pagehide', pagehide);
  window.removeEventListener('pageshow', pageshow);
  if (import.meta.hot) import.meta.hot.off('artwork-record-update', recordUpdate);
}
sync();
return { refresh, destroy, setActive(value) { enabled = Boolean(value); sync(); } };
}
