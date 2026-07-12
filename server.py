#!/usr/bin/env python3
"""cosmos.ai dev server — serves the static site and proxies AI calls to OpenAI.

The OpenAI API key stays server-side (env OPENAI_API_KEY or openai_key.txt);
it is never sent to the browser. Run: python3 server.py
"""
import json
import os
import re
import urllib.error
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = 4321
ROOT = os.path.dirname(os.path.abspath(__file__))
KEY_FILE = os.path.join(ROOT, 'openai_key.txt')
MODEL = os.environ.get('OPENAI_MODEL', 'gpt-4o-mini')


def get_key():
    key = os.environ.get('OPENAI_API_KEY', '').strip()
    if not key and os.path.exists(KEY_FILE):
        key = open(KEY_FILE).read().strip()
    # ignore the placeholder / anything that isn't a real key
    if not key.startswith('sk-'):
        return None
    return key


def fetch_site_text(url, cap=6000):
    """Fetch a page server-side and reduce it to plain text for the model."""
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (cosmos.ai analyzer)'})
        with urllib.request.urlopen(req, timeout=10) as r:
            html = r.read(400_000).decode('utf-8', 'ignore')
        html = re.sub(r'(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>', ' ', html)
        text = re.sub(r'(?s)<[^>]+>', ' ', html)
        text = re.sub(r'\s+', ' ', text).strip()
        return text[:cap] or None
    except Exception:
        return None


def call_openai(prompt, key):
    body = json.dumps({
        'model': MODEL,
        'messages': [{'role': 'user', 'content': prompt}],
        'max_completion_tokens': 1200,
    }).encode()
    req = urllib.request.Request(
        'https://api.openai.com/v1/chat/completions',
        data=body,
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key},
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        data = json.loads(r.read())
    return data['choices'][0]['message']['content']


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def _json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != '/api/generate':
            return self._json(404, {'error': 'not_found'})
        try:
            length = int(self.headers.get('Content-Length', 0))
            payload = json.loads(self.rfile.read(length) or b'{}')
        except Exception:
            return self._json(400, {'error': 'bad_request'})

        key = get_key()
        if not key:
            return self._json(503, {'error': 'no_api_key',
                                    'hint': 'paste your OpenAI key into openai_key.txt (or set OPENAI_API_KEY)'})

        prompt = str(payload.get('prompt', '')).strip()
        if not prompt:
            return self._json(400, {'error': 'empty_prompt'})

        url = payload.get('url')
        if url:
            site = fetch_site_text(str(url))
            if site:
                prompt = (f'Below is the text content of {url} (fetched just now):\n---\n{site}\n---\n\n' + prompt)
            else:
                prompt = (f'(Note: {url} could not be fetched — infer what you can from the domain name.)\n\n' + prompt)

        try:
            text = call_openai(prompt, key)
            return self._json(200, {'text': text})
        except urllib.error.HTTPError as e:
            detail = e.read().decode('utf-8', 'ignore')[:400]
            return self._json(e.code, {'error': 'openai_error', 'detail': detail})
        except Exception as e:
            return self._json(502, {'error': 'upstream_failed', 'detail': str(e)[:200]})


if __name__ == '__main__':
    handler = partial(Handler, directory=ROOT)
    print(f'cosmos.ai server → http://localhost:{PORT}  (model: {MODEL}, key: {"loaded" if get_key() else "MISSING — demo mode"})')
    ThreadingHTTPServer(('127.0.0.1', PORT), handler).serve_forever()
