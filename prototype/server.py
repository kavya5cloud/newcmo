#!/usr/bin/env python3
"""cosmos.ai dev server — serves the static site and proxies AI calls to an LLM.

Supports Groq (free, default) and OpenAI. The API key stays server-side
(env var or a *_key.txt file) and is never sent to the browser.
Run: python3 server.py
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

# Providers are tried in order; the first one with a valid key wins.
# All three speak the OpenAI chat-completions format, so one call path serves all.
PROVIDERS = [
    {
        'name': 'groq',
        'env': 'GROQ_API_KEY',
        'file': 'groq_key.txt',
        'prefix': 'gsk_',
        'url': 'https://api.groq.com/openai/v1/chat/completions',
        'model': os.environ.get('GROQ_MODEL', 'llama-3.3-70b-versatile'),
    },
    {
        'name': 'openai',
        'env': 'OPENAI_API_KEY',
        'file': 'openai_key.txt',
        'prefix': 'sk-',
        'url': 'https://api.openai.com/v1/chat/completions',
        'model': os.environ.get('OPENAI_MODEL', 'gpt-4o-mini'),
    },
]


def active_provider():
    """Return (provider_dict, key) for the first provider with a real key, else (None, None)."""
    for p in PROVIDERS:
        key = os.environ.get(p['env'], '').strip()
        if not key:
            path = os.path.join(ROOT, p['file'])
            if os.path.exists(path):
                key = open(path).read().strip()
        if key.startswith(p['prefix']):
            return p, key
    return None, None


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


def call_llm(prompt, provider, key):
    body = json.dumps({
        'model': provider['model'],
        'messages': [{'role': 'user', 'content': prompt}],
        'max_tokens': 1200,
    }).encode()
    req = urllib.request.Request(
        provider['url'],
        data=body,
        headers={
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + key,
            'User-Agent': 'cosmos.ai/1.0',
        },
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

        provider, key = active_provider()
        if not provider:
            return self._json(503, {'error': 'no_api_key',
                                    'hint': 'paste a free Groq key into groq_key.txt (get one at console.groq.com)'})

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
            text = call_llm(prompt, provider, key)
            return self._json(200, {'text': text, 'provider': provider['name']})
        except urllib.error.HTTPError as e:
            detail = e.read().decode('utf-8', 'ignore')[:400]
            return self._json(e.code, {'error': 'llm_error', 'provider': provider['name'], 'detail': detail})
        except Exception as e:
            return self._json(502, {'error': 'upstream_failed', 'detail': str(e)[:200]})


if __name__ == '__main__':
    handler = partial(Handler, directory=ROOT)
    p, _ = active_provider()
    status = f'{p["name"]} ({p["model"]})' if p else 'MISSING — demo mode'
    print(f'cosmos.ai server → http://localhost:{PORT}  (provider: {status})')
    ThreadingHTTPServer(('127.0.0.1', PORT), handler).serve_forever()
