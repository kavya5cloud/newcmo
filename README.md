# cosmos.ai

An AI CMO for teams that ship — it runs your marketing, skips the busywork, and only surfaces what actually moves your numbers.

Now a **Next.js** app with real AI (Groq/OpenAI) and persistence.
     
## Run locally

```bash
npm install
npm run dev
# → http://localhost:3000
```

- `/` — marketing landing page
- `/app` — the product: onboarding → dashboard (Company · Analytics · Agents Feed · AI CMO chat)

## Configuration (`.env.local`)

| Var | What it does |
|-----|--------------|
| `GROQ_API_KEY` | Free AI provider (default). Get one at console.groq.com |
| `OPENAI_API_KEY` | Optional fallback provider |
| `GROQ_MODEL` / `OPENAI_MODEL` | Override the model |
| `DATABASE_URL` | Optional Neon Postgres connection string for cloud persistence |

The app degrades gracefully:
- **No AI key** → dashboard runs on demo data (a banner explains why).
- **No `DATABASE_URL`** → state persists to the browser's localStorage (survives refresh). Add a Neon URL to sync to the cloud; the topbar shows `local` vs `cloud ✓`.

> ⚠️ Never commit secrets. `.env.local`, `groq_key.txt`, and `openai_key.txt` are gitignored.

## Architecture

- **Next.js App Router** (`app/`) — `page.tsx` (landing), `app/page.tsx` (product).
- **API routes** — `app/api/generate` proxies AI calls (key stays server-side); `app/api/state` reads/writes workspace state to Neon.
- **Persistence** — `lib/store.ts`: localStorage source-of-truth with best-effort Neon sync.

## Roadmap

1. ✅ **Framework + persistence** (this) — Next.js, real AI, refresh-safe state.
2. Replace remaining demo panels (Analytics numbers, agent feed items) with real generated/stored data.
3. Real integrations — Google Search Console + GA4, Reddit API — for true analytics and opportunities.
4. Scheduled agents ("running daily"), accounts/auth, cost controls.

The original single-file prototype is preserved in [`prototype/`](prototype/).
