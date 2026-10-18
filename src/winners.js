import { studioLive } from './live-store.js';
import { artworkImageURL } from './image-cache.js';
import './winners.css';
export function mountWinners({ root, isActive }) {
  let release = null;
  let disposed = false;
  const grid = root.querySelector('#winners-grid');
  const status = root.querySelector('#winners-status');
  const cards = new Map();
  function render(observation) {
    if (disposed || !isActive()) return;
    if (!observation.available) { status.textContent = 'Your kept choices are not available at the moment.'; return; }
    const rows = observation.data.winners || [];
    const ids = new Set(rows.map(row => row.comparisonId));
    for (const [id, card] of cards) if (!ids.has(id)) { card.remove(); cards.delete(id); }
    for (const [index, row] of rows.entries()) {
      let card = cards.get(row.comparisonId);
      if (!card || card.dataset.signature !== JSON.stringify(row)) {
        const next = document.createElement('figure'); next.className = 'winner-card'; next.dataset.signature = JSON.stringify(row);
        const image = document.createElement('img'); image.src = artworkImageURL(row.selection.image, row.selection.imageSha256); image.alt = row.title; image.loading = 'lazy';
        const caption = document.createElement('figcaption'); const heading = document.createElement('h2'); heading.textContent = row.title;
        const model = document.createElement('p'); model.textContent = row.selection.model || 'Selected artwork';
        const link = document.createElement('a'); link.href = '/compare?comparison=' + encodeURIComponent(row.comparisonId); link.textContent = 'See the comparison';
        caption.append(heading, model, link); next.append(image, caption);
        card?.replaceWith(next); card = next; cards.set(row.comparisonId, card);
      }
      if (grid.children[index] !== card) grid.insertBefore(card, grid.children[index] || null);
    }
    status.textContent = rows.length ? 'Your comparison choices are kept in the project.' : 'There is room for your first choice. Choose left or right in Compare.';
  }
  function sync(value = true) {
    release?.(); release = null;
    if (value && !disposed && isActive() && !document.hidden) release = studioLive.subscribe('winners', render);
  }
  const visibility = () => sync(); document.addEventListener('visibilitychange', visibility);
  return { refresh() { sync(); }, setActive: sync, destroy() { disposed = true; release?.(); document.removeEventListener('visibilitychange', visibility); } };
}
