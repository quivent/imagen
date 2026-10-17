// Private file-event bridge. Watches the Performance engineer, not the site.
// No HTTP requests, WebSockets, gallery subscriptions, images or model calls.
import { watch } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../.runtime/monitor/', import.meta.url));
let reading = false;
let dirty = false;
async function observe() {
  if (reading) { dirty = true; return; }
  reading = true;
  let agents = { ok: false, live: false, observedAt: null, agents: [] };
  try {
    if ((await stat(directory + 'status.json')).size > 256 * 1024) throw new Error('Oversized observation');
    const source = JSON.parse(await readFile(directory + 'status.json', 'utf8')).agents;
    agents = { ok: source?.ok === true, live: source?.live === true, observedAt: source?.observedAt,
      agents: Array.isArray(source?.agents) ? source.agents.filter(row => row.id === '/root/performance').map(row => ({ id: row.id, status: row.status, lastTransitionAt: row.lastTransitionAt })) : [] };
  } catch { /* Unknown lifecycle is never assumed idle. */ }
  if (process.stdout.writableLength > 256 * 1024) process.exit(1);
  process.stdout.write(JSON.stringify({ type: 'sample', observedAt: new Date().toISOString(), lifecycle: { agents } }) + '\n');
  reading = false;
  if (dirty) { dirty = false; void observe(); }
}
const watcher = watch(directory, (_event, name) => { if (name === 'status.json') void observe(); });
watcher.on('error', () => process.exit(1));
void observe();
const stop = () => { watcher.close(); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
