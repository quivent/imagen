import './production-gallery.css';

import {createComparisonPages} from './comparison-pages.js';

export function mountComparisonPages({ grid, render }) {
  const pages = createComparisonPages();
  const nav = document.createElement('nav'); nav.className = 'comparison-pagination';
  nav.setAttribute('aria-label', 'Comparison pages');
  const label = document.createElement('span'); label.setAttribute('aria-live', 'polite');
  const buttons = ['Newer', 'Latest', 'Older'].map((name, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = name;
    button.addEventListener('click', () => { pages.move([-1, 'latest', 1][index]); render(); });
    return button;
  });
  nav.append(...buttons, label); grid.after(nav);
  return {
    rows(rows, selected) {
      const result = pages.update(rows, selected), {start, end, total} = pages.position;
      nav.hidden = total <= 20;
      buttons[0].disabled = buttons[1].disabled = start === 0;
      buttons[2].disabled = end >= total;
      label.textContent = `${total ? start + 1 : 0}–${end} of ${total} · 20 per page`;
      return result;
    },
    destroy() { nav.remove(); },
  };
}

// Separate model lanes share row heights without cropping either original.
// Only visible lane grids participate; resizing and expanded details remeasure.
export function mountProductionAlignment({ root = document } = {}) {
  const grids = [...root.querySelectorAll('.stream-grid')];
  let frame = 0, width = -1, destroyed = false;
  const sync = () => {
    frame = 0;
    if (destroyed || !grids.every(grid => grid.getClientRects().length)) return;
    grids.forEach(grid => grid.style.removeProperty('grid-template-rows'));
    const rows = new Map();
    for (const grid of grids) {
      const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
      [...grid.children].forEach((card, index) => {
        const row = Math.floor(index / columns);
        rows.set(row, Math.max(rows.get(row) || 0, card.getBoundingClientRect().height));
      });
    }
    const tracks = [...rows.values()].map(height => `${Math.ceil(height)}px`).join(' ');
    grids.forEach(grid => grid.style.gridTemplateRows = tracks);
  };
  const schedule = () => { if (!frame && !destroyed) frame = requestAnimationFrame(sync); };
  const mutations = new MutationObserver(schedule);
  grids.forEach(grid => mutations.observe(grid, { childList: true, subtree: true, characterData: true }));
  const visibility = new MutationObserver(schedule);
  const panel = root.querySelector('#stream-panel');
  if (panel) visibility.observe(panel, { attributes: true, attributeFilter: ['hidden', 'class'], subtree: true });
  visibility.observe(document.documentElement, { attributes: true, attributeFilter: ['data-workspace', 'data-boot-tab'] });
  const resize = new ResizeObserver(entries => {
    const next = entries.map(entry => entry.contentRect.width).join(':');
    if (next !== width) { width = next; schedule(); }
  });
  grids.forEach(grid => resize.observe(grid));
  root.addEventListener('toggle', schedule, true);
  schedule();
  return { destroy() { destroyed = true; cancelAnimationFrame(frame); mutations.disconnect(); visibility.disconnect(); resize.disconnect(); root.removeEventListener('toggle', schedule, true); grids.forEach(grid => grid.style.removeProperty('grid-template-rows')); } };
}
