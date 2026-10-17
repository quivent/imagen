import { installLocalGallery } from './server/local-gallery.mjs';
import { installNativeLive } from './server/native-live.mjs';
import { defineConfig } from 'vite';
import { installStudioMonitor } from './server/studio-monitor.mjs';
import { installStudioEvents } from './server/studio-events.mjs';
import { installCorrections } from '../kinship-of-cancer/tools/artwork/control/corrections.mjs';
import { installWinners } from '../kinship-of-cancer/tools/artwork/control/winners.mjs';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicOrigin = 'https://artwork.influx.vision';
const apiOrigin = process.env.ARTWORK_API_ORIGIN || 'https://artwork-comparison.vercel.app';
const isPublicRequest = request => request.headers.host?.split(':')[0] === 'artwork.influx.vision';
const records = new Set(['/tasks.json', '/winners.json', '/monitor-state.json', '/agent-status.json', '/data/comparisons.json']);
const imageTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif' };
// Keep mutable records out of the bundle, and private scripts out of HTTP responses.
function runtimeFiles(server) {
  if (server.watcher) {
    server.watcher.add([...records].map(record => path.join(root, record.slice(1))));
    const changed = file => {
      const relative = '/' + path.relative(root, file).split(path.sep).join('/');
      if (records.has(relative)) server.ws.send({ type: 'custom', event: 'artwork-record-update', data: { path: relative } });
    };
    server.watcher.on('change', changed);
    server.httpServer?.once('close', () => server.watcher.off('change', changed));
  }
  server.middlewares.use((req, res, next) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400).end(); return; }
    if (pathname.startsWith('/api/') && req.method === 'POST') {
      const origin = req.headers.origin;
      if (!origin || ![publicOrigin, 'http://127.0.0.1:' + server.config.server.port, 'http://localhost:' + server.config.server.port, 'http://127.0.0.1:' + server.config.preview.port, 'http://localhost:' + server.config.preview.port].includes(origin)) { res.writeHead(403).end(); return; }
    }
    const runtime = records.has(pathname) || pathname.startsWith('/data/');
    if (!runtime) {
      if (pathname.startsWith('/server/') || pathname.startsWith('/scripts/') || /\.(?:py|md|log)$/.test(pathname) || pathname.startsWith('/@fs/') || pathname.split('/').includes('.runtime')) { res.writeHead(404).end(); return; }
      next(); return;
    }
    try {
      const extension = path.extname(pathname).toLowerCase();
      if (!records.has(pathname) && !imageTypes[extension]) throw new Error('Unsupported file');
      const relative = pathname.slice(1);
      if (!/^[A-Za-z0-9_./-]+$/.test(relative) || relative.split('/').some(part => !part || part.startsWith('.'))) throw new Error('Unsafe path');
      const file = path.join(root, relative);
      if (realpathSync(file) !== file || !statSync(file).isFile()) throw new Error('Not a regular file');
      res.setHeader('Content-Type', extension === '.json' ? 'application/json' : imageTypes[extension]);
      res.setHeader('Cache-Control', imageTypes[extension] ? 'public, max-age=31536000, immutable' : 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.end(readFileSync(file));
    } catch { res.writeHead(404).end(); }
  });
}
const proxy = {
  '/api': {
    target: apiOrigin,
    changeOrigin: true,
    cookieDomainRewrite: '',
    configure(proxyServer) {
      proxyServer.on('proxyReq', (request, incoming) => {
        if (incoming.headers.origin) request.setHeader('Origin', publicOrigin);
        if (!isPublicRequest(incoming) && incoming.headers.cookie) request.setHeader('Cookie', incoming.headers.cookie.replace(/artwork-dev-control=/g, '__Host-artwork-control='));
      });
      // Public HTTPS keeps its __Host cookie; loopback HTTP uses a separate name.
      proxyServer.on('proxyRes', (response, incoming) => {
        if (new URL(incoming.url, publicOrigin).pathname === '/api/gallery/image' && [200, 304].includes(response.statusCode)) response.headers['cache-control'] = 'public, max-age=31536000, immutable';
        if (!isPublicRequest(incoming) && response.headers['set-cookie']) response.headers['set-cookie'] = response.headers['set-cookie'].map(cookie => cookie.replace(/^__Host-artwork-control=/, 'artwork-dev-control=').replace(/;\s*Secure\b/gi, ''));
      });
    },
  },
};
export default defineConfig({
  root,
  publicDir: 'public',
  plugins: [{ name: 'native-live', configureServer: installNativeLive, configurePreviewServer: installNativeLive }, { name: 'local-gallery', configureServer: installLocalGallery, configurePreviewServer: installLocalGallery }, { name: 'studio-winners', configureServer: installWinners, configurePreviewServer: installWinners }, { name: 'studio-events', configureServer: installStudioEvents, configurePreviewServer: installStudioEvents }, { name: 'studio-corrections', configureServer: installCorrections, configurePreviewServer: installCorrections }, { name: 'initial-panel-markup', transformIndexHtml(html) {
    for (const name of ['metrics', 'monitor', 'winners', 'agents', 'rules', 'daemons', 'performance', 'protocol', 'models']) {
      const markup = readFileSync(path.join(root, 'src', name + '-panel.html'), 'utf8');
      html = html.replace(new RegExp('(<section id="' + name + '-panel"[^>]*>)</section>'), (_match, opening) => opening + markup + '</section>');
    }
    return html;
  } }, { name: 'studio-live-monitor', configureServer: installStudioMonitor, configurePreviewServer: installStudioMonitor }, { name: 'artwork-runtime-files', configureServer: runtimeFiles, configurePreviewServer: runtimeFiles }],
  server: { host: '127.0.0.1', port: 48624, strictPort: true, allowedHosts: ['artwork.influx.vision'], fs: { allow: [root] }, proxy },
  preview: { host: '127.0.0.1', port: 48625, strictPort: true, allowedHosts: ['artwork.influx.vision'], proxy },
  build: { outDir: 'dist', emptyOutDir: true, rollupOptions: { input: { studio: path.join(root, 'index.html'), metrics: path.join(root, 'metrics.html'), monitor: path.join(root, 'monitor.html') } } },
});
