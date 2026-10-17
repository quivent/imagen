// Shared wire format: complete archive once, then changes against the last
// archive actually sent to each connection. Never truncate the archive.
const indexes = new WeakMap();
const key = row => `${row.profile || ''}:${row.id}`;
export function recentGallery(data, limit = 18) {
  const profiles = ['flux1-dev', 'flux2-dev-nf4'];
  const counts = Object.fromEntries(profiles.map(profile => [profile, 0]));
  const latest = Object.fromEntries(profiles.map(profile => [profile, []]));
  const time = row => typeof row.created === 'number' ? row.created : Date.parse(row.created) / 1000 || 0;
  for (const row of data.jobs) {
    if (!profiles.includes(row.profile)) continue;
    counts[row.profile]++;
    const rows = latest[row.profile];
    const position = rows.findIndex(previous => time(row) > time(previous));
    if (position >= 0) rows.splice(position, 0, row);
    else if (rows.length < limit) rows.push(row);
    if (rows.length > limit) rows.pop();
  }
  return { ...data, jobs: profiles.flatMap(profile => latest[profile]), counts, totalJobs: data.jobs.length };
}
function index(data) {
  if (!indexes.has(data)) indexes.set(data, new Map(data.jobs.map(row => [key(row), JSON.stringify(row)])));
  return indexes.get(data);
}
export function createGalleryPatch(previous, next) {
  const before = index(previous.data);
  const after = index(next.data);
  const upserts = next.data.jobs.flatMap((job, position) => before.get(key(job)) === after.get(key(job)) ? [] : [{ index: position, job }]);
  const changed = new Set(upserts.map(item => key(item.job)));
  const removed = [...before.keys()].filter(id => !after.has(id));
  const retainedBefore = [...before.keys()].filter(id => after.has(id) && !changed.has(id));
  const retainedAfter = [...after.keys()].filter(id => before.has(id) && !changed.has(id));
  const { jobs, ...metadata } = next.data;
  const patch = { type: 'patch', topic: 'gallery', baseVersion: previous.version, version: next.version, observedAt: next.observedAt, metadata, upserts, removed };
  // Ordinary insertions preserve relative order. An explicit order is needed
  // only when an archive reconciliation reorders otherwise unchanged rows.
  if (retainedBefore.some((id, position) => id !== retainedAfter[position])) patch.order = [...after.keys()];
  return patch;
}
export function applyGalleryPatch(previous, patch) {
  if (!previous?.available || previous.version !== patch.baseVersion || !Number.isInteger(patch.version) || patch.version <= patch.baseVersion ||
      !Array.isArray(previous.data?.jobs) || !Array.isArray(patch.upserts) || !Array.isArray(patch.removed) || !patch.metadata || typeof patch.metadata !== 'object' || Array.isArray(patch.metadata)) throw new Error('Gallery patch requires a current baseline');
  const changed = new Set();
  const upserts = [...patch.upserts].sort((a, b) => a.index - b.index);
  for (const item of upserts) {
    if (!item.job || typeof item.job.id !== 'string' || !Number.isInteger(item.index) || item.index < 0 || changed.has(key(item.job))) throw new Error('Invalid gallery update');
    changed.add(key(item.job));
  }
  if (patch.removed.some(id => typeof id !== 'string')) throw new Error('Invalid gallery removal');
  const removed = new Set(patch.removed);
  let jobs = previous.data.jobs.filter(row => !removed.has(key(row)) && !changed.has(key(row)));
  for (const item of upserts) {
    if (item.index > jobs.length) throw new Error('Invalid gallery position');
    jobs.splice(item.index, 0, item.job);
  }
  if (patch.order) {
    if (!Array.isArray(patch.order) || patch.order.length !== jobs.length || new Set(patch.order).size !== jobs.length) throw new Error('Invalid gallery ordering');
    const rows = new Map(jobs.map(row => [key(row), row]));
    jobs = patch.order.map(id => { if (!rows.has(id)) throw new Error('Unknown gallery row'); return rows.get(id); });
  }
  return { type: 'snapshot', topic: 'gallery', version: patch.version, observedAt: patch.observedAt, available: true, data: { ...patch.metadata, jobs } };
}
