import { createCollectionPatch, applyCollectionPatch } from './collection-patch.js';
const key = row => row.id;
export const createComparisonsPatch = (previous, next) => createCollectionPatch(previous, next, 'comparisons', key);
export const applyComparisonsPatch = (previous, patch) => applyCollectionPatch(previous, patch, 'comparisons', key);
