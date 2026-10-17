const stores = new WeakMap();

// Preserve native select options while the live collection grows. Existing
// choices retain their nodes and selection instead of being rebuilt each time.
export function reconcileComparisonOptions(select, rows, create = tag => document.createElement(tag)) {
  let options = stores.get(select);
  if (!options) { options = new Map(); stores.set(select, options); select.replaceChildren(); }
  const ids = new Set(rows.map(row => row.id));
  for (const [id, option] of options) if (!ids.has(id)) { option.remove(); options.delete(id); }
  if (!rows.length) {
    if (!select.children.length) { const option = create('option'); option.textContent = 'No images yet'; select.append(option); }
    return;
  }
  if (!options.size) select.replaceChildren();
  rows.forEach((row, index) => {
    let option = options.get(row.id);
    if (!option) { option = create('option'); option.value = row.id; options.set(row.id, option); }
    if (option.textContent !== row.title) option.textContent = row.title;
    if (select.children[index] !== option) select.insertBefore(option, select.children[index] || null);
  });
}
