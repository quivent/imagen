(() => {
  const tabs = ['stream', 'gallery', 'controls', 'tasks', 'performance', 'models', 'seers', 'worlds', 'workbench', 'research', 'metrics', 'winners', 'agents', 'daemons', 'rules', 'protocol', 'monitor', 'workbench-controls', 'workbench-tasks', 'workbench-agents', 'archive', 'qwen', 'pixtral-chat', 'prompt-comparison'];
  const query = new URLSearchParams(location.search);
  const path = (location.pathname || '').replace(/^\/|\/$/g, '');
  const requested = ({ compare: 'gallery', collections: 'winners', active: 'stream', 'workbench/controls':'workbench-controls', 'workbench/tasks':'workbench-tasks', 'workbench/agents':'workbench-agents', 'gallery/studio':'archive' })[path] || (tabs.includes(path) ? path : query.get('tab'));
  const tab = new URLSearchParams(location.hash.slice(1)).has('control') ? 'controls'
    : tabs.includes(requested) ? requested : query.has('comparison') ? 'gallery' : 'stream';
  document.documentElement.dataset.bootTab = tab;
  let workspace = 'production';
  try { workspace = localStorage.getItem('imagen:workspace') || workspace; } catch {}
  const workbench = ['workbench','research','workbench-controls','workbench-tasks','workbench-agents'];
  if(tab==='archive') workspace='gallery';
  else if(tab==='worlds') workspace='worlds';
  else if (workbench.includes(tab)) workspace = 'workbench';
  else if (!['stream','gallery','qwen','pixtral-chat'].includes(tab)||['gallery','worlds'].includes(workspace)) workspace = 'production';
  document.documentElement.dataset.workspace = ['gallery','workbench','worlds'].includes(workspace) ? workspace : 'production';
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
