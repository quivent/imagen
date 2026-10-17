"""Loopback-only review desk; local operator API, never a public product route."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import secrets
from urllib.parse import urlparse, parse_qs


def make_server(store, port):
    token = secrets.token_hex(32)
    assets = Path(__file__).parent

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def reply(self, status, body, kind='application/json'):
            if not isinstance(body, bytes):
                body = json.dumps(body).encode()
            self.send_response(status)
            self.send_header('Content-Type', kind)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
            self.end_headers()
            self.wfile.write(body)

        def trusted(self, write=False):
            hosts = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
            host = self.headers.get('Host')
            if host not in hosts:
                self.reply(403, {'problem': 'Local host required'})
                return False
            origin = self.headers.get('Origin')
            if origin and origin not in {'http://' + h for h in hosts}:
                self.reply(403, {'problem': 'Local origin required'})
                return False
            if write and not secrets.compare_digest(self.headers.get('X-Artwork-Token', ''), token):
                self.reply(403, {'problem': 'Local review token required'})
                return False
            return True

        def do_GET(self):
            if not self.trusted():
                return
            url = urlparse(self.path)
            try:
                if url.path == '/':
                    self.reply(200, (assets / 'desk.html').read_text().replace('__TOKEN__', token).encode(), 'text/html; charset=utf-8')
                elif url.path in ('/desk.js', '/desk.css'):
                    self.reply(200, (assets / url.path[1:]).read_bytes(),
                               'text/javascript; charset=utf-8' if url.path.endswith('.js') else 'text/css; charset=utf-8')
                elif url.path == '/api/health':
                    self.reply(200, {'ok': True, 'role': 'local artwork operator service'})
                elif url.path == '/api/state':
                    self.reply(200, store.snapshot())
                elif url.path == '/api/similar':
                    self.reply(200, store.similar(parse_qs(url.query)['version'][0]))
                elif url.path.startswith('/asset/'):
                    _, _, version, kind = url.path.split('/')
                    path = store.asset(version, kind)
                    media_type = {
                        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                        '.webp': 'image/webp', '.gif': 'image/gif', '.tif': 'image/tiff',
                        '.tiff': 'image/tiff', '.bmp': 'image/bmp',
                    }.get(path.suffix.lower(), 'application/octet-stream')
                    self.reply(200, path.read_bytes(), media_type)
                else:
                    self.reply(404, {'problem': 'Not found'})
            except (ValueError, KeyError, OSError):
                self.reply(404, {'problem': 'This record is not available'})

        def do_POST(self):
            if not self.trusted(write=True):
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 100_000 or self.headers.get_content_type() != 'application/json':
                    self.reply(400, {'problem': 'A small JSON request is required'})
                    return
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict):
                    raise ValueError('Request must be an object')
                if self.path == '/api/enqueue':
                    # Browser may reference only version-store assets, not arbitrary host files.
                    if data.get('references'):
                        raise ValueError('Choose a stored reference version in the review desk')
                    if data.get('referenceVersion'):
                        data['references'] = [{'path': str(store.asset(data.pop('referenceVersion'), 'original')),
                                               'role': data.pop('referenceRole', 'reference')}]
                    result = store.enqueue(data)
                elif self.path == '/api/review':
                    store.review(data['version'], data['decision'], data['note'],
                                 'operator', data.get('expectedSelected'))
                    result = {'ok': True}
                elif self.path == '/api/retry':
                    store.retry(data['job'], data['reason'])
                    result = {'ok': True}
                elif self.path == '/api/cancel':
                    store.cancel(data['job'], data['reason'])
                    result = {'ok': True}
                elif self.path == '/api/export':
                    result = {'directory': store.export(data['name'], bool(data.get('pending')))}
                else:
                    self.reply(404, {'problem': 'Not found'})
                    return
                self.reply(200, result)
            except (ValueError, KeyError, OSError) as exc:
                self.reply(400, {'problem': str(exc)})

    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.daemon_threads = True
    return server


def serve(store, port=48620):
    server = make_server(store, port)
    print(f'Artwork desk: http://127.0.0.1:{server.server_port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
