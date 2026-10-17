import { constants, existsSync, watch } from 'node:fs';
import { lstat, readdir, realpath, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const execute = promisify(execFile);
const legacyState = path.join(os.homedir(), 'kinship-of-cancer/tools/artwork/.state');
const state = path.resolve(process.env.ARTWORK_FACTORY_STATE || (existsSync(legacyState) ? legacyState :
  fileURLToPath(new URL('../deployment/controller/tools/artwork/.state/', import.meta.url))));
const work = path.join(state, 'work');
const helper = fileURLToPath(new URL('../scripts/local_gallery.py', import.meta.url));
const profiles = new Set(['flux1-dev', 'flux2-dev-nf4']);
const identifier = /^[A-Za-z0-9_-]{1,100}$/;
const digest = /^[a-f0-9]{64}$/;
const nonArtwork = /(?:^|[^a-z0-9])(?:proof|benchmark|migration|synthetic|smoke[-_ ]?test|test)(?:$|[^a-z0-9])/i;
const pngSignature = '89504e470d0a1a0a';
const entries = new Map();
const directoryCache = new Map();
const listeners = new Set();
let collection = { updatedAt: null, jobs: [] };
let metadata = {};
let metadataAt = 0;
let running;
let pending = false;
let started = false;
let debounce;
let watcher;

function fingerprint(stat) {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}

async function regularFile(filename, maximum) {
  const stat = await lstat(filename, { bigint: true });
  if (!stat.isFile() || stat.size <= 0n || stat.size > BigInt(maximum)) throw new Error('Invalid artwork file');
  return stat;
}

async function readRegular(filename, maximum) {
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size <= 0n || before.size > BigInt(maximum)) throw new Error('Invalid artwork file');
    const bytes = await file.readFile();
    const after = await file.stat({ bigint: true });
    if (fingerprint(before) !== fingerprint(after) || bytes.length !== Number(after.size)) throw new Error('Artwork changed during read');
    return { bytes, stat: after };
  } finally { await file.close(); }
}

async function refreshMetadata() {
  if (Date.now() - metadataAt < 1500) return;
  const result = await execute(process.env.ARTWORK_PYTHON || 'python3', ['-I', '-B', helper], {
    env: { ...process.env, ARTWORK_FACTORY_STATE: state }, timeout: 5000, maxBuffer: 8 * 1024 * 1024,
  });
  const value = JSON.parse(result.stdout);
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Invalid factory metadata');
  metadata = value;
  metadataAt = Date.now();
}

async function inspectDirectory(name) {
  if (!identifier.test(name)) return null;
  const directory = path.join(work, name);
  try {
    const directoryStat = await lstat(directory);
    if (!directoryStat.isDirectory() || await realpath(directory) !== directory) return null;
    const recordFile = path.join(directory, 'generation.json');
    const imageFile = path.join(directory, 'result.png');
    const [recordStat, imageStat] = await Promise.all([
      regularFile(recordFile, 1024 * 1024), regularFile(imageFile, 25 * 1024 * 1024),
    ]);
    const signature = fingerprint(recordStat) + '/' + fingerprint(imageStat);
    const previous = directoryCache.get(name);
    if (previous?.signature === signature) {
      const row = previous.entry.row;
      const details = metadata[row.id];
      if (details?.model === row.profile && details.scene === row.scene &&
          !nonArtwork.test([row.id, details.scene, details.name].join(' '))) return previous;
    }
    const { bytes: recordBytes } = await readRegular(recordFile, 1024 * 1024);
    const record = JSON.parse(recordBytes.toString('utf8'));
    const generation = record.generation;
    if (!generation || !identifier.test(generation.id || '') || !profiles.has(generation.profile) || !digest.test(generation.sha256 || '')) return null;
    const details = metadata[generation.id];
    if (!details || details.model !== generation.profile || nonArtwork.test([generation.id, details.scene, details.name].join(' '))) return null;
    if (record.source !== imageFile || record.remote?.job !== generation.id || record.remote?.profile !== generation.profile) return null;
    if (generation.source !== `/workspace/artwork/jobs/${generation.profile}/${generation.id}/result.png`) return null;
    const { bytes, stat } = await readRegular(imageFile, 25 * 1024 * 1024);
    if (bytes.subarray(0, 8).toString('hex') !== pngSignature || createHash('sha256').update(bytes).digest('hex') !== generation.sha256) return null;
    const parameters = generation.parameters || {};
    const width = generation.width ?? parameters.width;
    const height = generation.height ?? parameters.height;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
        typeof generation.prompt !== 'string' || !Number.isFinite(generation.created)) return null;
    const settings = {};
    for (const [key, value] of Object.entries({ seed: generation.seed, steps: parameters.num_inference_steps,
      guidance_scale: parameters.guidance_scale, max_sequence_length: parameters.max_sequence_length })) {
      if (Number.isFinite(value)) settings[key] = value;
    }
    const row = { id: generation.id, profile: generation.profile, scene: details.scene || '',
      prompt: generation.prompt, width, height, settings,
      seconds: Number.isFinite(generation.generation_seconds) ? generation.generation_seconds : null,
      sha256: generation.sha256,
      imageUrl: `/api/local-gallery/image?job=${encodeURIComponent(generation.id)}&sha256=${generation.sha256}`,
      created: generation.created };
    return { signature, entry: { row, file: imageFile, fingerprint: fingerprint(stat) } };
  } catch { return null; }
}

async function scan() {
  // Metadata failure retains the last verified collection; it never serves arbitrary state files.
  await refreshMetadata();
  if (await realpath(work) !== work) throw new Error('Factory work path must be direct');
  const names = (await readdir(work, { withFileTypes: true })).filter(item => item.isDirectory() && identifier.test(item.name)).map(item => item.name);
  const nextDirectories = new Map();
  const nextEntries = new Map();
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(12, names.length) }, async () => {
    while (cursor < names.length) {
      const name = names[cursor++];
      const item = await inspectDirectory(name);
      if (!item) continue;
      nextDirectories.set(name, item);
      const old = nextEntries.get(item.entry.row.id);
      if (!old || item.entry.row.created > old.row.created) nextEntries.set(item.entry.row.id, item.entry);
    }
  }));
  const jobs = [...nextEntries.values()].map(item => item.row).sort((a, b) => b.created - a.created || a.id.localeCompare(b.id));
  const changed = JSON.stringify(collection.jobs) !== JSON.stringify(jobs);
  directoryCache.clear();
  for (const [name, item] of nextDirectories) directoryCache.set(name, item);
  entries.clear();
  for (const [id, item] of nextEntries) entries.set(id, item);
  if (changed) {
    collection = { updatedAt: new Date().toISOString(), jobs };
    for (const listener of listeners) { try { listener(); } catch {} }
  }
}

function refresh() {
  if (running) { pending = true; return running; }
  running = scan().catch(() => {}).finally(() => {
    running = null;
    if (pending) { pending = false; void refresh(); }
  });
  return running;
}

function start() {
  if (started) return;
  started = true;
  void refresh();
  try {
    watcher = watch(work, { recursive: true }, (_event, filename) => {
      if (!filename || !/(?:^|\/)generation\.json$/.test(String(filename))) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => { metadataAt = 0; void refresh(); }, 75);
      debounce.unref();
    });
    watcher.unref();
    watcher.on('error', () => { watcher?.close(); watcher = null; });
  } catch {} // A missing factory is reported as an empty collection; no polling fallback.
}

export async function collectLocalGallery() {
  start();
  if (running) await running;
  return { updatedAt: collection.updatedAt, jobs: collection.jobs.map(row => ({ ...row, settings: { ...row.settings } })) };
}

export function subscribeLocalGallery(listener) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function installLocalGallery(server) {
  start();
  server.httpServer?.once('close', () => { watcher?.close(); clearTimeout(debounce); started = false; listeners.clear(); });
  server.middlewares.use((req, res, next) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return next(); }
    if (url.pathname !== '/api/local-gallery/image') return next();
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
    const id = url.searchParams.get('job') || '';
    const hash = url.searchParams.get('sha256') || '';
    if (!identifier.test(id) || !digest.test(hash) || url.searchParams.size !== 2) { res.writeHead(404).end(); return; }
    void (async () => {
      const entry = entries.get(id);
      if (!entry || entry.row.sha256 !== hash) throw new Error('Unknown local image');
      if (await realpath(path.dirname(entry.file)) !== path.dirname(entry.file)) throw new Error('Unsafe artwork path');
      const { bytes, stat } = await readRegular(entry.file, 25 * 1024 * 1024);
      if (fingerprint(stat) !== entry.fingerprint || createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('Artwork identity changed');
      const tag = '"' + hash + '"';
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('ETag', tag);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.headers['if-none-match'] === tag) { res.writeHead(304).end(); return; }
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Length', bytes.length);
      res.writeHead(200);
      res.end(req.method === 'HEAD' ? undefined : bytes);
    })().catch(() => { if (!res.headersSent) res.writeHead(404).end(); else res.destroy(); });
  });
}
