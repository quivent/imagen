// One shared archive poll per studio process. Failures retain the last index;
// only changed, valid collections trigger a WebSocket publication.
export function pollArchiveGallery({ load, onChange, intervalMs = 10000 }) {
  let stopped = false;
  let pending = null;
  let signature = null;
  function refresh() {
    if (stopped) return Promise.resolve();
    if (pending) return pending;
    pending = Promise.resolve().then(load).then(async data => {
      if (stopped || data?.ok !== true || !Array.isArray(data.jobs)) return;
      const next = JSON.stringify(data);
      if (next === signature) return;
      await onChange(data);
      signature = next;
    }).catch(() => {
      // A transient archive outage must not erase the verified live collection.
    }).finally(() => { pending = null; });
    return pending;
  }
  const timer = setInterval(refresh, intervalMs);
  timer.unref?.();
  void refresh();
  return { refresh, stop() { stopped = true; clearInterval(timer); } };
}
