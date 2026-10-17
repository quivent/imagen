let installation = null;

// The hash is already recorded by the artwork archive/manifest, not estimated.
export function artworkImageURL(value, sha256) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value, location.href);
    if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) return null;
    if (typeof sha256 === 'string' && /^[a-f0-9]{64}$/i.test(sha256)) url.searchParams.set('sha256', sha256.toLowerCase());
    return url.href;
  } catch { return null; }
}

export function installImageCache() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return Promise.resolve(null);
  if (!installation) installation = navigator.serviceWorker.register('/image-cache-sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => null);
  return installation;
}
