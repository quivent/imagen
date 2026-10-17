const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const PREFIX = 'artwork-comparison/2026-10-17-flux-study/';
const PROFILES = new Set(['flux1-dev', 'flux2-dev-nf4']);
let client;
let cached;
let cachedAt = 0;

function storage() {
  if (!client) client = new S3Client({
    region: 'auto', endpoint: process.env.ARTWORK_R2_ENDPOINT, forcePathStyle: true,
    credentials: { accessKeyId: process.env.ARTWORK_R2_ACCESS_KEY_ID, secretAccessKey: process.env.ARTWORK_R2_SECRET_ACCESS_KEY },
    maxAttempts: 2,
  });
  return client;
}

async function object(key, limit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await storage().send(new GetObjectCommand({ Bucket: process.env.ARTWORK_R2_BUCKET, Key: key }), { abortSignal: controller.signal });
    if (response.ContentLength > limit) { response.Body.destroy(); throw new Error('oversize'); }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.Body) {
      bytes += chunk.length;
      if (bytes > limit) { response.Body.destroy(); throw new Error('oversize'); }
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
  for (const name of ['seed', 'steps', 'guidance_scale', 'max_sequence_length']) {
    if (Number.isFinite(row.settings?.[name])) settings[name] = row.settings[name];
  }
  return {
    id: row.id, profile: row.profile, scene: typeof row.scene === 'string' ? row.scene.slice(0, 200) : '',
    prompt: typeof row.prompt === 'string' ? row.prompt.slice(0, 20000) : '',
    width: Number.isFinite(row.width) ? row.width : null, height: Number.isFinite(row.height) ? row.height : null,
    settings, seconds: Number.isFinite(row.seconds) ? row.seconds : null,
    sha256: row.sha256, imageKey, imageUrl: '/api/gallery/image?key=' + encodeURIComponent(imageKey),
    created: typeof row.created === 'string' || Number.isFinite(row.created) ? row.created : null,
  };
}

async function index() {
  if (cached && Date.now() - cachedAt < 1500) return cached;
  const data = JSON.parse((await object(PREFIX + 'index.json', 5000000)).toString('utf8'));
  if (!Array.isArray(data.jobs)) throw new Error('invalid_index');
  cached = { ok: true, updatedAt: data.updatedAt || null, jobs: data.jobs.map(sanitize).filter(Boolean) };
  cachedAt = Date.now();
  return cached;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  try {
    const collection = await index();
    if (!req.query.image) return res.status(200).json(collection);
    const key = typeof req.query.key === 'string' ? req.query.key : '';
    const row = collection.jobs.find(item => item.imageKey === key);
    if (!row) return res.status(404).json({ ok: false });
    const tag = '"' + row.sha256 + '"';
    if (req.headers['if-none-match'] === tag) {
      res.setHeader('ETag', tag);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.status(304).end();
    }
    const png = await object(row.imageKey, 25000000);
    if (crypto.createHash('sha256').update(png).digest('hex') !== row.sha256 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('image_integrity');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('ETag', tag);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.status(200);
    await pipeline(Readable.from((function* () {
      for (let offset = 0; offset < png.length; offset += 65536) yield png.subarray(offset, offset + 65536);
    })()), res);
  } catch {
    if (res.headersSent) { res.destroy(); return; }
    return res.status(503).json({ ok: false, problem: 'The image stream is reconnecting.' });
  }
};
