(() => {
  const tabs = ['stream', 'gallery', 'controls', 'tasks', 'performance', 'models', 'seers', 'worlds', 'metrics', 'winners', 'agents', 'daemons', 'rules', 'protocol', 'monitor'];
  const query = new URLSearchParams(location.search);
  const requested = query.get('tab');
  const tab = new URLSearchParams(location.hash.slice(1)).has('control') ? 'controls'
    : tabs.includes(requested) ? requested : query.has('comparison') ? 'gallery' : 'stream';
  document.documentElement.dataset.bootTab = tab;
  let workMode = true;
  let detailsVisible = false;
  try {
    detailsVisible = localStorage.getItem('artwork-comparison:show-details') === 'true';
  } catch { /* Compact mode is the default when storage is unavailable. */ }
  const select = () => {
    if (document.body) {
      document.body.classList.toggle('work-mode', workMode);
      document.body.classList.toggle('show-details', detailsVisible);
    }
    const detailsButton = document.getElementById('show-details');
    if (detailsButton) {
      const expanded = detailsVisible || !workMode;
      detailsButton.setAttribute('aria-expanded', String(expanded));
      const label = expanded ? 'Collapse details' : 'Expand details';
      detailsButton.setAttribute('aria-label', label);
      detailsButton.title = label;
    }
    for (const panel of document.querySelectorAll('[role="tabpanel"]')) panel.hidden = panel.id !== tab + '-panel';
    for (const button of document.querySelectorAll('[role="tab"]')) {
      const selected = button.id === 'tab-' + tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
  };
  const observer = new MutationObserver(select);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => { select(); observer.disconnect(); }, { once: true });
  window.addEventListener('artwork-ready', () => {
    observer.disconnect();
    delete document.documentElement.dataset.bootTab;
  }, { once: true });
})();
