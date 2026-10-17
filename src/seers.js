import './seers.css';

const models = [
  { id: 'pixtral', name: 'Pixtral', purpose: 'Composition, light & visual critique' },
  { id: 'dinov2', name: 'DINO', purpose: 'Visual fingerprints & similarity' },
  { id: 'gemma', name: 'Gemma', purpose: 'Artist feedback · Gemma 4 12B' },
];
const node = (tag, value, className) => {
  const element = document.createElement(tag);
  if (value) element.textContent = value;
  if (className) element.className = className;
  return element;
};
const imageURL = value => typeof value === 'string' && /^\/api\/seers\/image\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(value) ? value : null;
const stamp = seconds => Number.isFinite(seconds) ? new Date(seconds * 1000).toLocaleString() : 'Time not recorded';

export function mountSeers({ root, isActive = () => true }) {
  const list = root.querySelector('#seers-models');
  const connection = root.querySelector('#seers-connection');
  const status = root.querySelector('#seers-status');
  let source = null, snapshot = null, connected = false, enabled = false, disposed = false, timer = null;
  const cards = new Map();

  function card(model, row, fresh) {
    const article = node('article', '', 'seer-card'); article.setAttribute('aria-label', model.name);
    const current = row?.current;
    const review = current || row?.last;
    const state = !fresh ? 'unknown' : !row?.ready ? 'offline' : current ? 'reviewing' : 'ready';
    const heading = node('div', '', 'seer-heading');
    const identity = node('div');
    identity.append(node('h2', model.name), node('p', model.purpose, 'seer-purpose'));
    const badge = node('span', { unknown: 'Unknown', offline: 'Offline', reviewing: 'Reviewing', ready: 'Ready' }[state], 'seers-badge');
    badge.dataset.state = state; heading.append(identity, badge); article.append(heading);
    const images = (review?.images || []).filter(image => imageURL(image.url));
    const description = current ? fresh ? 'Looking at' : 'Last observed input' : 'Last image reviewed';
    if (images.length) {
      const group = node('div', '', 'seer-images');
      for (const [i, image] of images.entries()) {
        const figure = node('figure', '', 'seer-image');
        const img = document.createElement('img');
        img.src = image.url; img.alt = `Image ${i + 1} sent to ${model.name}`;
        img.loading = 'lazy'; img.decoding = 'async'; img.width = 512; img.height = 512;
        img.addEventListener('error', () => {
          img.replaceWith(node('div', 'Recorded image unavailable', 'seer-empty'));
        }, { once: true });
        figure.append(img, node('figcaption', description + (images.length > 1 ? ` · ${i + 1}` : ''))); group.append(figure);
      }
      article.append(group);
    } else article.append(node('div', review ? 'No image was captured for this request.' : 'Waiting for an image to review.', 'seer-empty'));
    const copy = node('div', '', 'seer-copy');
    copy.append(node('h3', current ? 'Feedback in progress' : 'Latest feedback'));
    const result = !current ? review?.feedback : null;
    const message = current ? fresh && row.ready ? `Reviewing this image${row.pending ? ` · ${row.pending} more queued` : ''}. Feedback will appear here.`
      : 'The review was in progress when the connection was lost. Its current state is unknown.'
      : result?.text || 'No feedback recorded yet. Reviews appear when this model receives an image.';
    copy.append(node('p', message, 'seer-feedback' + (!result ? ' seer-muted' : '')));
    if (result?.measures) {
      const dl = node('dl', '', 'seer-measures');
      const labels = { cosine_similarity: 'Cosine similarity', cosine_distance: 'Visual distance', dimensions: 'Feature dimensions', images: 'Images measured' };
      for (const [key, value] of Object.entries(result.measures)) {
        if (!labels[key] || !Number.isFinite(value)) continue;
        const pair = node('div'); pair.append(node('dt', labels[key]), node('dd', Number.isInteger(value) ? value.toLocaleString() : value.toFixed(4))); dl.append(pair);
      }
      copy.append(dl);
    }
    if (review) {
      copy.append(node('p', `${current ? 'Requested' : review.state === 'failed' ? 'Review failed' : 'Reviewed'} ${stamp(review.finishedAt || review.startedAt)}`, 'seer-time'));
      if (review.prompt) {
        const details = node('details', '', 'seer-prompt');
        details.append(node('summary', 'Review request'), node('p', review.prompt)); copy.append(details);
      }
    }
    article.append(copy);
    return article;
  }

  function render() {
    const fresh = connected && snapshot?.ok === true && Date.now() / 1000 - snapshot.observedAt < 8;
    connection.textContent = fresh ? 'Live' : 'Reconnecting'; connection.dataset.state = fresh ? 'ready' : 'unknown';
    for (const model of models) {
      const row = snapshot?.models?.find(item => item.id === model.id);
      const signature = JSON.stringify([fresh, row]);
      if (cards.get(model.id)?.signature === signature) continue;
      const next = card(model, row, fresh);
      const previous = cards.get(model.id)?.element;
      if (previous) previous.replaceWith(next); else list.append(next);
      cards.set(model.id, { element: next, signature });
    }
    status.textContent = fresh ? 'Live model activity · completed feedback stays paired with the image it reviewed.'
      : snapshot ? 'Connection unavailable. Last recorded reviews are retained; current activity is unknown.' : 'Connecting to model activity.';
  }

  function sync() {
    const active = enabled && !disposed && !document.hidden && isActive();
    if (active && !source) {
      const events = new EventSource('/api/seers/events'); source = events;
      events.onmessage = event => {
        if (source !== events) return;
        try { const value = JSON.parse(event.data); if (!Array.isArray(value.models)) return; snapshot = value; connected = value.ok === true; render(); } catch { /* Await a valid observation. */ }
      };
      events.onerror = () => { if (source === events) { connected = false; render(); } };
      timer = setInterval(render, 1000); render();
    } else if (!active && source) {
      source.close(); source = null; connected = false; clearInterval(timer); timer = null;
    }
  }
  render();
  document.addEventListener('visibilitychange', sync);
  return {
    setActive(value) { enabled = value; sync(); },
    destroy() { disposed = true; sync(); document.removeEventListener('visibilitychange', sync); },
  };
}
