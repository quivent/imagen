import { studioLive } from './live-store.js';
import { freshObservation, observedTime } from './agent-state.js';

const known = [
  { id: 'flux1', aliases: ['flux1-dev', 'flux1'], name: 'FLUX.1 dev' },
  { id: 'flux2', aliases: ['flux2-dev-nf4', 'flux2-dev', 'flux2'], name: 'FLUX.2 DEV', note: 'DEV base model · NF4 text encoder' },
  { id: 'pixtral', aliases: ['pixtral-critic', 'pixtral'], name: 'Pixtral 12B W4A16' },
  { id: 'dinov2', aliases: ['dinov2-giant', 'dinov2', 'dino'], name: 'DINOv2 Giant' },
];
const readable = value => typeof value === 'string' && value.trim() ? value : 'Not recorded';
const phaseNames = { loading: 'Loading', active: 'Active', running: 'Active', loaded: 'Loaded', blocked: 'Blocked', failed: 'Blocked', stopped: 'Stopped', downloaded: 'Downloaded', ready: 'Ready', missing: 'Missing' };

// Download receipts never establish residency. Fresh source evidence is required
// for every current phase, including when a cached snapshot remains on screen.
export function modelState(item, section, connected, now = Date.now()) {
  const fresh = connected && section?.ok !== false && freshObservation(section?.observedAt, now)
    && (item.observedAt == null || freshObservation(item.observedAt, now));
  if (!fresh) return { fresh: false, label: 'Unknown', state: 'unknown', downloaded: 'Unknown', loaded: 'Unknown' };
  const phase = typeof item.phase === 'string' ? item.phase.toLowerCase() : '';
  const state = item.problem || ['blocked', 'failed'].includes(phase) ? 'blocked' : phase === 'loading' ? 'loading'
    : item.loaded === true ? (['active', 'running'].includes(phase) ? 'active' : 'loaded')
      : item.downloaded === true ? 'downloaded' : 'unknown';
  return { fresh: true, state, label: phase === 'loading' || item.problem || ['blocked', 'failed'].includes(phase)
    ? phaseNames[state] : item.loaded === true ? phaseNames[state] : item.loaded === false ? phaseNames[phase] || 'Not loaded' : item.downloaded === true ? 'Downloaded' : 'Unknown',
  downloaded: item.downloaded === true ? 'Verified' : item.downloaded === false ? 'Not verified' : 'Unknown',
  loaded: item.loaded === true ? 'Loaded' : item.loaded === false ? 'Not loaded' : 'Unknown' };
}

export function mountModels({ root, isActive = () => true }) {
  const $ = id => root.querySelector('#models-' + id);
  let section = null;
  let connected = false;
  let enabled = false;
  let disposed = false;
  let release = null;
  let timer = null;
  const text = (tag, value, className) => {
    const node = document.createElement(tag); node.textContent = value;
    if (className) node.className = className;
    return node;
  };
  const stamp = value => observedTime(value) === null ? 'Not observed' : new Date(observedTime(value)).toLocaleString();
  function card(item) {
    const state = modelState(item, section, connected);
    const entry = known.find(model => model.aliases.includes(item.id));
    const node = text('article', '', 'models-card');
    const heading = text('div', '', 'models-card-heading');
    const badge = text('span', state.label, 'models-state'); badge.dataset.state = state.state;
    heading.append(text('h2', entry?.name || readable(item.name)), badge);
    node.append(heading);
    if (entry?.note) node.append(text('p', entry.note, 'models-source'));
    const dl = text('dl', '', 'models-measures');
    const precision = item.precision && typeof item.precision === 'object'
      ? Object.entries(item.precision).map(([component, value]) => `${component}: ${readable(value)}`).join('\n') : readable(item.precision);
    const bytes = typeof item.bytes === 'number' && Number.isFinite(item.bytes) && item.bytes >= 0
      ? `${(item.bytes / 1e9).toLocaleString(undefined, { maximumFractionDigits: 2 })} GB · ${item.bytes.toLocaleString()} bytes` : 'Not recorded';
    const gpu = state.fresh && Number.isInteger(item.gpuIndex) && item.gpuIndex >= 0 ? `GPU ${item.gpuIndex}` : 'Unknown';
    const fields = [['Repository', readable(item.repo)], ['Pinned revision', readable(item.revision), 'models-revision'],
      ['Precision', precision, 'models-components'], ['Disk size', bytes + (state.fresh ? '' : ' · last recorded')],
      ['Download', state.downloaded], ['GPU residency', state.loaded], ['GPU / lane', gpu],
      ['Health', !state.fresh ? 'Unknown · source unavailable or stale' : state.state === 'blocked' ? 'Needs attention' : item.loaded === true ? 'Resident worker observed' : 'No resident worker confirmed'],
      ['Observed', stamp(item.observedAt ?? section?.observedAt)]];
    // The encoder is independently pinned and must be visible beside DEV weights.
    if (entry?.id === 'flux2') fields.splice(2, 0,
      ['Text encoder', 'diffusers/FLUX.2-dev-bnb-4bit · NF4'],
      ['Encoder revision', 'c30ad107542e63f222f864a8de510204394fb18a', 'models-revision']);
    for (const [label, value, className] of fields) {
      const pair = text('div', ''); pair.append(text('dt', label), text('dd', value, className)); dl.append(pair);
    }
    node.append(dl);
    if (state.fresh && item.problem) node.append(text('p', 'Reported blocker: ' + readable(item.problem), 'models-problem'));
    return node;
  }
  function render() {
    const fresh = connected && section?.ok !== false && freshObservation(section?.observedAt);
    $('connection').textContent = fresh ? 'Live inventory' : connected ? 'Unknown · source stale or unavailable' : 'Disconnected';
    $('connection').dataset.state = fresh ? 'loaded' : 'unknown';
    const items = Array.isArray(section?.items) ? section.items.filter(item => item && typeof item.id === 'string') : [];
    const rows = [...items];
    for (const model of known) if (!items.some(item => model.aliases.includes(item.id))) rows.push({ id: model.id, name: model.name });
    $('list').replaceChildren(...rows.map(card));
    $('observed').textContent = `Inventory observed ${stamp(section?.observedAt)}. ${fresh ? 'Current state expires after 12 seconds without a fresh observation.' : 'Current download and residency state is unknown until fresh evidence arrives.'}`;
  }
  function sync() {
    const active = !disposed && enabled && !document.hidden && isActive();
    if (active && !release) {
      release = studioLive.subscribe('monitor', snapshot => {
        connected = snapshot.available === true;
        if (connected) section = snapshot.data?.models || snapshot.data?.generation?.models || null;
        render();
      });
      timer = setInterval(render, 1000);
    } else if (!active && release) {
      release(); release = null; clearInterval(timer); timer = null; connected = false;
    }
    if (active) render();
  }
  document.addEventListener('visibilitychange', sync);
  return { setActive(value) { enabled = value; sync(); }, destroy() { disposed = true; sync(); document.removeEventListener('visibilitychange', sync); } };
}
