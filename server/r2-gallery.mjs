import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { galleryPage } from './gallery-pagination.mjs';
import { withImageNames } from './image-names.mjs';

const PREFIX = 'artwork-comparison/2026-10-17-flux-study/';
const PROFILES = new Set(['flux1-dev', 'flux2-dev-nf4']);
const CREDENTIAL_FILE = new URL('../.runtime/migration/r2-credentials.json', import.meta.url);
let client;
let bucket;
let cached;
let cachedAt = 0;
let pending;

function storage() {
  if (client) return client;
  let local = {};
  if (!['ENDPOINT', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY', 'BUCKET'].every(name => process.env['ARTWORK_R2_' + name])) {
    try { local = JSON.parse(readFileSync(CREDENTIAL_FILE, 'utf8')); } catch { /* Environment configuration may supply the credentials. */ }
  }
  const setting = name => process.env['ARTWORK_R2_' + name] || local['R2_' + name];
  const endpoint = setting('ENDPOINT');
  const accessKeyId = setting('ACCESS_KEY_ID');
  const secretAccessKey = setting('SECRET_ACCESS_KEY');
  bucket = setting('BUCKET');
  if (![endpoint, accessKeyId, secretAccessKey, bucket].every(value => typeof value === 'string' && value)) throw new Error('r2_unconfigured');
  client = new S3Client({ region: 'auto', endpoint, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey }, maxAttempts: 2 });
  return client;
}

async function object(key, limit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const connection = storage();
    const response = await connection.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: controller.signal });
    if (!response.Body || response.ContentLength > limit) { response.Body?.destroy?.(); throw new Error('object_size'); }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.Body) {
      bytes += chunk.length;
      if (bytes > limit) { response.Body.destroy?.(); throw new Error('object_size'); }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } finally { clearTimeout(timer); }
}

function sanitize(row) {
  if (!row || !PROFILES.has(row.profile) || !/^[A-Za-z0-9_-]{1,100}$/.test(row.id || '') || !/^[a-f0-9]{64}$/.test(row.sha256 || '')) return null;
  const imageKey = `${PREFIX}${row.profile}/${row.id}/result.png`;
  if (row.imageKey !== imageKey) return null;
  const settings = {};
  for (const name of ['seed', 'steps', 'guidance_scale', 'max_sequence_length']) if (Number.isFinite(row.settings?.[name])) settings[name] = row.settings[name];
  return {
    id: row.id, profile: row.profile, scene: typeof row.scene === 'string' ? row.scene.slice(0, 200) : '',
    prompt: typeof row.prompt === 'string' ? row.prompt.slice(0, 20000) : '',
    width: Number.isFinite(row.width) ? row.width : null, height: Number.isFinite(row.height) ? row.height : null,
    settings, seconds: Number.isFinite(row.seconds) ? row.seconds : null,
    sha256: row.sha256, imageKey, imageUrl: '/api/gallery/image?key=' + encodeURIComponent(imageKey),
    created: typeof row.created === 'string' || Number.isFinite(row.created) ? row.created : null,
  };
}

export async function collectArchiveGallery() {
  if (cached && Date.now() - cachedAt < 1500) return withImageNames(cached);
  if (!pending) pending = (async () => {
    const data = JSON.parse((await object(PREFIX + 'index.json', 16 * 1024 * 1024)).toString('utf8'));
    if (!Array.isArray(data.jobs)) throw new Error('invalid_index');
    cached = { ok: true, updatedAt: data.updatedAt || null, jobs: data.jobs.map(sanitize).filter(Boolean) };
    cachedAt = Date.now();
    return withImageNames(cached);
  })().finally(() => { pending = null; });
  return pending.then(withImageNames);
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

// Public, read-only archive; object access is restricted to sanitized index entries.
export function installGallery(server) {
  server.middlewares.use(async (req, res, next) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { next(); return; }
    if (!['/api/gallery', '/api/gallery/image'].includes(url.pathname)) { next(); return; }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); json(res, 405, { ok: false }); return; }
    try {
      const image = url.pathname === '/api/gallery/image' || url.searchParams.has('image');
      const keys = url.searchParams.getAll('key');
      if (image && (keys.length !== 1 || keys[0].length > 300 || !keys[0].startsWith(PREFIX) || keys[0].includes('..'))) { json(res, 404, { ok: false }); return; }
      const collection = await collectArchiveGallery();
      if (!image) {
        try { json(res, 200, galleryPage(collection, url.searchParams)); }
        catch { json(res, 400, { ok: false, problem: 'Invalid gallery page.' }); }
        return;
      }
      const row = collection.jobs.find(item => item.imageKey === keys[0]);
      if (!row) { json(res, 404, { ok: false }); return; }
      const tag = '"' + row.sha256 + '"';
      const conditional = req.headers['if-none-match'];
      if (typeof conditional === 'string' && conditional.split(',').some(value => value.trim().replace(/^W\//, '') === tag || value.trim() === '*')) {
        res.setHeader('ETag', tag);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.statusCode = 304; res.end(); return;
      }
      const png = await object(row.imageKey, 25000000);
      if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || createHash('sha256').update(png).digest('hex') !== row.sha256) throw new Error('image_integrity');
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Length', String(png.length));
      res.setHeader('ETag', tag);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.statusCode = 200;
      res.end(png);
    } catch {
      if (res.headersSent) { res.destroy(); return; }
      json(res, 503, { ok: false, problem: 'The image stream is reconnecting.' });
    }
  });
}
