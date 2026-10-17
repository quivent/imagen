'use strict';
const token = document.querySelector('meta[name="artwork-token"]').content;
let state;
const viewedVersions = new Map();
const reviewDrafts = new Map();
const comparison = document.querySelector('#comparison');
let comparisonInvoker;
let referenceRequest = 0;
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const notice = text => { document.querySelector(comparison.open ? '#comparison-notice' : '#notice').textContent = text; };
async function api(path, data) {
  const response = await fetch(path, data === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Artwork-Token': token }, body: JSON.stringify(data)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.problem || 'This request needs another look.');
  return result;
}
async function action(button, work) {
  button.disabled = true;
  try { await work(); } catch (error) { notice(error.message); }
  finally { button.disabled = false; }
}
async function refresh() {
  state = await api('/api/state');
  render();
}
async function useReference(scene, version) {
  const request = ++referenceRequest;
  // Imported images need their actual dimensions, not a guess from an old prompt.
  const source = new Image(); source.src = '/asset/' + version.id + '/full';
  await source.decode();
  if (request !== referenceRequest) return;
  const form = document.querySelector('#request-form');
  form.elements.scene.value = scene.id;
  form.elements.name.value = scene.name;
  form.elements.referenceVersion.value = version.id;
  form.elements.referenceRole.value = 'edit-target';
  form.elements.variant.value = 'revision-' + Date.now();
  form.elements.brief.value = '';
  form.elements.family.value = version.metadata.spec?.family || '';
  form.elements.width.value = source.naturalWidth;
  form.elements.height.value = source.naturalHeight;
  form.elements.prompt.value = 'Change only: [describe the change]. Keep the composition, place, forms and painterly treatment of the input image unchanged.';
  form.querySelector('details').open = true;
  if (comparison.open) {
    comparisonInvoker = form.elements.prompt;
    comparison.close();
  }
  form.elements.prompt.focus();
  notice('Reference added at its original dimensions. Describe the change and choose the subject before adding the request.');
}
function imageLink(scene, version, full = false) {
  const link = el('a', undefined, 'open-image');
  link.href = '/asset/' + version.id + '/full'; link.target = '_blank'; link.rel = 'noopener';
  link.setAttribute('aria-label', 'Open full image of ' + scene.name);
  const img = el('img'); img.src = '/asset/' + version.id + (full ? '/full' : '/small'); img.alt = scene.name;
  img.loading = full ? 'eager' : 'lazy'; img.width = 640; img.height = 427; link.append(img);
  return link;
}
function provenance(version) {
  const details = el('details'); details.append(el('summary', 'Prompt and record'));
  const metadata = version.metadata;
  const spec = metadata.spec;
  const receipt = metadata.generationReceipt;
  const actualPrompt = receipt?.arguments?.prompt;
  details.append(el('p', spec ? `${spec.backend} · ${spec.model} · ${spec.width} × ${spec.height}` :
    'Imported artwork. No new generation or review was performed by the import.', 'small'));
  details.append(el('p', actualPrompt ? 'Recorded tool prompt' : 'Stored request prompt', 'small'));
  details.append(el('pre', actualPrompt || spec?.prompt || metadata.legacy?.prompt || 'No prompt was recorded.'));
  if (receipt?.promptAdjustment) details.append(el('p', receipt.promptAdjustment, 'small'));
  if (metadata.legacy?.review?.unmade) details.append(el('p', metadata.legacy.review.unmade, 'small'));
  return details;
}
function reviewControls(scene, version) {
  const details = el('details'); details.append(el('summary', 'Review this version'));
  const noteLabel = el('label', 'Your note'); const note = el('textarea'); note.rows = 2;
  note.value = reviewDrafts.get(version.id) || '';
  note.dataset.reviewVersion = version.id;
  note.addEventListener('input', () => {
    reviewDrafts.set(version.id, note.value);
    for (const other of document.querySelectorAll('[data-review-version]')) {
      if (other !== note && other.dataset.reviewVersion === version.id) other.value = note.value;
    }
  });
  noteLabel.append(note); details.append(noteLabel);
  for (const [decision, caption] of [['accepted', 'Choose this version'], ['rejected', 'Set this candidate aside']]) {
    if (scene.selected === version.id) continue;
    const button = el('button', caption);
    button.addEventListener('click', () => action(button, async () => {
      await api('/api/review', { version: version.id, decision, note: note.value, expectedSelected: scene.selected });
      reviewDrafts.delete(version.id);
      if (comparison.open) comparison.close();
      await refresh(); document.querySelector('#refresh').focus(); notice('Your decision is recorded. Earlier versions remain available.');
    })); details.append(button);
  }
  if (scene.selected === version.id) details.append(el('p', 'This version is protected. Choose another candidate to replace it.'));
  return details;
}
function referenceButton(scene, version) {
  const reference = el('button', 'Use as a reference');
  reference.addEventListener('click', () => action(reference, () => useReference(scene, version)));
  return reference;
}
function compare(scene, version, alternatives, invoker) {
  comparisonInvoker = invoker;
  document.querySelector('#comparison-notice').textContent = '';
  document.querySelector('#comparison-title').textContent = scene.name;
  const select = document.querySelector('#comparison-version'); select.replaceChildren();
  for (const candidate of alternatives) {
    const option = el('option', `${candidate.state} · ${candidate.id.slice(0, 18)}`);
    option.value = candidate.id; option.selected = candidate.id === version.id; select.append(option);
  }
  const show = () => {
    const candidate = alternatives.find(v => v.id === select.value);
    const selected = alternatives.find(v => v.id === scene.selected);
    const panels = document.querySelector('#comparison-panels'); panels.replaceChildren();
    for (const [caption, item] of [['Selected artwork', selected], ['Version to consider', candidate]]) {
      const panel = el('section'); panel.append(el('h3', caption));
      if (item) {
        panel.append(imageLink(scene, item, true), el('p', `${item.state} · ${item.id}`, 'small'), provenance(item));
        if (caption === 'Version to consider') panel.append(referenceButton(scene, item), reviewControls(scene, item));
      } else panel.append(el('p', 'No version has been selected for this place.'));
      panels.append(panel);
    }
  };
  select.onchange = show; show(); comparison.showModal();
}
comparison.addEventListener('close', () => {
  if (comparisonInvoker?.isConnected) comparisonInvoker.focus();
});
document.querySelector('#comparison-close').addEventListener('click', () => comparison.close());
function card(scene, version, alternatives) {
  const article = el('article', undefined, 'card');
  article.append(imageLink(scene, version), el('h3', scene.name));
  article.append(el('p', `${scene.id} · ${version.state}${scene.selected === version.id ? ' · selected' : ''}`, 'small'));
  const label = el('label', 'Version'); const select = el('select');
  for (const candidate of alternatives) {
    const option = el('option', `${candidate.state} · ${candidate.id.slice(0, 18)}`);
    option.value = candidate.id; option.selected = candidate.id === version.id; select.append(option);
  }
  select.addEventListener('change', () => {
    viewedVersions.set(scene.id, select.value);
    const next = card(scene, alternatives.find(v => v.id === select.value), alternatives);
    article.replaceWith(next); next.querySelector('select').focus();
  });
  label.append(select); article.append(label);
  const compareButton = el('button', 'Compare versions');
  compareButton.addEventListener('click', () => compare(scene, version, alternatives, compareButton));
  const actions = el('div', undefined, 'actions'); actions.append(compareButton, referenceButton(scene, version));
  article.append(actions, provenance(version), reviewControls(scene, version));
  const similar = el('details'); similar.append(el('summary', 'Find similar compositions'));
  similar.addEventListener('toggle', async () => {
    if (!similar.open || similar.dataset.loaded) return;
    try {
      const matches = await api('/api/similar?version=' + version.id);
      similar.append(el('p', 'Visual pattern suggestions only; no geographic or quality judgment.', 'small'));
      for (const match of matches) {
        const a = el('a', `${match.scene} · ${match.identical ? 'identical file' : 'distance ' + match.distance}`);
        a.href = '/asset/' + match.id + '/full'; a.target = '_blank'; a.rel = 'noopener';
        const p = el('p'); p.append(a); similar.append(p);
      }
      similar.dataset.loaded = 'true';
    } catch (error) { notice(error.message); }
  }); article.append(similar);
  return article;
}
function render() {
  const gallery = document.querySelector('#gallery'); gallery.replaceChildren();
  const query = document.querySelector('#search').value.toLowerCase();
  const pending = document.querySelector('#filter').value === 'pending';
  let shown = 0;
  for (const scene of state.scenes) {
    if (!`${scene.id} ${scene.name}`.toLowerCase().includes(query)) continue;
    const alternatives = state.versions.filter(v => v.scene === scene.id);
    const viewed = alternatives.find(v => v.id === viewedVersions.get(scene.id));
    const version = pending ? (viewed?.state === 'pending' ? viewed : alternatives.find(v => v.state === 'pending')) :
      viewed || alternatives.find(v => v.id === scene.selected) || alternatives[0];
    if (!version) continue;
    shown++; gallery.append(card(scene, version, alternatives));
  }
  document.querySelector('#summary').textContent = `${shown} places shown · ${state.versions.filter(v => v.state === 'pending').length} candidates awaiting review`;
  const jobs = document.querySelector('#jobs'); jobs.replaceChildren();
  for (const job of state.jobs) {
    const row = el('div', undefined, 'job');
    row.append(el('p', `${job.scene} · ${job.backend} · ${job.state} · ${job.tries} attempts`));
    if (job.note) row.append(el('p', job.note));
    row.append(el('p', job.id, 'small'));
    if (['uncertain', 'failed', 'cancelled', 'queued'].includes(job.state)) {
      const label = el('label', 'Reconciliation note'); const reason = el('input'); label.append(reason); row.append(label);
      const cancelling = job.state === 'queued';
      const retry = el('button', cancelling ? 'Set this request aside' : 'Record decision and retry');
      retry.addEventListener('click', () => action(retry, async () => {
        await api(cancelling ? '/api/cancel' : '/api/retry', { job: job.id, reason: reason.value });
        await refresh(); notice(cancelling ? 'Request set aside.' : 'Retry recorded.');
      })); row.append(retry);
    } jobs.append(row);
  }
  document.querySelector('#metrics').textContent = JSON.stringify(state.metrics, null, 2);
}
document.querySelector('#refresh').addEventListener('click', event => action(event.target, refresh));
document.querySelector('#search').addEventListener('input', render);
document.querySelector('#filter').addEventListener('change', render);
document.querySelector('[name="backend"]').addEventListener('change', event => {
  document.querySelector('[name="model"]').value = ({ builtin: 'builtin', bfl: 'flux-2-pro', command: 'local-model' })[event.target.value];
});
document.querySelector('#request-form').addEventListener('submit', event => {
  event.preventDefault(); const form = event.target;
  action(form.querySelector('[type="submit"]'), async () => {
    const data = Object.fromEntries(new FormData(form)); data.width = Number(data.width); data.height = Number(data.height);
    if (data.prompt.includes('[describe the change]')) throw new Error('Describe the change in the exact prompt first.');
    const result = await api('/api/enqueue', data); await refresh();
    notice(result.cached ? 'That exact request is already recorded.' : 'Added to the queue.');
  });
});
document.querySelector('#export-form').addEventListener('submit', event => {
  event.preventDefault(); const form = event.target;
  action(form.querySelector('[type="submit"]'), async () => {
    const result = await api('/api/export', { name: form.elements.name.value, pending: form.elements.contents.value === 'pending' });
    notice('Batch prepared at ' + result.directory);
  });
});
refresh().catch(error => notice(error.message));
