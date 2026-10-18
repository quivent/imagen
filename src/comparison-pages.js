// Keep the page anchored to its first record when new generations arrive.
export function createComparisonPages(size = 20) {
  let start = 0, anchor = null, selected = null, rows = [];
  return {
    update(next, id) {
      rows = next;
      if (id !== selected) {
        const index = rows.findIndex(row => row.id === id);
        if (index >= 0) start = Math.floor(index / size) * size;
      } else if (start && anchor) {
        const index = rows.findIndex(row => row.id === anchor);
        if (index >= 0) start = index;
      }
      selected = id;
      start = Math.min(start, Math.max(0, rows.length - 1));
      anchor = rows[start]?.id || null;
      return rows.slice(start, start + size);
    },
    move(direction) {
      start = direction === 'latest' ? 0 : Math.max(0, Math.min(start + direction * size, Math.max(0, Math.ceil(rows.length / size) - 1) * size));
      anchor = rows[start]?.id || null;
    },
    get position() { return { start, end: Math.min(start + size, rows.length), total: rows.length }; },
  };
}
