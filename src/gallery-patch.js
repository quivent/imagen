// Shared wire format: complete archive once, then changes against the last
// archive actually sent to each connection. Never truncate the archive.
import { createCollectionPatch, applyCollectionPatch } from './collection-patch.js';
const key = row => `${row.profile || ''}:${row.id}`;
export function recentGallery(data, limit = 18) {
  const profiles = ['flux1-dev', 'flux2-dev-nf4'];
  const counts = Object.fromEntries(profiles.map(profile => [profile, 0]));
  const latest = Object.fromEntries(profiles.map(profile => [profile, []]));
  const time = row => typeof row.created === 'number' ? row.created : Date.parse(row.created) / 1000 || 0;
  for (const row of data.jobs) {
    if (!profiles.includes(row.profile) || typeof row.scene==='string'&&row.scene.startsWith('adhc-')) continue;
    counts[row.profile]++;
    const rows = latest[row.profile];
    const position = rows.findIndex(previous => time(row) > time(previous));
    if (position >= 0) rows.splice(position, 0, row);
    else if (rows.length < limit) rows.push(row);
    if (rows.length > limit) rows.pop();
  }
  return { ...data, jobs: profiles.flatMap(profile => latest[profile]), counts, totalJobs: Object.values(counts).reduce((sum,count)=>sum+count,0) };
}
export const createGalleryPatch = (previous, next) => createCollectionPatch(previous, next, 'jobs', key);
export const applyGalleryPatch = (previous, patch) => applyCollectionPatch(previous, patch, 'jobs', key);
