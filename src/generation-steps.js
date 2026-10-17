const profiles = ['flux1-dev', 'flux2-dev-nf4'];
const valid = values => values && profiles.every(profile => Number.isInteger(values[profile]) && values[profile] >= 1 && values[profile] <= 60);
export function createGenerationSteps({ read, apply, status, request = fetch }) {
  let revision = 0;
  let pending = false;
  let writing = null;
  async function load() {
    const started = revision;
    try {
      const response = await request('/api/generation-steps', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return;
      const value = await response.json();
      if (started === revision && !pending && valid(value.modelSteps)) apply(value.modelSteps);
    } catch { /* A failed read never replaces the user's current choices. */ }
  }
  function save() {
    revision++;
    pending = true;
    if (writing) return writing;
    writing = (async () => {
      while (pending) {
        const sent = revision;
        const modelSteps = { ...read() };
        if (!valid(modelSteps)) { status('Use whole step counts from 1 to 60.'); return; }
        status('Saving steps…');
        try {
          const response = await request('/api/generation-steps', { method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelSteps }) });
          if (!response.ok) { status(response.status === 403 ? 'Open Controls to apply these steps.' : 'Steps were not applied. Try again.'); return; }
          const value = await response.json();
          if (value.ok !== true || !valid(value.modelSteps)) throw new Error('Unconfirmed steps');
          if (sent === revision) {
            pending = false;
            apply(value.modelSteps);
            status(`Next images: FLUX.1 ${value.modelSteps['flux1-dev']} steps · FLUX.2 ${value.modelSteps['flux2-dev-nf4']} steps. Queued images keep their settings.`);
          }
        } catch { status('Steps were not applied. Try again.'); return; }
      }
    })().finally(() => { writing = null; });
    return writing;
  }
  return { load, save, retry: () => pending ? save() : load() };
}
