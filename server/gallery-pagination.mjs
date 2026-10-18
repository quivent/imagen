// A stable keyset cursor keeps older pages in place as new images arrive.
const timestamp = row => typeof row.created === 'number' ? row.created : Date.parse(row.created) / 1000 || 0;
const identity = row => `${row.profile}:${row.id}`;
const compare = (a, b) => timestamp(b) - timestamp(a) || identity(b).localeCompare(identity(a));
export function galleryPage(collection, params) {
  const profile = params.get('profile');
  if (profile && !['flux1-dev', 'flux2-dev-nf4'].includes(profile)) throw new Error('Invalid profile');
  const rawLimit = params.get('limit');
  const limit = rawLimit === null ? 36 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid limit');
  const rows = collection.jobs.filter(row => !profile || row.profile === profile).sort(compare);
  let cursor;
  if (params.has('cursor')) {
    try {
      cursor = JSON.parse(Buffer.from(params.get('cursor'), 'base64url').toString());
      if (!Number.isFinite(cursor.created) || typeof cursor.id !== 'string' || !['flux1-dev', 'flux2-dev-nf4'].includes(cursor.profile)) throw new Error();
    } catch { throw new Error('Invalid cursor'); }
  }
  const candidates = cursor ? rows.filter(row => compare(row, cursor) > 0) : rows;
  const jobs = candidates.slice(0, limit);
  const last = jobs.at(-1);
  const nextCursor = candidates.length > limit && last
    ? Buffer.from(JSON.stringify({ created: timestamp(last), profile: last.profile, id: last.id })).toString('base64url') : null;
  return { ok: true, updatedAt: collection.updatedAt, jobs, totalJobs: rows.length, limit, nextCursor };
}
