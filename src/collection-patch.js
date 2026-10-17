// Ordered collection deltas shared by gallery and comparisons. Retain the
// complete collection in the client; coalesced versions may skip intermediates.
const indexes = new WeakMap();
function index(data, field, key) {
  if (!indexes.has(data)) indexes.set(data, new Map());
  const fields = indexes.get(data);
  if (!fields.has(field)) fields.set(field, new Map(data[field].map(row => [key(row), JSON.stringify(row)])));
  return fields.get(field);
}
export function createCollectionPatch(previous, next, field, key) {
  const before = index(previous.data, field, key);
  const after = index(next.data, field, key);
  // `job` is the original gallery wire field; comparisons carry the complete
  // pair object here, including exact side job IDs, hashes and provenance.
  const upserts = next.data[field].flatMap((job, position) => before.get(key(job)) === after.get(key(job)) ? [] : [{ index: position, job }]);
  const changed = new Set(upserts.map(item => key(item.job)));
  const removed = [...before.keys()].filter(id => !after.has(id));
  const retainedBefore = [...before.keys()].filter(id => after.has(id) && !changed.has(id));
  const retainedAfter = [...after.keys()].filter(id => before.has(id) && !changed.has(id));
  const { [field]: rows, ...metadata } = next.data;
  const patch = { type: 'patch', topic: next.topic, baseVersion: previous.version, version: next.version, observedAt: next.observedAt, metadata, upserts, removed };
  if (retainedBefore.some((id, position) => id !== retainedAfter[position])) patch.order = [...after.keys()];
  return patch;
}
export function applyCollectionPatch(previous, patch, field, key) {
  if (!previous?.available || previous.topic !== patch.topic || previous.version !== patch.baseVersion || !Number.isInteger(patch.version) || patch.version <= patch.baseVersion ||
      !Array.isArray(previous.data?.[field]) || !Array.isArray(patch.upserts) || !Array.isArray(patch.removed) || !patch.metadata || typeof patch.metadata !== 'object' || Array.isArray(patch.metadata)) throw new Error('Collection patch requires a current baseline');
  const changed = new Set();
  const upserts = [...patch.upserts].sort((a, b) => a.index - b.index);
  for (const item of upserts) {
    if (!item.job || typeof item.job.id !== 'string' || !Number.isInteger(item.index) || item.index < 0 || changed.has(key(item.job))) throw new Error('Invalid collection update');
    changed.add(key(item.job));
  }
  if (patch.removed.some(id => typeof id !== 'string')) throw new Error('Invalid collection removal');
  const removed = new Set(patch.removed);
  let rows = previous.data[field].filter(row => !removed.has(key(row)) && !changed.has(key(row)));
  for (const item of upserts) {
    if (item.index > rows.length) throw new Error('Invalid collection position');
    rows.splice(item.index, 0, item.job);
  }
  if (patch.order) {
    if (!Array.isArray(patch.order) || patch.order.length !== rows.length || new Set(patch.order).size !== rows.length) throw new Error('Invalid collection ordering');
    const indexed = new Map(rows.map(row => [key(row), row]));
    rows = patch.order.map(id => { if (!indexed.has(id)) throw new Error('Unknown collection row'); return indexed.get(id); });
  }
  return { type: 'snapshot', topic: patch.topic, version: patch.version, observedAt: patch.observedAt, available: true, data: { ...patch.metadata, [field]: rows } };
}
