import { existsSync } from 'node:fs';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { authorized } from './native-live.mjs';

const profiles = ['flux1-dev', 'flux2-dev-nf4'];
const legacy = path.join(os.homedir(), 'kinship-of-cancer/tools/artwork/.state');
const factory = process.env.ARTWORK_FACTORY_STATE || (existsSync(legacy) ? legacy :
  fileURLToPath(new URL('../deployment/controller/tools/artwork/.state/', import.meta.url)));
const directory = path.join(factory, 'generation-refill');
const filename = path.join(directory, 'settings.json');

function validate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'modelSteps')) throw new Error('Invalid settings');
  const steps = value.modelSteps;
  if (!steps || typeof steps !== 'object' || Array.isArray(steps) || Object.keys(steps).length !== profiles.length ||
      !profiles.every(profile => Object.hasOwn(steps, profile) && Number.isInteger(steps[profile]) && steps[profile] >= 1 && steps[profile] <= 60)) throw new Error('Invalid steps');
  return { modelSteps: Object.fromEntries(profiles.map(profile => [profile, steps[profile]])) };
}
async function current() {
  try {
    const file = await open(filename, 'r');
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > 4096) throw new Error('Invalid settings file');
      return validate(JSON.parse(await file.readFile('utf8')));
    } finally { await file.close(); }
  } catch (error) {
    if (error.code === 'ENOENT') return { modelSteps: Object.fromEntries(profiles.map(profile => [profile, 28])) };
    throw error;
  }
}
async function persist(value) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, '.settings-' + randomUUID() + '.tmp');
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(value) + '\n'); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, filename);
    const folder = await open(directory, 'r');
    try { await folder.sync(); } finally { await folder.close(); }
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
function jsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', chunk => {
      size += chunk.length;
      if (size > 4096) { const error = new Error('Request too large'); error.status = 413; reject(error); return; }
      chunks.push(chunk);
    });
    request.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('Invalid JSON')); } });
    request.on('error', reject);
  });
}
function sameOrigin(request, server) {
  try {
    const origin = new URL(request.headers.origin);
    if (origin.origin !== request.headers.origin) return false;
    if (origin.origin === 'https://artwork.influx.vision') return true;
    return origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname) &&
      [server.config.server.port, server.config.preview.port].map(String).includes(origin.port);
  } catch { return false; }
}
export function installGenerationSteps(server) {
  server.middlewares.use((request, response, next) => {
    let url;
    try { url = new URL(request.url, 'http://localhost'); } catch { return next(); }
    if (url.pathname !== '/api/generation-steps') return next();
    const send = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(value)); };
    void (async () => {
      if (!['GET', 'POST'].includes(request.method)) { response.setHeader('Allow', 'GET, POST'); send(405, { ok: false }); return; }
      if (!await authorized(request)) { send(403, { ok: false, problem: 'Open Controls with your access key.' }); return; }
      if (request.method === 'GET') { send(200, { ok: true, ...await current() }); return; }
      if (!sameOrigin(request, server)) { send(403, { ok: false }); return; }
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) { send(415, { ok: false }); return; }
      let settings;
      try { settings = validate(await jsonBody(request)); }
      catch (error) { send(error.status || 400, { ok: false, problem: 'Choose whole step counts from 1 to 60 for both models.' }); return; }
      await persist(settings);
      send(200, { ok: true, ...settings });
    })().catch(() => send(503, { ok: false, problem: 'Step settings could not be confirmed.' }));
  });
}
