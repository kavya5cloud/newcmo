# Populr

An AI CMO for teams that ship — it runs your marketing, skips the busywork, and only surfaces what actually moves your numbers.

Now a **Next.js** app with real AI (Groq/Gemini/OpenAI) and persistence.
     
## Run locally

```bash
npm install
npm run dev    
# → http://localhost:3000
```

- `/` — marketing landing page
- `/app` — the product: onboarding → dashboard (Company · Analytics · Agents Feed · AI CMO chat)


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
