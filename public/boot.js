(() => {
  const tabs = ['stream', 'gallery', 'controls', 'tasks', 'metrics', 'winners', 'monitor'];
  const query = new URLSearchParams(location.search);
  const requested = query.get('tab');
  const tab = new URLSearchParams(location.hash.slice(1)).has('control') ? 'controls'
    : tabs.includes(requested) ? requested : query.has('comparison') ? 'gallery' : 'stream';
  document.documentElement.dataset.bootTab = tab;
  const select = () => {
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
