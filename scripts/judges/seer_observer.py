"""Observe actual model requests without changing their inference behavior."""
import base64
import hashlib
import json
import os
from pathlib import Path
import time
import uuid

ROOT = Path('/workspace/artwork/judges/seers')
LIMIT = 24 * 1024 * 1024


def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    temp.write_text(json.dumps(value, separators=(',', ':')))
    temp.replace(path)


def image_record(value):
    if not isinstance(value, str) or not value.startswith('data:image/') or len(value) > LIMIT * 2:
        return None
    header, encoded = value.split(',', 1)
    mime = header.split(';')[0][5:]
    ext = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp'}.get(mime)
    if not ext or ';base64' not in header:
        return None
    raw = base64.b64decode(encoded, validate=True)
    if len(raw) > LIMIT:
        return None
    digest = hashlib.sha256(raw).hexdigest()
    name = digest + '.' + ext
    path = ROOT / 'images' / name
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_name(name + '.' + uuid.uuid4().hex + '.tmp')
        temp.write_bytes(raw)
        temp.replace(path)
    return {'sha256': digest, 'file': name, 'url': '/api/seers/image/' + name}


def inputs(body):
    images, prompts = [], []
    candidates = []
    for message in body.get('messages', []):
        if message.get('role') != 'user':
            continue
        content = message.get('content', [])
        if isinstance(content, str):
            prompts.append(content)
            continue
        for part in content:
            if part.get('type') == 'text':
                prompts.append(str(part.get('text', '')))
            elif part.get('type') == 'image_url':
                value = part.get('image_url', {})
                candidates.append(value.get('url') if isinstance(value, dict) else value)
    value = body.get('input')
    if isinstance(value, str):
        candidates.append(value)
    elif isinstance(value, list):
        candidates.extend(value[:2])
    candidates.extend(body.get(key) for key in ('image_a', 'image_b') if key in body)
    for value in candidates[:4]:
        try:
            image = image_record(value)
            if image:
                images.append(image)
        except (ValueError, TypeError):
            pass
    return images, '\n\n'.join(prompts)[-12000:]


def feedback(body):
    if 'choices' in body:
        message = (body.get('choices') or [{}])[0].get('message', {})
        return {'text': str(message.get('content') or '')[:24000], 'kind': 'critique'}
    if 'cosine_similarity' in body:
        return {'kind': 'similarity', 'text': 'Visual similarity between these two images.',
                'measures': {k: body[k] for k in ('cosine_similarity', 'cosine_distance') if k in body}}
    if isinstance(body.get('data'), list) and body['data']:
        vectors = [row.get('embedding', []) for row in body['data']]
        return {'kind': 'embedding', 'text': 'Visual fingerprint extracted. Compare it with other images to measure visual similarity.',
                'measures': {'dimensions': len(vectors[0]), 'images': len(vectors)}}
    return {'kind': 'unknown', 'text': 'The model did not return readable feedback.'}


class SeerObserver:
    def __init__(self, app, model_id=None):
        self.app = app
        self.model = model_id or os.environ.get('SEER_MODEL_ID', '')
        self.active = {}
        self.last = None
        self.path = ROOT / self.model / 'state.json'
        try:
            self.last = json.loads(self.path.read_text()).get('last')
        except (OSError, ValueError):
            pass

    def save(self):
        try:
            atomic(self.path, {'model': self.model, 'pid': os.getpid(), 'updatedAt': time.time(),
                               'active': list(self.active.values()), 'last': self.last})
        except OSError:
            pass  # Telemetry must not interrupt inference.

    async def __call__(self, scope, receive, send):
        if (self.model not in ('pixtral', 'dinov2', 'gemma') or scope['type'] != 'http'
                or scope.get('method') != 'POST' or scope.get('path') not in
                ('/v1/chat/completions', '/v1/embeddings', '/v1/compare')):
            return await self.app(scope, receive, send)
        chunks, response = [], bytearray()
        ident = uuid.uuid4().hex
        record = None
        status = 0
        streaming = False
        error = False

        async def incoming():
            nonlocal record
            message = await receive()
            if message['type'] == 'http.request':
                chunks.append(message.get('body', b''))
                if not message.get('more_body'):
                    try:
                        if sum(map(len, chunks)) > LIMIT * 2:
                            return message
                        body = json.loads(b''.join(chunks))
                        images, prompt = inputs(body)
                        if not images:
                            chunks.clear()
                            return message
                        record = {'id': ident, 'startedAt': time.time(), 'images': images,
                                  'prompt': prompt, 'endpoint': scope['path'], 'state': 'reviewing'}
                        self.active[ident] = record
                        self.save()
                    except Exception:
                        pass
                    chunks.clear()
            return message

        async def outgoing(message):
            nonlocal status, streaming
            if message['type'] == 'http.response.start':
                status = message['status']
                streaming = any(k.lower() == b'content-type' and b'text/event-stream' in v
                                for k, v in message.get('headers', []))
            elif message['type'] == 'http.response.body' and len(response) < 512 * 1024:
                response.extend(message.get('body', b'')[:512 * 1024 - len(response)])
            await send(message)

        try:
            await self.app(scope, incoming, outgoing)
        except BaseException:
            error = True
            raise
        finally:
            if record is not None:
                try:
                    if error or not 200 <= status < 300:
                        result = {'text': 'This review did not finish successfully.', 'kind': 'error'}
                    elif streaming:
                        parts = []
                        for line in response.decode(errors='replace').splitlines():
                            if not line.startswith('data: ') or line == 'data: [DONE]':
                                continue
                            try:
                                data = json.loads(line[6:])
                                parts.extend(c.get('delta', {}).get('content') or '' for c in data.get('choices', []))
                            except ValueError:
                                pass
                        result = {'text': ''.join(parts)[:24000], 'kind': 'critique'}
                    else:
                        result = feedback(json.loads(response))
                    finished = {**record, 'state': 'failed' if result['kind'] == 'error' else 'complete',
                                'finishedAt': time.time(), 'feedback': result}
                    atomic(ROOT / self.model / 'reviews' / (ident + '.json'), finished)
                    self.last = finished
                except Exception:
                    pass
                self.active.pop(ident, None)
                self.save()
