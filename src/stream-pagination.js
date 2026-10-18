export function mountStreamPagination({ profiles, jobs, render }) {
  const pages = new Map(profiles.map(profile => [profile, { history: [], data: null, busy: false }]));
  const controls = new Map();
  const cursorFor = row => btoa(JSON.stringify({ created: typeof row.created === 'number' ? row.created : Date.parse(row.created) / 1000 || 0, profile: row.profile, id: row.id })).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  async function load(profile, cursor, history) {
    const page = pages.get(profile);
    if (page.busy) return;
    page.busy = true; update(profile);
    try {
      const params = new URLSearchParams({ profile, limit: '18' });
      if (cursor) params.set('cursor', cursor);
      const response = await fetch('/api/gallery?' + params, { signal: AbortSignal.timeout(20000), cache: 'no-store' });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!data.ok || !Array.isArray(data.jobs)) throw new Error();
      page.data = data; page.history = history;
      controls.get(profile).note.textContent = '';
      render();
    } catch { controls.get(profile).note.textContent = 'Could not load this page. Try again.'; }
    finally { page.busy = false; update(profile); }
  }
  function update(profile) {
    const page = pages.get(profile), ui = controls.get(profile);
    ui.previous.disabled = page.busy || !page.history.length;
    ui.next.disabled = page.busy || (page.data ? !page.data.nextCursor : jobs(profile).length < 18);
    ui.label.textContent = page.busy ? 'Loading…' : `Page ${page.history.length + 1}`;
    ui.latest.disabled = page.busy || !page.history.length;
    ui.latest.setAttribute('aria-current', page.history.length ? 'false' : 'page');
  }
  for (const profile of profiles) {
    const nav = document.createElement('nav'); nav.className = 'stream-pagination'; nav.setAttribute('aria-label', `${profile === 'flux1-dev' ? 'FLUX.1' : 'FLUX.2'} image pages`);
    const button = label => { const node = document.createElement('button'); node.type = 'button'; node.textContent = label; return node; };
    const previous = button('Newer'), next = button('Older'), latest = button('Latest');
    const label = document.createElement('span'), note = document.createElement('span'); label.className = 'stream-page-label'; note.className = 'stream-page-note'; note.setAttribute('role', 'status');
    controls.set(profile, { previous, next, latest, label, note });
    previous.onclick = () => {
      const page = pages.get(profile), history = page.history.slice(0, -1);
      if (!history.length) { page.history = []; page.data = null; render(); update(profile); }
      else void load(profile, history.at(-1), history);
    };
    next.onclick = () => {
      const page = pages.get(profile), cursor = page.data?.nextCursor || (jobs(profile).at(-1) && cursorFor(jobs(profile).at(-1)));
      if (cursor) void load(profile, cursor, [...page.history, cursor]);
    };
    latest.onclick = () => { const page = pages.get(profile); if (page.busy) return; page.history = []; page.data = null; render(); update(profile); };
    const buttons = document.createElement('div'); buttons.className = 'stream-page-buttons';
    buttons.append(previous, latest, next);
    nav.append(buttons, label, note);
    document.getElementById(`stream-grid-${profile}`).after(nav); update(profile);
  }
  return {
    jobs: profile => pages.get(profile).data?.jobs ?? jobs(profile),
    update: () => profiles.forEach(update),
  };
}
