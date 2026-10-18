import { mountWorkspaceNavigation } from './workspace-navigation.js';
import { studioTabs, studioTab, studioTabURL } from './studio-route.js';
import { createGenerationSteps } from './generation-steps.js';
import { mountModelStepButtons } from './model-step-buttons.js';
import { modelRequest } from './model-parameters.js';
import { mountStreamPagination } from './stream-pagination.js';
import { mountPublicNavigation } from './public-navigation.js';
import { agentView, taskAssignment } from './agent-state.js';
import { sitePerformance } from './site-performance.js';
import { reconcileComparisonOptions } from './comparison-options.js';
import { studioLive } from './live-store.js';
import { installImageCache, artworkImageURL } from './image-cache.js';
'use strict';
installImageCache();
const $ = (id) => document.getElementById(id);
// Fragments never reach the server. Remove the access key before any request.
let bootstrapControlToken = new URLSearchParams(location.hash.slice(1)).get('control');
if (bootstrapControlToken !== null) {
  const cleanURL = new URL(location.href);
  cleanURL.hash = '';
  history.replaceState(null, '', studioTabURL(cleanURL, 'controls'));
}
const state = { rows: [], id: new URLSearchParams(location.search).get('comparison'), swapped: false, signature: '', loading: false, loaded: false, renderedId: null };
const text = (tag, value, className) => {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
};
const current = () => state.rows.find((row) => row.id === state.id);
const available = (value) => value !== null && value !== undefined && value !== '';
function imagePath(value) {
  if (typeof value !== 'string' || !/^data\/[a-zA-Z0-9_./-]+$/.test(value)) return null;
  if (value.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  return value;
}
function modelCard(side, fallback, row) {
  const card = document.createElement('figure');
  card.className = 'image-card';
  const path = artworkImageURL(imagePath(side?.image), side?.imageSha256);
  const model = side?.model || fallback;
  const area = document.createElement(path ? 'button' : 'div');
  area.className = 'image-area';
  if (path) {
    area.type = 'button';
    area.setAttribute('aria-label', `View ${row.title}, ${model}, at a larger size`);
    const img = document.createElement('img');
    img.alt = `${row.title} — ${model}`;
    img.src = path;
    img.decoding = 'async';
    img.loading = 'lazy';
    if (Number.isFinite(side?.width) && Number.isFinite(side?.height)) { img.width = side.width; img.height = side.height; }
    img.addEventListener('error', () => {
      area.replaceChildren(text('span', 'Image not available yet', 'pending'));
      area.disabled = true;
    }, { once: true });
    area.append(img);
    area.addEventListener('click', () => {
      $('viewer-title').textContent = `${row.title} · ${model}`;
      $('viewer-image').alt = img.alt;
      $('viewer-image').src = path;
      $('viewer').showModal();
      $('close-viewer').focus();
    });
  } else {
    area.append(text('span', 'Room for this image', 'pending'));
  }
  const caption = document.createElement('figcaption');
  caption.className = 'image-meta';
  const identity = document.createElement('div');
  identity.append(text('p', model, 'model-name'), text('p', side?.precision || 'Precision not recorded', 'precision'));
  const hasTime = Number.isFinite(side?.seconds) && side.seconds >= 0;
  const timing = text('div', hasTime ? `${side.seconds.toLocaleString(undefined, { maximumFractionDigits: 1 })} s` : '—', 'timing');
  timing.append(text('small', hasTime ? 'generation' : 'time not recorded'));
  caption.append(identity, timing);
  card.append(area, caption);
  return card;
}
function detailPanel(side, fallback, row) {
  const panel = document.createElement('div');
  panel.className = 'detail-panel';
  panel.append(text('h3', side?.model || fallback));
  const dl = document.createElement('dl');
  const fields = {
    Model: side?.model,
    Precision: side?.precision,
    Seed: side?.seed,
    Steps: side?.steps,
    Dimensions: side?.width && side?.height ? `${side.width} × ${side.height}` : null,
    'Generation time': Number.isFinite(side?.seconds) ? `${side.seconds} seconds` : null,
    Revision: side?.revision,
  };
  for (const [key, value] of Object.entries(side?.settings || {})) {
    fields[key] = typeof value === 'object' ? JSON.stringify(value) : value;
  }
  if (side?.prompt && side.prompt !== row.prompt) fields['Individual prompt'] = side.prompt;
  for (const [key, value] of Object.entries(fields)) {
    dl.append(text('dt', key), text('dd', available(value) ? String(value) : 'Not recorded'));
  }
  panel.append(dl);
  return panel;
}
const comparisonCards = new Map();
let winnerRecord = { revisions: {}, winners: [] };
const pendingWinnerChoices = new Map();
function updateChoiceCard(card, id) {
  const chosen = winnerRecord.winners.find(winner => winner.comparisonId === id)?.side;
  for (const button of card.querySelectorAll('[data-choice]')) {
    const selected = button.dataset.choice === chosen;
    button.setAttribute('aria-pressed', String(selected));
    const label = `${selected ? 'Clear rating for' : 'Prefer'} ${button.dataset.ratingLabel}`;
    button.setAttribute('aria-label', label);
    button.title = label;
  }
}
async function keepWinner(row, side, controls, note) {
  const buttons = [...controls.querySelectorAll('[data-choice]')]; buttons.forEach(button => { button.disabled = true; });
  note.textContent = 'Saving rating…';
  const previous = pendingWinnerChoices.get(row.id);
  const payload = previous?.side === side ? previous : { requestId: crypto.randomUUID(), comparisonId: row.id, side, expectedRevision: winnerRecord.revisions[row.id] || 0 };
  pendingWinnerChoices.set(row.id, payload);
  try {
    const result = await fetch('/api/studio-winners', { method: 'POST', signal: AbortSignal.timeout(20000), credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await result.json();
    if (result.ok || result.status < 500) pendingWinnerChoices.delete(row.id);
    if (data.record) { winnerRecord = data.record; for (const [id, entry] of comparisonCards) updateChoiceCard(entry.card, id); }
    if (result.status === 403) note.textContent = 'The studio connection is unavailable. Your choice was not saved.';
    else if (result.status === 409) note.textContent = 'The choice changed in another view. Your current choice is shown; choose again whenever you are ready.';
    else if (!result.ok || !data.ok) note.textContent = 'The choice could not be confirmed. Please try again.';
    else note.textContent = side === null ? 'Rating cleared.' : 'Rating saved.';
  } catch { note.textContent = 'The choice could not be confirmed. Please try again.'; }
  finally { buttons.forEach(button => { button.disabled = !imagePath(row[button.dataset.choice]?.image); }); }
}
function createComparisonCard(row) {
  const card = document.createElement('article');
  card.className = 'comparison-tile'; card.dataset.comparison = row.id;
  const heading = text('h2', row.title);
  const pair = document.createElement('div'); pair.className = 'comparison-tile-pair';
  pair.append(modelCard(row.left, 'FLUX.1 dev', row), modelCard(row.right, 'FLUX.2 dev', row));
  const open = text('button', 'Details and observations', 'comparison-open'); open.type = 'button';
  open.setAttribute('aria-label', `Details and observations for ${row.title}`);
  open.setAttribute('aria-controls', 'comparison-inspector');
  open.addEventListener('click', () => {
    choose(row.id); $('comparison-inspector').open = true;
    $('comparison-inspector').scrollIntoView({ block: 'start', behavior: 'instant' });
    $('comparison-inspector').querySelector('summary').focus();
  });
  const note = text('p', '', 'comparison-choice-status'); note.setAttribute('role', 'status');
  for (const [index, side] of ['left', 'right'].entries()) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'comparison-rate'; button.dataset.choice = side;
    button.dataset.ratingLabel = `${row[side]?.model || (side === 'left' ? 'FLUX.1 dev' : 'FLUX.2 dev')} for ${row.title}`;
    button.innerHTML = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v11H3V10zm0 0 5-8c3 0 3 3 2 7h5a2 2 0 0 1 2 2l-1 8a2 2 0 0 1-2 2H7"/></svg>';
    button.disabled = !imagePath(row[side]?.image); button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      const chosen = winnerRecord.winners.find(winner => winner.comparisonId === row.id)?.side;
      keepWinner(row, chosen === side ? null : side, pair, note);
    });
    pair.children[index].append(button);
  }
  card.append(heading, pair, note, open); updateChoiceCard(card, row.id); return card;
}
function renderComparisonGrid() {
  if (!state.loaded || activeTab !== 'gallery') return;
  const grid = $('comparison-grid');
  grid.setAttribute('aria-busy', 'false');
  // Keep the keyboard user's exact node until focus moves out of the gallery.
  if (grid.contains(document.activeElement)) return;
  const ids = new Set(state.rows.map(row => row.id));
  for (const [id, entry] of comparisonCards) {
    if (!ids.has(id)) { entry.card.remove(); comparisonCards.delete(id); }
  }
  state.rows.forEach((row, index) => {
    const signature = JSON.stringify(row);
    let entry = comparisonCards.get(row.id);
    if (!entry || entry.signature !== signature) {
      const card = createComparisonCard(row);
      if (entry) entry.card.replaceWith(card);
      entry = { card, signature }; comparisonCards.set(row.id, entry);
    }
    if (grid.children[index] !== entry.card) grid.insertBefore(entry.card, grid.children[index] || null);
    entry.card.classList.toggle('selected-comparison', row.id === state.id);
  });
  for (const node of [...grid.children]) if (!ids.has(node.dataset.comparison)) node.remove();
}
$('comparison-grid').addEventListener('focusout', () => queueMicrotask(renderComparisonGrid));
function render() {
  // Construct comparison images only when Compare is visible.
  if (activeTab !== 'gallery') return;
  const row = current();
  $('empty').hidden = !state.loaded || !!row;
  $('comparison').hidden = !row;
  $('comparison-inspector').hidden = !row;
  renderComparisonGrid();
  $('scene').disabled = !state.rows.length;
  reconcileComparisonOptions($('scene'), state.rows);
  if (!row) return;
  $('scene').value = row.id;
  const index = state.rows.indexOf(row);
  $('position').textContent = `${String(index + 1).padStart(2, '0')} / ${String(state.rows.length).padStart(2, '0')}`;
  $('scene-title').textContent = row.title;
  $('previous').disabled = index === 0;
  $('next').disabled = index === state.rows.length - 1;
  const sides = [[row.left, 'FLUX.1 dev'], [row.right, 'FLUX.2 dev']];
  if (state.swapped) sides.reverse();
  const signature = JSON.stringify([row, state.swapped]);
  if (signature !== state.renderedSignature) {
    $('pair').classList.toggle('square-pair', sides.every(([side]) => side?.width && side.width === side.height));
    $('pair').replaceChildren(...sides.map(([side, fallback]) => modelCard(side, fallback, row)));
    $('details').replaceChildren(...sides.map(([side, fallback]) => detailPanel(side, fallback, row)));
    $('prompt').textContent = row.prompt || 'The prompt has not been recorded yet.';
    const promptsDiffer = [row.left, row.right].some((side) => side?.prompt && side.prompt !== row.prompt);
    $('prompt-heading').textContent = promptsDiffer ? 'The starting brief' : 'A shared prompt';
    state.renderedSignature = signature;
  }
  if (state.renderedId !== row.id) {
    try {
      $('note').value = localStorage.getItem(`artwork-comparison:note:${row.id}`) || '';
      $('note-status').textContent = '';
    } catch {
      $('note').value = '';
      $('note-status').textContent = 'Browser storage is unavailable. Copy any observations you want to keep.';
    }
  }
  state.renderedId = row.id;
}
function choose(id) {
  state.id = id;
  state.swapped = false;
  const url = new URL(location.href);
  url.searchParams.set('comparison', id);
  history.replaceState(null, '', url);
  render();
}
async function refresh(manual = false) {
  if (state.loading || !manual && (document.hidden || $('viewer').open)) return;
  state.loading = true;
  try {
    const payload = await studioLive.read('comparisons');
    if (payload.schemaVersion !== 1 || !Array.isArray(payload.comparisons)) throw new Error('Unreadable collection');
    const ids = new Set();
    const rows = payload.comparisons.filter((row) => {
      if (!row || typeof row.id !== 'string' || !row.id || typeof row.title !== 'string' || ids.has(row.id)) return false;
      ids.add(row.id);
      return true;
    }).reverse();
    const signature = JSON.stringify(rows);
    state.loaded = true;
    if (signature !== state.signature) {
      state.rows = rows;
      state.signature = signature;
      if (!current()) state.id = rows[0]?.id || null;
      render();
      if (new URLSearchParams(location.search).has('comparison')) $('comparison-inspector').open = true;
      renderSceneChoices();
    }
    $('comparison-grid').setAttribute('aria-busy', 'false');
    $('status').textContent = manual ? (rows.length ? 'The collection is up to date.' : 'Ready for the first images.') : '';
  } catch {
    $('comparison-grid').setAttribute('aria-busy', 'false');
    if (manual || !state.rows.length) $('status').textContent = 'The collection is not available at the moment. Your current view stays here while the collection reconnects.';
  } finally {
    state.loading = false;
  }
}
$('scene').addEventListener('change', (event) => choose(event.target.value));
$('previous').addEventListener('click', () => choose(state.rows[state.rows.indexOf(current()) - 1].id));
$('next').addEventListener('click', () => choose(state.rows[state.rows.indexOf(current()) + 1].id));
$('swap').addEventListener('click', () => { state.swapped = !state.swapped; render(); });
$('note').addEventListener('input', () => {
  try {
    localStorage.setItem(`artwork-comparison:note:${state.id}`, $('note').value);
    $('note-status').textContent = 'Saved in this browser.';
  } catch {
    $('note-status').textContent = 'This browser could not save your observations. Copy them somewhere you can keep them.';
  }
});
$('close-viewer').addEventListener('click', () => $('viewer').close());
$('viewer').addEventListener('close', () => $('viewer-image').removeAttribute('src'));
document.addEventListener('visibilitychange', () => { if (!document.hidden) { if(['gallery','controls'].includes(activeTab))refresh(); if (activeTab === 'controls') refreshControls(); if (activeTab === 'stream') refreshStream(); if (activeTab === 'tasks') refreshTasks(); } });


const profiles = ['flux1-dev', 'flux2-dev-nf4'];
const modelNames = { 'flux1-dev': 'FLUX.1 dev', 'flux2-dev-nf4': 'FLUX.2 dev' };
const controlFields = ['profile', 'prompt', 'width', 'height', 'steps', 'guidance_scale', 'seed', 'max_sequence_length', 'count'];
const controls = { authorized: false, connected: false, fetching: false, posting: false, workers: [], jobs: [], pendingLanes: new Set(), gpus: [] };
let activeTab = 'stream';
const tabNames = studioTabs;
sitePerformance.registerTabs(tabNames);
let publicNavigation;
let workspaceNavigation;
const embeddedPanels = {};
const liveTopics = new Map();
function syncLiveTopics() {
  const wanted = new Set(({ stream: ['gallery-recent'], gallery: ['comparisons','controls','winners'], tasks: ['tasks', 'monitor'], controls: ['controls', 'agents','comparisons'] }[activeTab] || []));
  const refreshers = { comparisons: refresh, 'gallery-recent': refreshStream, tasks: refreshTasks, controls: refreshControls, agents: refreshAgentSnapshot };
  for (const [topic, stop] of liveTopics) if (!wanted.has(topic)) { stop(); liveTopics.delete(topic); }
  for (const topic of wanted) if (!liveTopics.has(topic)) liveTopics.set(topic, studioLive.subscribe(topic, observation => topic === 'monitor' ? updateTaskRuntime(observation) : topic==='winners'?updateWinnerChoices(observation):refreshers[topic]()));
}

let jobSignature = '';
let pendingControlRequest = null;
try {
  const saved = JSON.parse(sessionStorage.getItem('artwork-comparison:pending-request') || 'null');
  if (saved && typeof saved.requestId === 'string' && typeof saved.payloadJSON === 'string') pendingControlRequest = saved;
} catch { /* The current page can still retain an unconfirmed request. */ }
function retainPendingRequest(value) {
  pendingControlRequest = value;
  try {
    if (value) sessionStorage.setItem('artwork-comparison:pending-request', JSON.stringify(value));
    else sessionStorage.removeItem('artwork-comparison:pending-request');
  } catch { /* Keep the request ID in memory if browser storage is unavailable. */ }
}

function showTab(tab, focus = false, load = true) {
  const finishTiming = sitePerformance.beginTab(tab);
  activeTab = tab;
  syncLiveTopics();
  for (const name of tabNames) {
    const selected = name === tab;
    $(`tab-${name}`).setAttribute('aria-selected', String(selected));
    $(`tab-${name}`).tabIndex = selected ? 0 : -1;
    $(`${name}-panel`).hidden = !selected;
  }
  const url = studioTabURL(location.href, tab);
  history.replaceState(null, '', url);
  for (const [name, panel] of Object.entries(embeddedPanels)) panel.setActive(name === tab);
  publicNavigation?.update();
  workspaceNavigation?.onTab(tab);
  if (tab === 'gallery') render();
  if (focus) $(`tab-${tab}`).focus();
  if (load && tab === 'controls') refreshControls();
  if (load && tab === 'stream') refreshStream();
  if (load && tab === 'tasks') refreshTasks();
  syncTaskRuntimeClock(tab === 'tasks');
  finishTiming();
}
for (const name of tabNames) {
  $(`tab-${name}`).addEventListener('click', () => showTab(name));
  $(`tab-${name}`).addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const visibleTabs = tabNames.filter(tab => $(`tab-${tab}`).getClientRects().length > 0);
    const index = visibleTabs.indexOf(name);
    const target = event.key === 'Home' ? visibleTabs[0] : event.key === 'End' ? visibleTabs.at(-1) : visibleTabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + visibleTabs.length) % visibleTabs.length];
    showTab(target, true);
  });
}

const taskStates = { working: 'In progress', next: 'Next', ongoing: 'Ongoing', done: 'Done' };
let tasksLoading = false;
let tasksSignature = '';
let taskRows = [];
let taskMonitorSnapshot = null;
let taskRuntimeConnected = false;
let taskRuntimeTimer = null;
let taskRuntimeFresh = false;
function updateTaskRuntime(observation) {
  taskRuntimeConnected = observation.available === true;
  if (taskRuntimeConnected) taskMonitorSnapshot = observation.data;
  taskRuntimeFresh = agentView(taskMonitorSnapshot, taskRuntimeConnected).fresh;
  if (activeTab === 'tasks') renderTasks(taskRows);
}
function syncTaskRuntimeClock(active) {
  clearInterval(taskRuntimeTimer); taskRuntimeTimer = null;
  if (active) taskRuntimeTimer = setInterval(() => {
    const fresh = agentView(taskMonitorSnapshot, taskRuntimeConnected).fresh;
    if (fresh !== taskRuntimeFresh) { taskRuntimeFresh = fresh; renderTasks(taskRows); }
  }, 1000);
}
function renderTasks(rows) {
  taskRows = rows;
  const runtime = agentView(taskMonitorSnapshot, taskRuntimeConnected);
  const doneOpen = $('tasks-list').querySelector('.task-group-done')?.open || false;
  const sections = [];
  for (const [state, heading] of Object.entries(taskStates)) {
    const priorityRank = { urgent: 0, high: 1 };
    const matching = rows.filter(row => row.status === state).sort((a, b) => (priorityRank[a.priority] ?? 2) - (priorityRank[b.priority] ?? 2));
    if (!matching.length) continue;
    const section = document.createElement(state === 'done' ? 'details' : 'section');
    section.className = state === 'done' ? 'task-group task-group-done' : 'task-group';
    const title = text('h2', state === 'working' ? 'Recorded in progress' : heading);
    if (state === 'done') {
      section.open = doneOpen;
      const summary = document.createElement('summary');
      const icon = text('span', '›', 'task-done-icon');
      icon.setAttribute('aria-hidden', 'true');
      summary.append(icon, title, text('span', String(matching.length), 'task-done-count'));
      section.append(summary);
    } else section.append(title);
    const list = document.createElement('div');
    list.className = 'task-cards';
    for (const row of matching) {
      const card = document.createElement('article');
      card.className = 'task-card';
      card.dataset.state = state;
      const top = document.createElement('div');
      top.className = 'task-card-top';
      top.append(text('span', row.id, 'task-id'));
      if (row.priority) top.append(text('span', row.priority === 'urgent' ? 'First priority' : 'High priority', 'task-priority'));
      const assignment = taskAssignment(runtime, row);
      top.append(text('span', state === 'working' ? assignment ? 'Running' : 'Recorded in progress' : heading, 'task-state'));
      card.append(top, text('h3', row.title));
      if (row.owner || assignment || state === 'working') card.append(text('p', assignment ? `Current assignment: ${assignment.name || assignment.id}` : `Recorded owner: ${row.owner || 'not recorded'} · ${runtime.fresh ? 'no matching running assignment' : 'live assignment unknown'}`, 'task-detail'));
      if (row.difficulty || row.estimatedMinutes) {
        const range = row.estimatedMinutes;
        const estimate = range && Number.isFinite(range.min) && Number.isFinite(range.max) ? `${range.min}–${range.max} min estimated` : '';
        card.append(text('p', [row.difficulty, estimate, row.estimateConfidence && `${row.estimateConfidence} confidence`].filter(Boolean).join(' · '), 'task-detail'));
      }
      if (row.detail) card.append(text('p', row.detail, 'task-detail'));
      if (row.evidence) card.append(text('p', row.evidence, 'task-evidence'));
      list.append(card);
    }
    section.append(list);
    sections.push(section);
  }
  $('tasks-list').replaceChildren(...sections);
}
async function refreshTasks(manual = false) {
  if (tasksLoading || !manual && (document.hidden || activeTab !== 'tasks')) return;
  tasksLoading = true;
  try {
    const payload = await studioLive.read('tasks');
    if (payload.schemaVersion !== 1 || !Array.isArray(payload.tasks)) throw new Error('Task record unreadable');
    const ids = new Set();
    const rows = payload.tasks.filter(row => {
      if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id) || typeof row.title !== 'string' || !row.title || !taskStates[row.status]) return false;
      ids.add(row.id);
      return true;
    });
    const signature = JSON.stringify(rows);
    if (signature !== tasksSignature) { renderTasks(rows); tasksSignature = signature; }
    const updated = new Date(payload.updatedAt);
    $('tasks-updated').textContent = `Project record · ${Number.isNaN(updated.valueOf()) ? 'date not recorded' : updated.toLocaleString()} · live project record`;
    $('tasks-status').textContent = manual ? 'The task record is up to date.' : '';
  } catch {
    $('tasks-status').textContent = 'The task record is not available at the moment. The last loaded list remains here.';
  } finally { tasksLoading = false; }
}

function setAuthorized(value) {
  controls.authorized = value === true;
  $('control-workspace').hidden = false;
  for (const element of document.querySelectorAll('[data-private-control]')) element.hidden = !controls.authorized;
  $('generate-submit').disabled = !controls.authorized || !controls.connected || controls.posting;
  $('generate-both').disabled = $('generate-submit').disabled;
  if (!controls.authorized || !controls.connected) for (const profile of profiles) $(`pause-${profile}`).disabled = true;
  $('compare-generate-both').disabled = controls.posting;
  $('compare-generate-both').textContent = `Run both · ${profiles.reduce((sum, profile) => sum + modelParameters[profile].count, 0)} images`;
}
class ControlResponseProblem extends Error {
  constructor(status) { super('Control request did not complete'); this.status = status; }
}
async function controlRequest(path, payload) {
  if (path === 'state' && payload === undefined) {
    try { return await studioLive.read('controls'); }
    catch (issue) { if ([401, 403].includes(issue.status)) setAuthorized(false); throw new ControlResponseProblem(issue.status || 503); }
  }
  const response = await fetch(`/api/control/${path}`, {
    method: payload === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: payload === undefined ? {} : { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    if ([401, 403].includes(response.status)) setAuthorized(false);
    throw new ControlResponseProblem(response.status);
  }
  return response.json();
}
function formatSeconds(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `${value.toFixed(2)} s` : null;
}
function phaseLabel(value) {
  const labels = { ready: 'Ready', loading: 'Loading model', starting: 'Starting', running: 'Generating', generating: 'Generating', queued: 'Queued', done: 'Finished', generated: 'Finished', complete: 'Finished', completed: 'Finished', paused: 'Paused', idle: 'Ready', failed: 'Needs attention', error: 'Needs attention', uncertain: 'Awaiting reconciliation', cancelled: 'Cancelled', submitted: 'Queued' };
  return labels[value] || (typeof value === 'string' && value.length < 80 ? value : 'Not recorded');
}
function addMeasure(dl, key, value) {
  if (available(value)) dl.append(text('dt', key), text('dd', String(value)));
}
function renderWorkers() {
  for (const profile of profiles) {
    const worker = controls.workers.find((item) => item.profile === profile);
    const pause = $(`pause-${profile}`);
    pause.disabled = !controls.authorized || !controls.connected || !worker || controls.pendingLanes.has(profile);
    if (!worker) {
      $(`phase-${profile}`).textContent = 'Not connected yet';
      $(`current-${profile}`).textContent = 'Current work will appear here.';
      $(`measures-${profile}`).replaceChildren();
      continue;
    }
    const currentJob = typeof worker.current === 'object' && worker.current ? worker.current : controls.jobs.find((job) => job.id === worker.current || job.id === worker.running || job.profile === profile && ['running', 'generating'].includes(job.status));
    const currentId = currentJob?.id || (typeof worker.current === 'string' ? worker.current : null);
    $(`phase-${profile}`).textContent = worker.paused ? (currentId ? 'Paused · finishing image' : 'Paused') : currentId ? 'Generating' : phaseLabel(worker.phase);
    const progress = Number.isFinite(currentJob?.step) && Number.isFinite(currentJob?.total_steps) ? ` · step ${currentJob.step} of ${currentJob.total_steps}` : '';
    $(`current-${profile}`).textContent = currentId ? `Current image · ${currentId}${progress}` : worker.paused ? 'Queued images are held here until you resume.' : typeof worker.problem === 'string' && worker.problem ? worker.problem.slice(0, 400) : worker.phase === 'loading' ? 'Preparing the model.' : 'No image is running.';
    const dl = document.createElement('dl');
    addMeasure(dl, 'Waiting', Number.isFinite(worker.queued) ? worker.queued : Array.isArray(worker.queued) ? worker.queued.length : null);
    const gpu = typeof worker.gpu === 'object' && worker.gpu ? worker.gpu : controls.gpus.find((item) => Number(item.index) === profiles.indexOf(profile)) || {};
    addMeasure(dl, 'GPU', typeof worker.gpu === 'string' ? worker.gpu : gpu.name || worker.gpu_name);
    const utilization = gpu.utilization_percent ?? worker.gpu_utilization_percent;
    addMeasure(dl, 'GPU use', Number.isFinite(utilization) ? `${utilization}%` : null);
    const memory = gpu.memory_used_mb ?? worker.memory_used_mb;
    addMeasure(dl, 'GPU memory', Number.isFinite(memory) ? `${(memory / 1024).toFixed(1)} GiB` : null);
    const latestCompleted = controls.jobs.filter((job) => job.profile === profile && Number.isFinite(job.seconds)).sort((a, b) => Number(b.finished || 0) - Number(a.finished || 0))[0];
    addMeasure(dl, 'Last generation', formatSeconds(worker.last_generation_seconds ?? worker.timings?.generation_seconds ?? latestCompleted?.seconds));
    addMeasure(dl, 'Model load', formatSeconds(worker.load_seconds ?? worker.timings?.load_seconds));
    addMeasure(dl, 'Current elapsed', formatSeconds(currentJob?.elapsed_seconds ?? worker.elapsed_seconds));
    $(`measures-${profile}`).replaceChildren(...dl.childNodes);
    pause.textContent = controls.pendingLanes.has(profile) ? 'Updating…' : worker.paused ? 'Resume queue' : 'Pause queue';
    if ($(`pause-note-${profile}`)) $(`pause-note-${profile}`).textContent = worker.paused ? 'Queued images are held.' : 'Finishes the current image first.';
    pause.setAttribute('aria-label', `${worker.paused ? 'Resume queued images for' : 'Pause future images for'} ${modelNames[profile]}`);
  }
}
function renderJobs() {
  const jobs = controls.jobs.slice(0, 12);
  $('recent-work-count').textContent = `${controls.jobs.length} recorded`;
  const signature = JSON.stringify(jobs);
  if (signature === jobSignature) return;
  jobSignature = signature;
  const cards = jobs.map((job) => {
    const card = document.createElement('article');
    card.className = 'control-job';
    const top = document.createElement('div');
    top.className = 'job-top';
    top.append(text('h3', modelNames[job.profile] || job.profile || 'Generation', 'job-model'), text('p', phaseLabel(job.status || job.phase), 'job-phase'));
    card.append(top, text('p', job.id || 'Image request', 'job-identity'));
    const request = { ...job, ...(job.spec || {}), ...(job.request || {}), ...(job.settings || {}) };
    const parts = [];
    if (request.width && request.height) parts.push(`${request.width} × ${request.height}`);
    if (available(request.steps)) parts.push(`${request.steps} steps`);
    if (available(request.seed)) parts.push(`seed ${request.seed}`);
    if (available(job.completed) && available(job.count)) parts.push(`${job.completed} of ${job.count} images`);
    const seconds = formatSeconds(job.generation_seconds ?? job.seconds ?? job.result?.generation_seconds ?? job.result?.generation?.generation_seconds);
    if (seconds) parts.push(`${seconds} generation`);
    const elapsed = formatSeconds(job.elapsed_seconds);
    if (elapsed && ['running', 'generating'].includes(job.status || job.phase)) parts.push(`${elapsed} elapsed`);
    if (parts.length) card.append(text('p', parts.join(' · '), 'job-summary'));
    if (typeof request.prompt === 'string') card.append(text('p', request.prompt, 'job-prompt'));
    if (typeof job.problem === 'string' && job.problem) card.append(text('p', job.problem.slice(0, 500), 'job-summary'));
    return card;
  });
  $('control-jobs').replaceChildren(...(cards.length ? cards : [text('p', 'Your queued images will appear here.', 'history-empty')]));
}
async function refreshControls(manual = false) {
  if (controls.fetching || !manual && (document.hidden || !['controls', 'gallery'].includes(activeTab))) return;
  controls.fetching = true;
  try {
    const payload = await controlRequest('state');
    controls.connected = true;
    setAuthorized(payload.authorized === true || payload.authorized === undefined && payload.ok === true);
    controls.workers = Array.isArray(payload.workers) ? payload.workers : [];
    controls.jobs = Array.isArray(payload.jobs) ? payload.jobs.slice().sort((a, b) => Number(b.created || 0) - Number(a.created || 0)) : [];
    controls.gpus = Array.isArray(payload.gpus) ? payload.gpus : [];
    $('control-connection').textContent = controls.authorized ? 'Connected to the studio' : 'Private controls';
    if (controls.authorized) { renderWorkers(); renderJobs(); }
    if (pendingControlRequest) {
      try {
        const pending = JSON.parse(pendingControlRequest.payloadJSON);
        const expected = Array.isArray(pending) ? pending.map(request => `${pendingControlRequest.requestId}-${request.profile === 'flux1-dev' ? 'f1' : 'f2'}`) : [pendingControlRequest.requestId];
        if (expected.every(id => controls.jobs.some(job => (job.requestId || job.request_id) === id))) retainPendingRequest(null);
      } catch { /* Retain an unconfirmed request. */ }
    }
    $('control-status').textContent = manual ? 'Studio status refreshed.' : '';
  } catch (problem) {
    controls.connected = false;
    $('generate-submit').disabled = true;
    $('generate-both').disabled = true;
    for (const profile of profiles) $(`pause-${profile}`).disabled = true;
    $('control-connection').textContent = 'Studio not connected';
    $('control-status').textContent = 'The studio connection is unavailable. Your settings stay here.';
  } finally {
    controls.fetching = false;
  }
}
async function authenticate(token) {
  try {
    await controlRequest('session', { token });
    studioLive.reconnect();
    token = '';
    await refreshControls(true);
    await generationSteps.retry();
  } catch (problem) {
    token = '';
    $('control-status').textContent = 'The studio connection is unavailable. Your settings stay here.';
  } finally {
    token = '';
  }
}
const choiceOptions = {
  width: { label: 'Resolution', values: [256, 512, 768, 1024, 1536], suffix: ' px' },
  guidance_scale: { label: 'Guidance', values: [2, 3, 3.5, 4, 5, 7.5] },
  seed: { label: 'Starting seed', values: [42, 123, 2026] },
  count: { label: 'Images', values: [1, 2, 4, 8, 20] },
};
const modelGuidance = { 'flux1-dev': null, 'flux2-dev-nf4': null };
const modelParameters = { 'flux1-dev': { guidance_scale: 3.5, seed: 42, count: 1 }, 'flux2-dev-nf4': { guidance_scale: 4, seed: 42, count: 1 } };
const modelSteps = { 'flux1-dev': 28, 'flux2-dev-nf4': 28 };
const modelResolution = { 'flux1-dev': 512, 'flux2-dev-nf4': 1024 };
const validSteps = value => Number.isInteger(value) && value >= 1 && value <= 60;
const generationSteps = createGenerationSteps({
  read: () => modelSteps,
  apply: values => { Object.assign(modelSteps, values); syncSelection(); },
  status: message => { for (const id of ['compare-step-status', 'control-step-status']) if ($(id)) $(id).textContent = message; },
});
const stepButtons = mountModelStepButtons({ root: document, modelSteps, changed: () => { syncSelection(); void generationSteps.save(); } });
const presetSettings = { draft: { width: 512, steps: 16 }, study: { width: 512, steps: 28 }, detail: { width: 1024, steps: 36 } };
const presetForModel = (name, profile) => ({ ...presetSettings[name], ...(name === 'study' && profile === 'flux2-dev-nf4' ? { width: 1024 } : {}) });
const generationField = (key) => $('generation-form').elements.namedItem(key);
let submittedSettings = '';
function selectionDescription() {
  return `${modelNames[generationField('profile').value]} · ${generationField('width').value}² · ${modelSteps[generationField('profile').value]} steps · guidance ${modelGuidance[generationField('profile').value] ?? generationField('guidance_scale').value} · seed ${generationField('seed').value} · ${generationField('count').value} image${generationField('count').value === '1' ? '' : 's'}`;
}
function saveControlDraft() {
  const values = Object.fromEntries(controlFields.map((key) => [key, generationField(key).value]));
  values.modelSteps = { ...modelSteps };
  values.modelResolution = { ...modelResolution };
  values.modelGuidance = { ...modelGuidance };
  values.modelParameters = Object.fromEntries(profiles.map(profile => [profile, { ...modelParameters[profile] }]));
  try { localStorage.setItem('artwork-comparison:generation-draft', JSON.stringify(values)); } catch { /* Keep the current selection. */ }
}
function syncSelection() {
  const profile = generationField('profile').value;
  for (const key of ['seed', 'count', 'guidance_scale']) generationField(key).value = String(key === 'guidance_scale' ? modelGuidance[profile] ?? modelParameters[profile][key] : modelParameters[profile][key]);
  $('parameter-profile').textContent = `Editing ${modelNames[profile]}`;
  generationField('width').value = String(modelResolution[profile]);
  generationField('steps').value = String(modelSteps[profile]);
  for (const input of document.querySelectorAll('[data-step-profile]')) input.value = String(modelSteps[input.dataset.stepProfile]);
  stepButtons.refresh();
  generationField('height').value = generationField('width').value;
  generationField('max_sequence_length').value = '512';
  for (const button of document.querySelectorAll('[data-choice-field]')) {
    const value = generationField(button.dataset.choiceField).value;
    const selected = button.dataset.choiceValue === 'random' ? !choiceOptions.seed.values.includes(Number(value)) : Number(value) === Number(button.dataset.choiceValue);
    button.setAttribute('aria-pressed', String(selected));
    if (button.dataset.choiceValue === 'random') button.textContent = selected ? `New · ${value}` : 'New seed ↻';
  }
  for (const button of document.querySelectorAll('[data-model]')) button.setAttribute('aria-pressed', String(button.dataset.model === profile));
  for (const button of document.querySelectorAll('[data-preset]')) {
    const preset = presetForModel(button.dataset.preset, button.dataset.profile);
    const selected = button.dataset.profile === profile && Number(generationField('width').value) === preset.width && Number(generationField('steps').value) === preset.steps && Number(generationField('guidance_scale').value) === (profile === 'flux1-dev' ? 3.5 : 4);
    button.setAttribute('aria-pressed', String(selected));
  }
  for (const item of profiles) $(`lane-${item}`).classList.toggle('selected-model', item === profile);
  $('selection-profile').textContent = `${modelNames[profile]} selected`;
  $('selected-settings').textContent = selectionDescription() + ' · Both: ' + profiles.map(p => `${modelNames[p]} ${modelSteps[p]} steps`).join(' / ') + (profiles.some(p => modelGuidance[p] !== null) ? ' · guidance overrides: ' + profiles.filter(p => modelGuidance[p] !== null).map(p => `${modelNames[p]} ${modelGuidance[p]}`).join(', ') : '');
  $('generate-submit').firstChild.textContent = `Queue ${modelNames[profile]} `;
  $('generate-both').firstChild.textContent = `Run both · ${profiles.reduce((sum, profile) => sum + modelParameters[profile].count, 0)} images `;
  $('compare-generate-both').textContent = `Run both · ${profiles.reduce((sum, profile) => sum + modelParameters[profile].count, 0)} images`;
  $('compare-generate-both').title = `${profiles.map(p => `${modelNames[p]} ${modelResolution[p]} × ${modelResolution[p]}`).join(' / ')} · seed ${generationField('seed').value} · ${generationField('count').value} per model`;
  $('selected-prompt-text').textContent = generationField('prompt').value;
  for (const button of $('scene-choices').children) {
    const selected = button.promptValue === generationField('prompt').value;
    button.setAttribute('aria-pressed', String(selected));
    if (selected) $('selected-scene-title').textContent = button.textContent;
  }
  saveControlDraft();
}
function selectModel(profile) {
  generationField('profile').value = profile;
  syncSelection();
}
for (const [key, option] of Object.entries(choiceOptions)) {
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'choice-field';
  fieldset.append(text('legend', option.label));
  const group = document.createElement('div');
  group.className = 'choice-buttons';
  for (const value of [...option.values, ...(key === 'seed' ? ['random'] : [])]) {
    const button = text('button', value === 'random' ? 'New seed ↻' : `${value}${option.suffix || ''}`);
    button.type = 'button'; button.dataset.choiceField = key; button.dataset.choiceValue = String(value);
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      generationField(key).value = value === 'random' ? String(crypto.getRandomValues(new Uint32Array(1))[0] % 4294967276) : String(value);
      if (key in modelParameters[generationField('profile').value]) modelParameters[generationField('profile').value][key] = Number(generationField(key).value);
      if (key === 'guidance_scale') modelGuidance[generationField('profile').value] = Number(generationField(key).value);
      if (key === 'width') modelResolution[generationField('profile').value] = Number(value);
      if (key === 'steps') modelSteps[generationField('profile').value] = Number(value);
      syncSelection();
    });
    group.append(button);
  }
  fieldset.append(group); $('parameter-choices').append(fieldset);
}
for (const button of document.querySelectorAll('[data-model]')) button.addEventListener('click', () => selectModel(button.dataset.model));
for (const button of document.querySelectorAll('[data-preset]')) button.addEventListener('click', () => {
  const preset = presetForModel(button.dataset.preset, button.dataset.profile);
  modelSteps[button.dataset.profile] = preset.steps;
  modelResolution[button.dataset.profile] = preset.width;
  for (const [key, value] of Object.entries(preset)) generationField(key).value = String(value);
  selectModel(button.dataset.profile);
  void generationSteps.save();
});
function renderSceneChoices() {
  const choices = new Map();
  for (const row of state.rows) if (row.prompt && !choices.has(row.prompt)) choices.set(row.prompt, row.title.replace(/ · \d+ px$/, ''));
  const savedPrompt = generationField('prompt').value;
  if (savedPrompt && !choices.has(savedPrompt)) choices.set(savedPrompt, 'Saved prompt');
  if (!savedPrompt && choices.size) generationField('prompt').value = choices.keys().next().value;
  const buttons = [];
  for (const [prompt, title] of choices) {
    const button = text('button', title);
    button.type = 'button'; button.promptValue = prompt; button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => { generationField('prompt').value = prompt; syncSelection(); });
    buttons.push(button);
  }
  $('scene-choices').replaceChildren(...buttons);
  syncSelection();
}
try {
  const draft = JSON.parse(localStorage.getItem('artwork-comparison:generation-draft') || '{}');
  for (const profile of profiles) {
    const resolution = Number(draft.modelResolution?.[profile] ?? (profile === 'flux1-dev' && draft.profile === profile ? draft.width : modelResolution[profile]));
    if (choiceOptions.width.values.includes(resolution)) modelResolution[profile] = resolution;
    const steps = Number(draft.modelSteps?.[profile] ?? draft.steps ?? 28);
    if (validSteps(steps)) modelSteps[profile] = steps;
    const savedParameters = draft.modelParameters?.[profile] || (draft.profile === profile ? draft : {});
    for (const key of ['seed', 'count', 'guidance_scale']) {
      const value = Number(savedParameters[key]);
      if (key === 'seed' ? Number.isInteger(value) && value >= 0 && value <= 4294967276 : choiceOptions[key].values.includes(value)) modelParameters[profile][key] = value;
    }
    const guidance = draft.modelGuidance?.[profile];
    if (typeof guidance === 'number' && Number.isFinite(guidance) && guidance >= 1 && guidance <= 10) modelGuidance[profile] = guidance;
  }
  for (const key of controlFields) {
    if (typeof draft[key] !== 'string') continue;
    if (key === 'profile' && profiles.includes(draft[key]) || key === 'prompt' && draft[key].length <= 20000 || key === 'seed' && /^\d+$/.test(draft[key]) && Number(draft[key]) <= 4294967276 || choiceOptions[key]?.values.includes(Number(draft[key]))) generationField(key).value = draft[key];
  }
} catch { /* Use the explicit defaults. */ }
for (const button of document.querySelectorAll('[data-guidance-profile]')) button.setAttribute('aria-pressed', String(button.dataset.guidanceValue === String(modelGuidance[button.dataset.guidanceProfile])));
renderSceneChoices();
for (const input of document.querySelectorAll('[data-step-profile]')) input.addEventListener('change', () => {
  const value = Number(input.value);
  if (!input.reportValidity() || !validSteps(value)) return;
  modelSteps[input.dataset.stepProfile] = value;
  syncSelection();
  void generationSteps.save();
});
void generationSteps.load();
$('compare-generate-both').addEventListener('click', () => {
  for (const input of $('gallery-panel').querySelectorAll('[data-step-profile]')) if (!input.reportValidity()) return;
  if (!controls.authorized || !controls.connected) { showTab('controls', true); return; }
  if (!current()?.prompt) { $('compare-queue-status').textContent = 'Choose a comparison first.'; return; }
  generationField('prompt').value = current().prompt;
  renderSceneChoices();
  $('generation-form').requestSubmit($('generate-both'));
});
$('use-gallery-prompt').addEventListener('click', () => {
  if (current()?.prompt) {
    generationField('prompt').value = current().prompt;
    renderSceneChoices();
    $('queue-status').textContent = 'The current comparison is selected.';
  } else $('queue-status').textContent = 'The scene collection is still connecting.';
});
async function refreshAgentSnapshot() {
  try {
    const snapshot = await studioLive.read('agents');
    const workers = Array.isArray(snapshot.workers) ? snapshot.workers.slice(0, 3) : [];
    const assigned = workers.filter(worker => ['assigned', 'working'].includes(worker.status)).length;
    $('agent-summary').textContent = `${assigned} assigned workers · capacity 3 + 1 coordinator · snapshot`;
    const cards = workers.map(worker => {
      const card = document.createElement('div'); card.className = 'agent-assignment';
      const status = ['assigned', 'working', 'done', 'idle'].includes(worker.status) ? worker.status : 'unconfirmed';
      card.dataset.state = status;
      card.append(text('span', worker.name || worker.id, 'agent-name'), text('span', worker.task || 'No task recorded', 'agent-task'), text('span', status, 'agent-state'));
      return card;
    });
    $('agent-assignments').replaceChildren(...cards);
    const updated = new Date(snapshot.updatedAt);
    $('agent-updated').textContent = `Assignment snapshot · ${Number.isNaN(updated.valueOf()) ? 'time not recorded' : updated.toLocaleString()} · updated by the coordinator, not live presence`;
  } catch { $('agent-updated').textContent = 'Assignment snapshot unavailable. Live generator state is shown separately.'; }
}
refreshAgentSnapshot();
$('generation-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (controls.posting || !controls.authorized || !controls.connected) return;
  syncSelection();
  const payload = Object.fromEntries(controlFields.map((key) => [key, ['profile', 'prompt'].includes(key) ? generationField(key).value : Number(generationField(key).value)]));
  if (!payload.prompt.trim()) { $('queue-status').textContent = 'Choose a scene for these images.'; return; }
  const targets = event.submitter?.id === 'generate-both' ? profiles : [payload.profile];
  const requests = targets.map(profile => modelRequest(payload, profile, { modelSteps, modelResolution, modelGuidance, modelParameters }));
  const payloadJSON = JSON.stringify(requests);
  if (!pendingControlRequest || pendingControlRequest.payloadJSON !== payloadJSON) retainPendingRequest({ requestId: crypto.randomUUID(), payloadJSON });
  const requestId = pendingControlRequest.requestId;
  controls.posting = true;
  setAuthorized(controls.authorized);
  $('queue-status').textContent = 'Adding your images to the queue…';
  $('compare-queue-status').textContent = $('queue-status').textContent;
  try {
    const results = await Promise.allSettled(requests.map(request => controlRequest('jobs', { ...request, requestId: `${requestId}-${request.profile === 'flux1-dev' ? 'f1' : 'f2'}` })));
    const accepted = results.filter(result => result.status === 'fulfilled');
    if (accepted.length === results.length) {
      retainPendingRequest(null);
      submittedSettings = requests.map(request => `${modelNames[request.profile]} · ${request.width}² · ${request.steps} steps · guidance ${request.guidance_scale} · seed ${request.seed} · ${request.count} images`).join(' / ');
      $('applied-settings').textContent = `Submitted · ${submittedSettings}`;
      $('queue-status').textContent = `${requests.reduce((sum, request) => sum + request.count, 0)} ${requests.reduce((sum, request) => sum + request.count, 0) === 1 ? 'image' : 'images'} queued. Running work keeps its settings.`;
    } else {
      $('queue-status').textContent = `${accepted.length} of ${targets.length} model requests confirmed. Retry these same choices to reconcile without duplicating accepted work.`;
    }
    await refreshControls(true);
  } catch {
    $('queue-status').textContent = 'The request could not be confirmed. Retry the same choices to reconcile it.';
  } finally {
    controls.posting = false;
    setAuthorized(controls.authorized);
    $('compare-queue-status').textContent = $('queue-status').textContent;
  }
});
for (const profile of profiles) {
  $(`pause-${profile}`).addEventListener('click', async () => {
    const worker = controls.workers.find((item) => item.profile === profile);
    if (!worker || controls.pendingLanes.has(profile)) return;
    controls.pendingLanes.add(profile);
    renderWorkers();
    try {
      const result = await controlRequest('pause', { profile, paused: !worker.paused });
      if (result.worker?.profile === profile) controls.workers = controls.workers.map((item) => item.profile === profile ? result.worker : item);
      $('control-status').textContent = worker.paused ? 'Queued images can run again.' : 'Future images are paused. Any active image will finish.';
      await refreshControls();
    } catch {
      $('control-status').textContent = 'The change could not be confirmed. The studio state will update automatically.';
    } finally {
      controls.pendingLanes.delete(profile);
      renderWorkers();
    }
  });
}
async function connectWorkstation() {
  if (!['127.0.0.1', 'localhost'].includes(location.hostname)) return;
  try {
    const response = await fetch('/api/workstation-session', { method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(10000) });
    if (!response.ok) return;
    studioLive.reconnect();
    await refreshControls(true);
  } catch { /* Existing authenticated sessions and live reconnect stay available. */ }
}
void connectWorkstation();
const requestedTab = bootstrapControlToken !== null ? 'controls' : studioTab(location.href);
showTab(tabNames.includes(requestedTab) ? requestedTab : new URLSearchParams(location.search).has('comparison') ? 'gallery' : 'stream', false, false);
if (bootstrapControlToken !== null) {
  const token = bootstrapControlToken;
  bootstrapControlToken = null;
  authenticate(token);
} else if (activeTab === 'controls') refreshControls();
else if (activeTab === 'tasks') refreshTasks();

let workMode = true;
let detailsVisible = false;
try {
  detailsVisible = localStorage.getItem('artwork-comparison:show-details') === 'true';
} catch { /* Compact mode is the default. */ }
function applyWorkMode() {
  document.body.classList.toggle('work-mode', workMode);
  document.body.classList.toggle('show-details', detailsVisible);
  const expanded = detailsVisible || !workMode;
  const detailsButton = $('show-details');
  const label = expanded ? 'Collapse details' : 'Expand details';
  detailsButton.setAttribute('aria-expanded', String(expanded));
  detailsButton.setAttribute('aria-label', label);
  detailsButton.title = label;
}
$('show-details').addEventListener('click', () => {
  if (!workMode) { workMode = true; detailsVisible = false; }
  else detailsVisible = !detailsVisible;
  applyWorkMode();
  try {
    localStorage.setItem('artwork-comparison:work-mode', String(workMode));
    localStorage.setItem('artwork-comparison:show-details', String(detailsVisible));
  } catch { /* Current view is retained. */ }
});
applyWorkMode();
let streamRetryTimer;
const streamState = { fetching: false, jobs: [], counts: {}, ready: new Map(), pending: new Set(), failed: new Map(), version: 0 };
const streamPagination = mountStreamPagination({ profiles, jobs: profile => streamState.jobs.filter(job => job.profile === profile), render: renderStreamGrid });
function streamImageURL(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value, location.href);
    return url.origin === location.origin && ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
function jobTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp / 1000 : 0;
}
function streamCapacity(profile) {
  const width = $(`stream-grid-${profile}`).clientWidth || Math.max(180, innerWidth / 2 - 50);
  const columns = Math.max(1, Math.floor((width + 12) / 190));
  const rows = Math.max(2, Math.ceil(Math.max(350, innerHeight - 180) / (width / columns + 90)));
  return Math.max(4, Math.min(18, columns * rows));
}
function streamKey(job) { return `${job.profile}:${job.id}:${job.sha256 || ''}`; }
function streamCard(job, image, url) {
  const card = document.createElement('figure');
  card.className = 'image-card stream-card';
  const button = document.createElement('button');
  button.className = 'image-area'; button.type = 'button';
  button.setAttribute('aria-label', `View ${job.scene || job.id}, ${modelNames[job.profile]}, at a larger size`);
  button.append(image);
  button.addEventListener('click', () => {
    $('viewer-title').textContent = `${modelNames[job.profile]} · ${job.scene || job.id}`;
    $('viewer-image').alt = image.alt;
    $('viewer-image').src = url;
    $('viewer').showModal(); $('close-viewer').focus();
  });
  const caption = document.createElement('figcaption'); caption.className = 'stream-caption';
  const line = document.createElement('div'); line.className = 'stream-card-title';
  line.append(text('p', job.title || job.scene || job.id, 'stream-scene'), text('span', formatSeconds(job.seconds) || 'Time not recorded', 'stream-duration'));
  const settings = job.settings || {};
  const parts = [];
  if (job.width && job.height) parts.push(`${job.width} × ${job.height}`);
  if (available(settings.steps)) parts.push(`${settings.steps} steps`);
  if (available(settings.seed)) parts.push(`seed ${settings.seed}`);
  if (available(settings.guidance_scale)) parts.push(`guidance ${settings.guidance_scale}`);
  const detail = document.createElement('details'); detail.className = 'stream-item-details';
  detail.append(text('summary', 'Prompt and settings'), text('p', job.prompt || 'Prompt not recorded.', 'stream-prompt'), text('p', parts.join(' · '), 'stream-settings'));
  caption.append(line, detail);
  card.append(button, caption);
  return card;
}
function renderStreamGrid() {
  if (document.hidden || activeTab !== 'stream') return;
  for (const profile of profiles) {
    const grid = $(`stream-grid-${profile}`);
    // Preserve a keyboard user's place while new records arrive.
    if (grid.contains(document.activeElement)) continue;
    const capacity = 18;
    const jobs = streamPagination.jobs(profile);
    const candidates = jobs.slice(0, capacity);
    for (const job of candidates) {
      const key = streamKey(job);
      if (streamState.ready.has(key) || streamState.pending.has(key) || Date.now() - (streamState.failed.get(key) || 0) < 15000) continue;
      const url = artworkImageURL(streamImageURL(job.imageUrl), job.sha256);
      if (!url) continue;
      if (streamState.pending.size >= 6 || [...streamState.pending].filter(item => item.startsWith(profile + ':')).length >= 3) continue;
      streamState.pending.add(key);
      const image = new Image();
      let triedArchive = false;
      image.alt = `${job.scene || 'Generated image'} — ${modelNames[profile]}`;
      image.decoding = 'async';
      image.onload = () => {
        streamState.pending.delete(key);
        streamState.failed.delete(key);
        streamState.ready.set(key, { job, card: streamCard(job, image, image.currentSrc || image.src) });
        renderStreamGrid();
      };
      image.onerror = () => {
        if (!triedArchive && new URL(url).pathname !== '/api/gallery/image') {
          triedArchive = true;
          const object = `artwork-comparison/2026-10-17-flux-study/${job.profile}/${job.id}/result.png`;
          image.src = '/api/gallery/image?' + new URLSearchParams({ key: object, sha256: job.sha256 });
          return;
        }
        streamState.failed.set(key, Date.now());
        streamState.pending.delete(key);
        $('stream-status').textContent = 'Some images are still loading. Completed images stay in place; missing images retry automatically.';
        clearTimeout(streamRetryTimer); streamRetryTimer = setTimeout(renderStreamGrid, 15500);
        renderStreamGrid();
      };
      image.src = url;
    }
    // Keep previous good cards until replacements have fully loaded.
    const loaded = jobs.filter(job => streamState.ready.has(streamKey(job))).slice(0, capacity);
    const cards = loaded.map(job => streamState.ready.get(streamKey(job)).card);
    if (cards.length) {
      for (let index = 0; index < cards.length; index++) {
        if (grid.children[index] !== cards[index]) grid.insertBefore(cards[index], grid.children[index] || null);
      }
      for (const child of [...grid.children]) if (!cards.includes(child)) child.remove();
    }
    $(`stream-count-${profile}`).textContent = `${loaded.length} shown · ${streamState.counts[profile] ?? jobs.length} archived`;
  }
  const retained = new Set(profiles.flatMap(profile => [...streamPagination.jobs(profile), ...streamState.jobs.filter(job => job.profile === profile)].map(streamKey)));
  for (const key of streamState.ready.keys()) if (!retained.has(key)) streamState.ready.delete(key);
}
async function refreshStream() {
  if (streamState.fetching || document.hidden || activeTab !== 'stream' || $('viewer').open) return;
  streamState.fetching = true;
  try {
    const payload = await studioLive.read('gallery-recent');
    if (!Array.isArray(payload.jobs)) throw new Error('Stream unavailable');
    const version = jobTime(payload.updatedAt);
    if (version && version < streamState.version) return;
    const seen = new Set();
    streamState.jobs = payload.jobs.filter(job => {
      if (!job || !profiles.includes(job.profile) || !job.id || !streamImageURL(job.imageUrl)) return false;
      const key = `${job.profile}:${job.id}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).sort((a, b) => jobTime(b.created) - jobTime(a.created));
    streamState.version = version;
    streamState.counts = payload.counts || {};
    streamPagination.update();
    renderStreamGrid();
    $('stream-status').textContent = streamState.jobs.length ? 'Recent completed images · newest first in each model lane · updates appear automatically.' : 'Ready for the first completed images.';
  } catch {
    $('stream-status').textContent = 'The stream is reconnecting. Any images already here will stay.';
  } finally { streamState.fetching = false; }
}
let streamResize;
window.addEventListener('resize', () => { clearTimeout(streamResize); streamResize = setTimeout(renderStreamGrid, 120); });

refreshStream();

let liveWorkbenchMount=null,liveWorkbenchMarkup=null;
const panelLoaders={
 research:()=>Promise.all([import('./research.js'),import('./research-panel.html?raw')]).then(([m,h])=>[m.mountResearch,h.default]),
 workbench:()=>Promise.all([import('./workbench.js'),import('./workbench-panel.html?raw')]).then(([component,markup])=>{liveWorkbenchMount=component.mountWorkbench;liveWorkbenchMarkup=markup.default;return [liveWorkbenchMount,liveWorkbenchMarkup];}),
 performance:()=>Promise.all([import('./performance.js'),import('./performance-panel.html?raw')]).then(([m,h])=>[m.mountPerformance,h.default]),
 models:()=>Promise.all([import('./models.js'),import('./models-panel.html?raw')]).then(([m,h])=>[m.mountModels,h.default]),
 seers:()=>Promise.all([import('./seers.js'),import('./seers-panel.html?raw')]).then(([m,h])=>[m.mountSeers,h.default]),
 metrics:()=>Promise.all([import('./metrics.js'),import('./metrics-panel.html?raw')]).then(([m,h])=>[m.mountMetrics,h.default]),
 monitor:()=>Promise.all([import('./monitor.js'),import('./monitor-panel.html?raw')]).then(([m,h])=>[m.mountMonitor,h.default]),
 agents:()=>Promise.all([import('./agents.js'),import('./agents-panel.html?raw')]).then(([m,h])=>[m.mountAgents,h.default]),
 daemons:()=>Promise.all([import('./daemons.js'),import('./daemons-panel.html?raw')]).then(([m,h])=>[m.mountDaemons,h.default]),
 winners:()=>Promise.all([import('./winners.js'),import('./winners-panel.html?raw')]).then(([m,h])=>[m.mountWinners,h.default]),
 rules:()=>import('./rules-panel.html?raw').then(h=>[null,h.default]),
 worlds:()=>import('./worlds-panel.html?raw').then(h=>[null,h.default]),
 protocol:()=>import('./protocol-panel.html?raw').then(h=>[null,h.default]),
};
function lazyPanel(name,loader){
 const root=$(name+'-panel');let active=false,disposed=false,pending=null,controller=null;
 const proxy={
  setActive(value){active=value;if(controller){controller.setActive(value);return;}if(!value||pending||disposed)return;
   root.setAttribute('aria-busy','true');
   pending=loader().then(([mount,markup])=>{if(disposed)return;
    // Public navigation may already have attached the nested Seers container.
    root.insertAdjacentHTML('afterbegin',markup);
    controller=mount?mount({root,isActive:()=>active&&!document.hidden}):{setActive(){},destroy(){}};
    controller.setActive(active);root.removeAttribute('aria-busy');delete root.dataset.loadError;publicNavigation?.update();
   }).catch(()=>{pending=null;root.removeAttribute('aria-busy');root.dataset.loadError='true';});
  },
  destroy(){disposed=true;controller?.destroy();},
  remount(mount,markup){if(!controller||disposed)return;controller.destroy();root.innerHTML=markup;controller=mount({root,isActive:()=>active&&!document.hidden});controller.setActive(active);},
 };
 return proxy;
}
for(const [name,loader] of Object.entries(panelLoaders))embeddedPanels[name]=lazyPanel(name,loader);
publicNavigation = mountPublicNavigation({ select: showTab, activeTab: () => activeTab, panels: embeddedPanels });
workspaceNavigation = mountWorkspaceNavigation({select:showTab,activeTab:()=>activeTab});
for(const [name,panel] of Object.entries(embeddedPanels))panel.setActive(activeTab===name||name==='seers'&&activeTab==='models'&&document.documentElement.dataset.studioMode==='public');
if(import.meta.hot)import.meta.hot.accept(['./workbench.js','./workbench-panel.html?raw'],([component,markup])=>{
 if(component)liveWorkbenchMount=component.mountWorkbench;if(markup)liveWorkbenchMarkup=markup.default;
 if(liveWorkbenchMount&&liveWorkbenchMarkup)embeddedPanels.workbench.remount(liveWorkbenchMount,liveWorkbenchMarkup);
});
if (import.meta.hot) import.meta.hot.dispose(() => {
  workspaceNavigation.destroy();
  publicNavigation.destroy();
  stepButtons.destroy();
  for (const panel of Object.values(embeddedPanels)) panel.destroy();
  for (const stop of liveTopics.values()) stop();
  liveTopics.clear();
  clearInterval(taskRuntimeTimer);
});

window.dispatchEvent(new Event('artwork-ready'));

function updateWinnerChoices(observation){
  if (!observation.available) return;
  if (observation.data?.schemaVersion !== 1 || !Array.isArray(observation.data.winners) || !observation.data.revisions || typeof observation.data.revisions !== 'object') return;
  winnerRecord = observation.data;
  for (const [id, entry] of comparisonCards) updateChoiceCard(entry.card, id);
}
