// The working studio keeps its tools. Only the Vercel public site starts compact.
(() => {
  const query = new URLSearchParams(location.search);
  const control = new URLSearchParams(location.hash.slice(1)).has('control');
  const publicSite = (location.hostname || '').endsWith('.vercel.app');
  let active = query.get('studio') === '1' || control;
  if (publicSite) {
    try {
      if (query.has('studio') || control) sessionStorage.setItem('imagen:vercel-studio-active', active ? '1' : '0');
      else active = sessionStorage.getItem('imagen:vercel-studio-active') === '1';
    } catch { /* Explicit studio links also work without browser storage. */ }
  }
  document.documentElement.dataset.studioMode = !publicSite || active ? 'studio' : 'public';
  document.addEventListener?.('DOMContentLoaded', () => {
    const mark = document.querySelector('.brand .mark');
    if (!mark) return;
    const trigger = document.createElement('button');
    trigger.type = 'button'; trigger.className = 'mark studio-door-trigger';
    trigger.textContent = mark.textContent;
    trigger.setAttribute('aria-label', 'Open studio switcher');
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.title = 'Studio switcher · ⌘K / Ctrl K';
    mark.replaceWith(trigger);
    const door = document.createElement('dialog');
    door.className = 'studio-door';
    door.setAttribute('aria-labelledby', 'studio-door-title');
    door.innerHTML = '<header><div><span class="studio-door-kicker">IMAGEN</span><h2 id="studio-door-title">Your place in the studio.</h2></div><button type="button" class="studio-door-close" aria-label="Close studio switcher">×</button></header><button type="button" class="studio-door-option" data-mode="public"><span class="studio-door-symbol" aria-hidden="true">◐</span><span><strong>Public view</strong><small>The artwork, the Seers, the worlds.</small></span><span class="studio-door-check" aria-hidden="true">✓</span></button><button type="button" class="studio-door-option" data-mode="studio"><span class="studio-door-symbol" aria-hidden="true">◒</span><span><strong>Working studio</strong><small>Your controls, tasks and every live instrument.</small></span><span class="studio-door-check" aria-hidden="true">✓</span></button><p class="studio-door-hint">Open this switcher with <kbd>⌘K</kbd> or <kbd>Ctrl K</kbd>. Your tools keep their existing authentication.</p>';
    document.body.append(door);
    const options = [...door.querySelectorAll('[data-mode]')];
    const open = () => {
      for (const option of options) option.setAttribute('aria-pressed', String(option.dataset.mode === document.documentElement.dataset.studioMode));
      if (!door.open) door.showModal();
    };
    trigger.addEventListener('click', open);
    door.querySelector('.studio-door-close').addEventListener('click', () => door.close());
    door.addEventListener('click', event => { if (event.target === door) { const box = door.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) door.close(); } });
    for (const option of options) option.addEventListener('click', () => {
      const mode = option.dataset.mode;
      document.documentElement.dataset.studioMode = mode;
      try { sessionStorage.setItem('imagen:vercel-studio-active', mode === 'studio' ? '1' : '0'); } catch { /* Current choice still applies. */ }
      const url = new URL(location.href); url.searchParams.delete('studio');
      history.replaceState(null, '', url);
      if (mode === 'public' && document.querySelector('.studio-tab-buttons [aria-selected="true"]')?.getClientRects().length === 0) document.getElementById('tab-worlds')?.click();
      door.close(); trigger.focus();
    });
    document.addEventListener('keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (door.open) door.close(); else open(); }
    });
  }, { once: true });
})();
