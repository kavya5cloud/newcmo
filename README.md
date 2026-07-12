# cosmos.ai

An AI CMO for teams that ship — it runs your marketing, skips the busywork, and only surfaces what actually moves your numbers.

## Structure

| File | What it is |
|------|-----------|
| `index.html` | Marketing landing page |
| `app.html` | The product — onboarding + dashboard (Company, Analytics, Agents Feed, AI CMO chat) |
| `server.py` | Dev server: serves the site **and** proxies AI calls to OpenAI (keeps the API key server-side) |
| `logo.png` | Pixel wordmark (transparent) |

## Running locally

```bash
python3 server.py
# → http://localhost:4321
```

## Enabling AI

The app falls back to demo data until an OpenAI key is present. To use real AI:

1. Put your key in `openai_key.txt` (one line) — or set the `OPENAI_API_KEY` env var.
2. Make sure your OpenAI account has billing/credit enabled.
3. Reload the app and hit **Analyze**. No restart needed.

Model defaults to `gpt-4o-mini`; override with the `OPENAI_MODEL` env var.

> ⚠️ **Never commit your API key.** `openai_key.txt` is gitignored for this reason.

## Status

Static prototype. Session state is in-memory (refresh clears it). Next steps: real persistence, auth, and a production host — at which point this moves to a framework (e.g. Next.js) with the OpenAI proxy as a serverless function.
