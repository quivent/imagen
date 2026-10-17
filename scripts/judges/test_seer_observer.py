"""Contract tests: observation must preserve the model API and image identity."""
import asyncio
import base64
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import seer_observer as observer


class ObserverTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous = observer.ROOT
        observer.ROOT = Path(self.temp.name)

    def tearDown(self):
        observer.ROOT = self.previous
        self.temp.cleanup()

    async def run_request(self, response, *, stream=False, raises=False):
        raw_image = b'opaque test image bytes'
        image = 'data:image/png;base64,' + base64.b64encode(raw_image).decode()
        body = json.dumps({'messages': [{'role': 'system', 'content': 'Do not publish this system text'},
            {'role': 'user', 'content': [{'type': 'text', 'text': 'Review this image'},
             {'type': 'image_url', 'image_url': {'url': image}}]}]}).encode()
        sent = []

        async def receive():
            return {'type': 'http.request', 'body': body, 'more_body': False}

        async def app(scope, receive, send):
            self.assertEqual((await receive())['body'], body)
            current = json.loads((observer.ROOT / 'pixtral/state.json').read_text())
            self.assertEqual(len(current['active']), 1)
            if raises:
                raise RuntimeError('model failed')
            await send({'type': 'http.response.start', 'status': 200,
                        'headers': [(b'content-type', b'text/event-stream' if stream else b'application/json')]})
            for i in range(0, len(response), 7):
                await send({'type': 'http.response.body', 'body': response[i:i+7], 'more_body': i+7 < len(response)})

        middleware = observer.SeerObserver(app, model_id='pixtral')
        async def send(message):
            sent.append(message)
        scope = {'type': 'http', 'method': 'POST', 'path': '/v1/chat/completions'}
        if raises:
            with self.assertRaises(RuntimeError):
                await middleware(scope, receive, send)
        else:
            await middleware(scope, receive, send)
            self.assertEqual(b''.join(x.get('body', b'') for x in sent), response)
        state = json.loads((observer.ROOT / 'pixtral/state.json').read_text())
        self.assertEqual(state['active'], [])
        self.assertEqual(state['last']['prompt'], 'Review this image')
        digest = hashlib.sha256(raw_image).hexdigest()
        self.assertEqual(state['last']['images'][0]['sha256'], digest)
        self.assertEqual((observer.ROOT / 'images' / (digest + '.png')).read_bytes(), raw_image)
        return state['last']

    async def test_response_passes_unchanged_and_receipt_matches_input(self):
        result = await self.run_request(json.dumps({'choices': [{'message': {'content': 'Use a warmer light.'}}]}).encode())
        self.assertEqual(result['feedback']['text'], 'Use a warmer light.')
        self.assertEqual(result['state'], 'complete')

    async def test_split_stream_is_reassembled_without_changing_delivery(self):
        response = (b'data: {"choices":[{"delta":{"content":"Warmer "}}]}\n\n'
                    b'data: {"choices":[{"delta":{"content":"light."}}]}\n\n'
                    b'data: [DONE]\n\n')
        result = await self.run_request(response, stream=True)
        self.assertEqual(result['feedback']['text'], 'Warmer light.')

    async def test_failure_does_not_leave_a_phantom_active_review(self):
        result = await self.run_request(b'', raises=True)
        self.assertEqual(result['state'], 'failed')

    async def test_nonvisual_request_does_not_replace_the_last_image_review(self):
        await self.run_request(b'{"choices":[{"message":{"content":"Keep this review"}}]}')
        before = (observer.ROOT / 'pixtral/state.json').read_bytes()
        async def app(scope, receive, send):
            await receive()
            await send({'type': 'http.response.start', 'status': 422, 'headers': []})
            await send({'type': 'http.response.body', 'body': b'{"error":"invalid image"}'})
        async def receive():
            return {'type': 'http.request', 'body': b'{"input":"http://invalid/"}', 'more_body': False}
        async def send(message):
            pass
        middleware = observer.SeerObserver(app, model_id='pixtral')
        await middleware({'type': 'http', 'method': 'POST', 'path': '/v1/embeddings'}, receive, send)
        self.assertEqual((observer.ROOT / 'pixtral/state.json').read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
