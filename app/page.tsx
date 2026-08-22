"use client";
import { useEffect, useRef, useState } from "react";
import { SHOW_CONTENT_ENGINE } from "@/lib/flags";
import { captureReferral } from "@/lib/referral-client";
import Icon from "@/app/components/Icon";

// The ways into the product. Derived rather than hand-numbered: the content engine is
// behind a flag, and a hardcoded "01/02/03" under a hardcoded "Three ways in." would go
// stale the moment it is hidden. Index 0 is the primary — exactly one, always.
const WAYS: { href: string; title: string; desc: string }[] = [
  // First, because it is the shortest path from "I have a website" to "my marketing is
  // running". A new visitor should not have to work out which of the other entries is the
  // one that sets things up. `next` carries them here through sign-in.
  {
    href: "/app?next=/app/assistant",
    title: "Set up my marketing",
    desc: "Four questions, about a minute — how often to post, where, how much you want to review, and what you're aiming for. Then Populr takes it from there.",
  },
  ...(SHOW_CONTENT_ENGINE
    ? [{
        href: "/app?next=/studio/documents",
        title: "Create content",
        desc: "One prompt becomes a post, thread, blog, email or landing page — sized to each platform's limits, with hashtags, CTAs and a schedule. Paste your site first so it writes about your product, not a generic one.",
      }]
    : []),
  {
    href: "/app",
    title: "Launch workspace",
    desc: "A whole launch, planned and executed — campaigns, assets, approvals and publishing, run by seven AI specialists you can watch and interrupt.",
  },
  {
    href: "/app",
    title: "Campaigns",
    desc: "Everything already in flight, and what each one is doing next.",
  },
];

const COUNT_WORD = ["No", "One", "Two", "Three", "Four"][WAYS.length] ?? String(WAYS.length);

const AGENTS: { c: string; name: string; desc: string; soon?: boolean; icon: React.ReactNode }[] = [
  { c: "#3ECF8E", name: "Influencer Agent", desc: "Finds creators who match your audience and drafts the outreach.", icon: <path d="M20 4L7 8.5H4.5A2.5 2.5 0 0 0 2 11v2a2.5 2.5 0 0 0 2.5 2.5H6V19a1.5 1.5 0 0 0 1.5 1.5H9a1 1 0 0 0 1-1v-3.6l10 3.6V4z" /> },
  { c: "#FF4500", name: "Reddit Agent", desc: "Surfaces high-intent threads and drafts replies for your review.", icon: <><ellipse cx="12" cy="14" rx="8" ry="5.6" /><circle cx="19.5" cy="9.5" r="1.6" /><path d="M12 8.4l1.2-4.2 4 1.1" strokeLinecap="round" /><circle cx="9" cy="13.5" r="1.1" fill="currentColor" stroke="none" /><circle cx="15" cy="13.5" r="1.1" fill="currentColor" stroke="none" /><path d="M9.3 16.3c1.7 1.1 3.7 1.1 5.4 0" strokeLinecap="round" /></> },
  { c: "#CDA6F2", name: "SEO Agent", desc: "Keyword opportunities, drafted into posts and pages for approval.", icon: <><circle cx="11" cy="11" r="6.2" /><path d="M15.6 15.6L20 20" /><path d="M8.5 11h5M11 8.5v5" /></> },
  { c: "#9A6AE8", name: "Writer Agent", desc: "Long-form articles and copy in your brand voice.", icon: <><path d="M4 20l1.2-4.2L16.4 4.6a2.05 2.05 0 0 1 2.9 2.9L8.2 18.8 4 20z" /><path d="M14.5 6.5l3 3" /></> },
  { c: "#FAFAFA", name: "X (Twitter) Agent", desc: "Post and thread drafts you refine and ship yourself.", icon: <path d="M17.2 3h3l-6.6 7.6L21.5 21h-6.1l-4.8-6.2L5.1 21h-3l7.1-8.1L2.5 3h6.2l4.3 5.7L17.2 3zm-1 16.2h1.7L6.9 4.7H5.1l11.1 14.5z" fill="currentColor" stroke="none" /> },
  { c: "#0A66C2", name: "LinkedIn Agent", desc: "Professional drafts for you to personalise and share.", icon: <><rect x="3" y="3" width="18" height="18" rx="3.5" /><circle cx="8" cy="8.3" r="1.25" fill="currentColor" stroke="none" /><path d="M8 11.2v6" strokeWidth="2" strokeLinecap="round" /><path d="M12.2 17.2v-6" strokeWidth="2" strokeLinecap="round" /><path d="M12.2 13.6a2.5 2.5 0 0 1 5 0v3.6" strokeWidth="2" strokeLinecap="round" /></> },
  { c: "#FF6600", name: "Hacker News Agent", desc: "Spots the right moments and drafts comments worth posting.", icon: <><rect x="3" y="3" width="18" height="18" rx="3.5" /><path d="M8.3 7.5l3.7 5.2v4M15.7 7.5L12 12.7" strokeWidth="1.9" strokeLinecap="round" /></> },
  { c: "#5A8DE8", name: "GEO Agent", desc: "Gets your brand cited in ChatGPT and AI Overviews.", icon: <><circle cx="12" cy="12" r="8.4" /><ellipse cx="12" cy="12" rx="3.6" ry="8.4" /><path d="M3.8 12h16.4" /></> },
  { c: "#3A8DE8", name: "Coding Agent", desc: "Ships technical SEO fixes as real code changes.", icon: <path d="M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /> },
  { c: "#E8843A", name: "UGC Videos Agent", desc: "Guided briefs and AI clips, ready for social and ads.", icon: <><rect x="2.8" y="4.8" width="18.4" height="14.4" rx="3" /><path d="M10.2 9.2l4.6 2.8-4.6 2.8V9.2z" fill="currentColor" stroke="none" /></> },
  { c: "#4285F4", name: "Google Search Console", desc: "Live search data reveals ranking opportunities.", icon: <><circle cx="11" cy="11" r="6.4" /><path d="M15.8 15.8L20 20" /><path d="M8.6 13.2v-2M11 13.2V8.8M13.4 13.2v-3.1" /></> },
  { c: "#E8B45A", name: "Google Analytics", desc: "GA4 signals show what's working and where to focus.", icon: <><rect x="4" y="13.5" width="4.2" height="6.5" rx="1.4" fill="currentColor" stroke="none" /><rect x="9.9" y="8.5" width="4.2" height="11.5" rx="1.4" fill="currentColor" stroke="none" /><rect x="15.8" y="4" width="4.2" height="16" rx="1.4" fill="currentColor" stroke="none" /></> },
  { c: "#5AC8E8", name: "Link Broker Agent", soon: true, desc: "High-quality backlink building, on autopilot.", icon: <><path d="M10.2 13.8a4.2 4.2 0 0 0 6.2.4l2.8-2.8a4.2 4.2 0 0 0-5.9-5.9l-1.5 1.5" /><path d="M13.8 10.2a4.2 4.2 0 0 0-6.2-.4l-2.8 2.8a4.2 4.2 0 0 0 5.9 5.9l1.5-1.5" /></> },
];

const AGENT_DETAILS: Record<string, string> = {
  "Influencer Agent": "Builds a short, qualified creator list with audience-fit notes and ready-to-edit outreach messages.",
  "Reddit Agent": "Prioritizes conversations with buying intent, then gives you a helpful, on-brand response draft to review.",
  "SEO Agent": "Finds practical search opportunities across your site, from page fixes to content topics worth ranking for.",
  "Writer Agent": "Turns the highest-value opportunities into articles, landing-page copy, and campaign content in your voice.",
  "X (Twitter) Agent": "Produces timely post and thread ideas based on your positioning, product insights, and active campaigns.",
  "LinkedIn Agent": "Creates credible founder-led posts that turn a specific product or market insight into a useful narrative.",
  "Hacker News Agent": "Frames your launch around the problem, how the product works, technical choices, and honest limitations.",
  "GEO Agent": "Checks where AI search tools cite competitors and identifies the content or authority gaps to close.",
  "Coding Agent": "Converts technical SEO recommendations into implementation-ready tasks and code changes for your site.",
  "UGC Videos Agent": "Creates clear creative briefs for short product videos, social clips, and paid-ad variations.",
  "Google Search Console": "Uses verified Search Console data to surface queries, pages, clicks, impressions, and ranking changes.",
  "Google Analytics": "Turns GA4 behavior signals into focused recommendations about what is working and what needs attention.",
  "Link Broker Agent": "Will identify relevant backlink opportunities and prepare outreach once the feature is available.",
};

// What a daily run decides, shown as the product shows it.
//
// This replaced a fake terminal that typed itself out character by character. The terminal
// was a costume: Populr has no command line, so the one thing the hero demonstrated was
// something the product does not do. Worse, the format put the interesting part — the
// reason a task was skipped — in a trailing `# comment`, which is where the eye goes last.
//
// The frame below shows the same decisions as rows, which is the shape the dashboard
// actually uses. `verdict` drives the styling; nothing here is styled by hand.
const PLAN_ROWS: { verdict: "skip" | "do"; task: string; why: string }[] = [
  { verdict: "skip", task: 'Write 4 articles for "best crm"', why: "Won't rank — three incumbents own the page one" },
  { verdict: "skip", task: "Daily LinkedIn posts", why: "Your buyers aren't reading LinkedIn this week" },
  { verdict: "skip", task: "Reply to 14 Reddit threads", why: "11 are low-intent — 3 are queued instead" },
  { verdict: "do", task: "Fix the pricing page", why: "61% bounce within 9 seconds. Draft attached." },
];

export default function Landing() {
  // A referral link lands here. Store the code straight away — the account may not be
  // created until several screens later, long after the URL has changed.
  useEffect(() => { captureReferral(window.location.search); }, []);

  const dotsRef = useRef<HTMLCanvasElement>(null);
  const [flippedAgent, setFlippedAgent] = useState<string | null>(null);
  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

    // The typewriter that used to run here is gone with the terminal. It wrote through
    // innerHTML with a hand-rolled escaper, held a timeout chain no cleanup ever cancelled,
    // and delayed the hero's most concrete content by four seconds. The frame renders as
    // markup now, so React owns it and there is nothing to tear down.

    const dcv = dotsRef.current;
    if (!dcv) return;
    // `alpha: false` is wrong here — the dots sit over the mesh — but telling the browser
    // reads are rare lets it keep the surface on the GPU.
    const dg = dcv.getContext("2d", { desynchronized: true })!;

    // Decoration must never cost the field its smoothness.
    //
    // This drew ~760 dots a frame at 60fps, each one assigning fillStyle a freshly built
    // `rgba(...)` string — 760 allocations and 760 colour parses per frame, on top of
    // clearing two million pixels. On a mid-range Android that is enough main-thread work
    // to make typing in the hero input stutter, which is exactly what it did. The input is
    // the product's first interaction; a background shimmer does not get to degrade it.
    //
    // Four changes, none of them visible: cap the pixel ratio, halve the frame rate, group
    // the fills by opacity, and stop entirely when nobody can see it.
    const DPR = Math.min(devicePixelRatio || 1, 2);
    /** A slow shimmer gains nothing from 60fps and costs twice the work. */
    const FRAME_MS = 1000 / 30;
    /** Opacity buckets. fillStyle is set once per bucket instead of once per dot. */
    const STEPS = 10;

    let DW = 0, DH = 0, GAP = 0, dots: { x: number; y: number; ph: number }[] = [], raf = 0;
    let last = 0, visible = true;
    const buckets: { x: number; y: number; s: number }[][] = Array.from({ length: STEPS }, () => []);

    const dsize = () => {
      if (!dcv.parentElement) return;
      const r = dcv.parentElement.getBoundingClientRect();
      DW = dcv.width = r.width * DPR;
      DH = dcv.height = r.height * DPR;
      GAP = 26 * DPR;
      dots = [];
      for (let y = GAP / 2; y < DH; y += GAP)
        for (let x = GAP / 2; x < DW; x += GAP) dots.push({ x, y, ph: x * 0.011 + y * 0.017 });
    };

    const paint = (t: number) => {
      dg.clearRect(0, 0, DW, DH);
      const tt = t * 0.00028;
      for (const b of buckets) b.length = 0;
      for (const d of dots) {
        const w = Math.sin(d.x * 0.0016 + d.y * 0.0011 + tt * 2 + d.ph) * 0.5 + 0.5;
        const w2 = Math.sin(d.y * 0.002 - tt * 1.4) * 0.5 + 0.5;
        const b = w * 0.7 + w2 * 0.3;
        const s = (1.1 + b * 1.9) * DPR;
        // Quantised, not rounded to a colour string: the difference between 0.031 and 0.034
        // opacity on a 2px dot is not perceivable, and pretending it is costs a parse.
        const step = Math.min(STEPS - 1, (b * STEPS) | 0);
        buckets[step].push({ x: d.x - s / 2, y: d.y - s / 2, s });
      }
      for (let i = 0; i < STEPS; i++) {
        const list = buckets[i];
        if (!list.length) continue;
        dg.fillStyle = `rgba(250,250,250,${(0.03 + (i / STEPS) * 0.1).toFixed(3)})`;
        for (const r of list) dg.fillRect(r.x, r.y, r.s, r.s);
      }
    };

    const ddraw = (t: number) => {
      raf = requestAnimationFrame(ddraw);
      if (!visible || t - last < FRAME_MS) return;
      last = t;
      paint(t);
    };

    dsize();
    addEventListener("resize", dsize);

    // Scrolled past, or the tab is in the background: the loop keeps being scheduled but
    // paints nothing. A canvas animating under content nobody is looking at is pure cost.
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 });
    io.observe(dcv);
    const onHidden = () => { visible = document.visibilityState === "visible"; };
    document.addEventListener("visibilitychange", onHidden);

    if (reduce) paint(0);
    else raf = requestAnimationFrame(ddraw);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", dsize);
      document.removeEventListener("visibilitychange", onHidden);
      io.disconnect();
    };
  }, []);

  return (
    <div className="landing">
      <nav>
        <div className="nav-in">
          <a href="/" className="logo" aria-label="Populr home">Populr.</a>
          <div className="nav-r">
            {/* The mega menu.
                Open on hover and on keyboard focus, closed otherwise — :focus-within does
                the second half, which is why there is no React state here. A menu driven by
                useState needs its own outside-click handler, its own Escape handler, and its
                own focus management, and gets at least one of the three wrong. CSS already
                knows when something inside is focused.

                Every entry points at a page that exists. A menu advertising surfaces we have
                not built is a promise the next click breaks. */}
            <div className="nav-menu">
              <button type="button" className="nav-trigger" aria-haspopup="true">
                Product
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              <div className="nav-panel">
                <div className="nav-col">
                  <p className="label">The product</p>
                  {[
                    ["#how", "How it works", "One URL in, today's plan out."],
                    ["#agents", "The agents", "Every role a marketing team would hire."],
                    ["#integrations", "Connects to", "Your site, your analytics, your accounts."],
                    ["#pricing", "Pricing", "One plan. First month free."],
                  ].map(([href, t, d]) => (
                    <a key={href} href={href} className="nav-item">
                      <span className="nav-item-t">{t}</span>
                      <span className="nav-item-d">{d}</span>
                    </a>
                  ))}
                </div>
                <div className="nav-col nav-col-alt">
                  <p className="label">Go to</p>
                  {[
                    ["/app", "Dashboard", "Your daily run and the CMO chat."],
                    ["/guides", "Guides", "How GEO works, and why AI tools invent statistics."],
                    ["/studio/launch", "Launch workspace", "Plan and ship a launch end to end."],
                    ["/studio/integrations", "Integrations", "Connect accounts and manage billing."],
                  ].map(([href, t, d]) => (
                    <a key={href} href={href} className="nav-item">
                      <span className="nav-item-t">{t}</span>
                      <span className="nav-item-d">{d}</span>
                    </a>
                  ))}
                </div>
              </div>
            </div>
            {/* The menu's stand-in below its breakpoint. A hover panel needs a pointer and
                needs room; neither is true on a phone. Rather than dropping the destination
                entirely, the narrow layout keeps the one link the menu led with. */}
            <a href="#how" className="nav-compact">How it works</a>
            <a href="#pricing">Pricing</a>
            <a href="/early-access" className="btn btn-ghost btn-sm">Early access</a>
            <a href="/app" className="btn">Try free <span className="kbd">1 mo</span></a>
          </div>
        </div>
      </nav>

      <header>
        {/* Behind the dots: the drifting light. Both are decoration and neither is
            announced to a screen reader. */}
        <div className="hero-mesh" aria-hidden="true"><i /><i /><i /><i /></div>
        <div className="hero-grain" aria-hidden="true" />
        <canvas className="dots" ref={dotsRef} aria-hidden="true" />
        <div className="wrap" style={{ position: "relative", zIndex: 2 }}>
          <span className="pill"><i />now in early access</span>
          <h1>Meet <span className="name">Populr.</span><br /><span className="headline-tail">Your AI CMO.</span></h1>
          <p className="sub">Paste your website. Populr reads it, works out your positioning, and builds today&apos;s plan.</p>

          {/* The input is the hero.
              It used to be two buttons here and the real thing a page away, which asks
              somebody to commit before they have seen anything. The product's whole promise
              is that one URL is enough — so the page should ask for one URL, and the fastest
              way to believe a claim is to watch it happen.

              A plain GET form: no JavaScript needed to submit, and /app reads ?url= and
              starts on arrival. */}
          {/* Still a plain GET form that works with JavaScript off; the handler only tidies
              what gets sent. Someone pasting a URL brings whatever was on the clipboard with
              it — a trailing space, a newline out of a doc — and while canonicalSource trims
              it later, the address bar in between should not show %20%20. */}
          <form
            className="hero-form"
            action="/app"
            method="get"
            onSubmit={(e) => {
              const field = e.currentTarget.elements.namedItem("url") as HTMLInputElement | null;
              if (field) field.value = field.value.trim();
            }}
          >
            {/* type="text", not type="url".
                
                With type="url" the browser refuses "linear.app" before any of our code runs —
                it demands a scheme and shows its own "Please enter a URL" bubble. Nobody types
                https://. canonicalSource() has always prepended it for a bare domain, so the
                only thing rejecting the shorter form was the input itself.
                
                inputMode="url" still gets the URL keyboard on a phone, which is the part of
                type="url" worth keeping. autoCapitalize is off because iOS capitalises the
                first letter of a text field by default and "Linear.app" is not a host. */}
            <input
              type="text"
              name="url"
              placeholder="yourcompany.com"
              aria-label="Your website"
              inputMode="url"
              autoComplete="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              /* "Go" on the phone keyboard rather than a newline glyph. The field submits,
                 so the key that submits it should say so. */
              enterKeyHint="go"
              required
            />
            <button type="submit" aria-label="Analyze my website">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h13M12 5l7 7-7 7" />
              </svg>
            </button>
          </form>
          <p className="under">free for a month · no card · nothing publishes without you</p>

          {/* Ask an assistant about us, rather than waiting to be cited by one.
              
              Okara does this and it is the right instinct: the people evaluating an AI CMO
              are the same people who ask ChatGPT before they ask Google. A prefilled query is
              also the only honest way to influence an AI answer — you cannot buy a citation,
              but you can make the question easy to ask.
              
              Plain links with an encoded query. No SDK, no tracking, nothing to break. */}
          <div className="aisum">
            <span>Ask an AI about Populr</span>
            <span className="aisum-links">
              {([
                ["ChatGPT", "https://chatgpt.com/?q="],
                ["Claude", "https://claude.ai/new?q="],
                ["Perplexity", "https://www.perplexity.ai/search?q="],
              ] as const).map(([name, base]) => (
                <a
                  key={name}
                  href={`${base}${encodeURIComponent("What is Populr (trypopulr.in) and how does it compare to hiring a marketing agency?")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {name}
                </a>
              ))}
            </span>
          </div>

          {/* Supa Launch badge. Their asset on their CDN, so the host is allow-listed in
              the CSP's img-src — without that the image is silently blocked and the page
              shows a broken frame with nothing in the console to explain it.

              width/height are set rather than left to `height: auto` so the space is
              reserved before the SVG arrives. An unsized remote image directly under the
              call to action shifts the buttons downward as it loads, which is the one place
              on the page where a jump costs a click. */}
          <a
            className="launch-badge"
            href="https://supalaun.ch/projects/populr"
            target="_blank"
            rel="noopener noreferrer"
            title="Supa Launch Top 2 Daily Winner"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://r2.direasy-multi-tenant.focusapps.app/uploads/616d0b1a-3979-4b8c-94d1-b4f1fedd3ead/1783046775816/iwwixene3dh/top2-dark.svg"
              alt="Supa Launch — Top 2 Daily Winner"
              width={195}
              height={44}
            />
          </a>
          {/* The product frame.
              Arcade's hero ends on a framed screenshot of the app. The frame is the whole
              trick: the same content in a bare div reads as a picture of software, and
              inside a bordered container with its own title bar it reads as software.

              Labelled as an example rather than left to imply real account data — the
              numbers below are illustrative and there is no honest way to present them
              as anything else. */}
          <figure className="frame">
            <div className="frame-bar">
              <span className="frame-live" aria-hidden="true" />
              <span className="frame-title">Today&apos;s plan</span>
              <span className="frame-tag">example</span>
            </div>
            <div className="frame-body">
              <p className="frame-lede">
                Populr checked your site, GA4 and Search Console. Here is what it decided —
                and what it refused to do.
              </p>
              <ul className="plan">
                {PLAN_ROWS.map((r) => (
                  <li key={r.task} className={"plan-row plan-" + r.verdict}>
                    <span className="plan-verdict">{r.verdict === "do" ? "Do today" : "Skipped"}</span>
                    <span className="plan-main">
                      <span className="plan-task">{r.task}</span>
                      <span className="plan-why">{r.why}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <figcaption className="frame-foot">
              Three things skipped, one worth your morning. The reason is always attached.
            </figcaption>
          </figure>
        </div>
      </header>

      {/* The three ways into the product, stated once. Replaces two near-identical
          sections that between them offered six CTAs and twelve equal-weight links —
          when everything is primary, nothing is. */}
      <section id="start" className="start">
        <div className="wrap">
          <p className="label">Start here</p>
          <h2 style={{ marginTop: 14 }}>{COUNT_WORD} ways in.</h2>
          <p className="start-lede">
            {WAYS.length === 2 ? "Both" : `All ${COUNT_WORD.toLowerCase()}`} start the same way — paste
            your site, and Populr reads it before it writes anything. You land exactly where you were
            heading.
          </p>

          <div className="start-grid">
            {WAYS.map((w, i) => (
              <a key={w.title} href={w.href} className={"start-row" + (i === 0 ? " start-primary" : "")}>
                <span className="start-n">{String(i + 1).padStart(2, "0")}</span>
                <span className="start-b">
                  <span className="start-t">{w.title}</span>
                  <span className="start-d">{w.desc}</span>
                </span>
                <span className="start-a">→</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* How it works, told as three acts rather than three features.
          
          The middle act is the one nobody else in the category has. Every competitor's
          "step 2" is a list of agents producing more; ours is the product deciding what not
          to do and writing down why. That is the whole argument, so it gets the space.
          
          The documents are named as files on purpose. "Populr understands your brand" is a
          claim; product-information.md is a thing you can open and correct. */}
      <section id="how">
        <div className="wrap">
          <p className="label">How it works</p>
          <h2 style={{ marginTop: 14 }}>Read the business. Decide. Then publish.</h2>
          <p className="start-lede">
            Most tools start at step three and generate. Populr will not write a line until it
            can say who your buyers are and what you sell.
          </p>

          <div className="act">
            <div className="act-n mono">01</div>
            <div className="act-b">
              <h3>It reads first</h3>
              <p>
                One URL. Populr reads your site, and your GA4 and Search Console if you connect
                them, then writes four documents about your business — and keeps them where you
                can read and correct them.
              </p>
              {/* Four, not five. Content strategy is not one of them yet, and listing a file
                  that does not exist is the kind of small lie that costs a customer the first
                  time they click it. */}
              <ul className="docs-strip">
                {["product-information.md", "competitor-analysis.md", "brand-voice.md", "marketing-strategy.md"].map((d) => (
                  <li key={d} className="mono">{d}</li>
                ))}
              </ul>
              <p className="act-note">Every agent reads these before it writes a word, so nothing drifts off-message.</p>
            </div>
          </div>

          <div className="act">
            <div className="act-n mono">02</div>
            <div className="act-b">
              <h3>It decides — and says no</h3>
              <p>
                This is the part other tools skip. Populr looks at everything it could do today
                and refuses most of it, with the reason attached. Four articles for a keyword
                three incumbents already own is not work, it is a quarter.
              </p>
              <div className="act-receipt">
                <div><span className="mono">skipped</span> Write 4 articles for &quot;best crm&quot; <em>— won&apos;t rank</em></div>
                <div><span className="mono">skipped</span> Daily LinkedIn posts <em>— your buyers aren&apos;t there this week</em></div>
                <div className="do"><span className="mono">do today</span> Fix the pricing page <em>— 61% leave in 9s</em></div>
              </div>
              <p className="act-note">You can disagree with any of it. The reasoning is always shown.</p>
            </div>
          </div>

          <div className="act">
            <div className="act-n mono">03</div>
            <div className="act-b">
              <h3>You approve. It publishes.</h3>
              <p>
                The few things worth doing arrive written, in your voice, sized for where they
                are going. Approve one and it publishes through your own connected account.
                Nothing leaves without you.
              </p>
              <p className="act-note">Disconnect an account and Populr stops reaching it immediately.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="agents">
        <div className="wrap">
          <div style={{ textAlign: "center" }}>
            <p className="label">The team</p>
            <h2 style={{ marginTop: 14 }}>Every agent a marketing team would hire.<br />You stay in control.</h2>
            <p className="sub">Agents do the heavy lifting. Nothing ships without your sign-off.</p>
          </div>
          <div className="agrid">
            {AGENTS.map((a) => (
              <button
                className={"acell" + (flippedAgent === a.name ? " is-flipped" : "")}
                key={a.name}
                type="button"
                onClick={() => setFlippedAgent((current) => current === a.name ? null : a.name)}
                aria-pressed={flippedAgent === a.name}
                aria-label={`${a.name}: ${flippedAgent === a.name ? "show overview" : "show details"}`}
              >
                <span className="aflip">
                  <span className="aface afront">
                    <span className="ahead">
                      <span className="aic" style={{ ["--ac" as string]: a.c } as React.CSSProperties}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">{a.icon}</svg>
                      </span>
                      <span className="agent-name">{a.name}</span>
                      {a.soon && <span className="soon">Early access</span>}
                    </span>
                    <span className="agent-copy">{a.desc}</span>
                    <span className="flip-hint">Click for details</span>
                  </span>
                  <span className="aface aback">
                    <span className="label">What it does</span>
                    <span className="agent-name">{a.name}</span>
                    <span className="agent-copy">{AGENT_DETAILS[a.name]}</span>
                    <span className="flip-hint">Click to return</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* What Populr plugs into.
          Two columns because they are two different kinds of access and conflating them
          would overstate what we do. Reading a site or an analytics property is one-way and
          needs nothing from you beyond a URL. Publishing goes through an account you connect
          yourself, and it is the half people are right to be careful about — so the note
          under it says plainly that nothing leaves without approval.

          The publish list is SOCIAL_PLATFORMS from lib/social/types.ts, in the same order.
          Whether a given platform reaches the real provider depends on app credentials being
          configured, which is an environment fact and not something a static page can claim,
          so the copy says "through your own account" rather than "live". */}
      <section id="integrations" className="integrations">
        <div className="wrap">
          <div style={{ textAlign: "center" }}>
            <p className="label">Connects to</p>
            <h2 style={{ marginTop: 14 }}>Works with the accounts<br />you already have.</h2>
            <p className="sub">No new tool to migrate into. Populr reads what exists and writes back through it.</p>
          </div>

          <div className="int-grid">
            <div className="int-card">
              <p className="label">Reads</p>
              <p className="int-lede">Enough to know what your business is and where revenue comes from.</p>
              <div className="int-chips">
                {["Your website", "Google Analytics 4", "Search Console", "Instagram", "LinkedIn", "X", "YouTube", "Google Business Profile"].map((s) => (
                  <span className="int-chip" key={s}>{s}</span>
                ))}
              </div>
            </div>

            <div className="int-card">
              <p className="label">Publishes through</p>
              <p className="int-lede">Your own connected account — Populr never posts from a Populr page.</p>
              <div className="int-chips">
                {["LinkedIn", "Instagram", "Facebook Pages", "X", "Threads", "Pinterest"].map((s) => (
                  <span className="int-chip" key={s}>{s}</span>
                ))}
              </div>
              <p className="int-note">
                Every post waits for your approval. Disconnect an account and Populr stops
                reaching it immediately.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="compare">
        <div className="wrap">
          <p className="label">The math</p>
          <h2 style={{ marginTop: 14 }}>What Populr replaces vs. what it costs.</h2>
          <div className="cmp">
            <div className="cmp-row cmp-head"><span>What needs doing</span><span>Hiring it out</span><span className="hi">With Populr</span></div>
            {[
              ["Marketing generalist", "$5,000/mo"], ["SEO agency", "$4,000/mo"], ["Content writer", "$1,500/mo"],
              ["Social media manager", "$1,500/mo"], ["Community & Reddit growth", "$1,000/mo"],
            ].map(([r, c]) => (
              <div className="cmp-row" key={r}><span>{r}</span><span>{c}</span><span className="hi"><Icon name="check" size={14} /></span></div>
            ))}
            <div className="cmp-row"><span>AI-search visibility (GEO)</span><span className="na">not offered</span><span className="hi"><Icon name="check" size={14} /></span></div>
            <div className="cmp-row"><span>Saying no to busywork</span><span className="na">rare</span><span className="hi"><Icon name="check" size={14} /></span></div>
            <div className="cmp-row cmp-total"><span>Total per month</span><span className="strike">$13,000+</span><span className="hi">$15/mo</span></div>
          </div>
        </div>
      </section>

      {/* borderBottom:0 used to live here to stop the last section drawing a divider above
          the footer. Sections are cards now — that inline style only knocked the bottom out
          of this one. */}
      <section id="pricing">
        <div className="wrap">
          <p className="label">Pricing</p>
          <h2 style={{ marginTop: 14 }}>One plan. First month free.</h2>
          <div className="price">
            <div>
              <div className="amt"><span className="was">$49</span>$15<small> /mo after your free month</small></div>
              <p className="inc">all channels · unlimited drafts · cancel anytime</p>
            </div>
            <a href="/app" className="btn btn-lg">Try free for a month</a>
          </div>
        </div>
      </section>

      {/* Entry point into the existing Launch Workspace (/studio/launch). This is the
          bridge from "I write posts" to "Populr runs my marketing" — it links to the
          workspace that already exists rather than introducing another one. */}
      <footer>
        <div className="wrap" style={{ display: "flex", justifyContent: "space-between", width: "100%", flexWrap: "wrap", gap: 10 }}>
          <a href="/" className="footer-logo" aria-label="Populr home">Populr.</a>
          <span style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <a href="#how" style={{ color: "var(--faint)", textDecoration: "none" }}>how it works</a>
            <a href="#pricing" style={{ color: "var(--faint)", textDecoration: "none" }}>pricing</a>
            {/* Both of these were reachable only from the sitemap. Search Console reported
                them as crawled-but-not-indexed, which is what an orphan page earns: the
                crawler has no signal that anything on the site considers them worth linking
                to. Footer links are the cheapest way to say otherwise. */}
            <a href="/guides" style={{ color: "var(--faint)", textDecoration: "none" }}>guides</a>
            <a href="/worked" style={{ color: "var(--faint)", textDecoration: "none" }}>what worked</a>
            <a href="/early-access" style={{ color: "var(--faint)", textDecoration: "none" }}>early access</a>
            <a href="mailto:team@trypopulr.in" style={{ color: "var(--faint)", textDecoration: "none" }}>contact</a>
            <a href="/privacy" className="foot-btn">Privacy Policy</a>
            <a href="/terms" className="foot-btn">Terms of Service</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
