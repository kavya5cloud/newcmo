"use client";
import { useEffect, useRef, useState } from "react";

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

const TERM_LINES = [
  { t: "$ poplr run --daily", cls: "p", d: 24 },
  { t: "scanning: site, ga4, search-console … done", cls: "c", d: 10 },
  { t: 'skip  write 4 articles for "best crm"   # won\'t rank', cls: "skip", d: 10 },
  { t: "skip  daily linkedin posts              # buyers aren't there", cls: "skip", d: 10 },
  { t: "skip  reply to 14 reddit threads        # 11 low-intent", cls: "skip", d: 10 },
  { t: "do →  fix pricing page. 61% bounce in 9s. draft attached.", cls: "do", d: 16 },
];

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

export default function Landing() {
  const dotsRef = useRef<HTMLCanvasElement>(null);
  const termRef = useRef<HTMLDivElement>(null);
  const [flippedAgent, setFlippedAgent] = useState<string | null>(null);
  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const body = termRef.current;
    if (body) {
      body.innerHTML = "";
      if (reduce) {
        body.innerHTML = TERM_LINES.map((l) => `<div class="ln ${l.cls}">${esc(l.t)}</div>`).join("");
      } else {
        let li = 0;
        const next = () => {
          if (!termRef.current) return;
          if (li >= TERM_LINES.length) {
            body.insertAdjacentHTML("beforeend", '<div class="ln"><span class="cursor"></span></div>');
            return;
          }
          const l = TERM_LINES[li++];
          const div = document.createElement("div");
          div.className = "ln " + l.cls;
          body.appendChild(div);
          let i = 0;
          const type = () => {
            div.textContent = l.t.slice(0, ++i);
            if (i < l.t.length) setTimeout(type, l.d);
            else setTimeout(next, 260);
          };
          type();
        };
        setTimeout(next, 500);
      }
    }

    const dcv = dotsRef.current;
    if (!dcv) return;
    const dg = dcv.getContext("2d")!;
    let DW = 0, DH = 0, GAP = 0, dots: { x: number; y: number; ph: number }[] = [], raf = 0;
    const dsize = () => {
      if (!dcv.parentElement) return;
      const r = dcv.parentElement.getBoundingClientRect();
      DW = dcv.width = r.width * devicePixelRatio;
      DH = dcv.height = r.height * devicePixelRatio;
      GAP = 26 * devicePixelRatio;
      dots = [];
      for (let y = GAP / 2; y < DH; y += GAP)
        for (let x = GAP / 2; x < DW; x += GAP) dots.push({ x, y, ph: x * 0.011 + y * 0.017 });
    };
    const ddraw = (t: number) => {
      dg.clearRect(0, 0, DW, DH);
      const tt = t * 0.00028;
      for (const d of dots) {
        const w = Math.sin(d.x * 0.0016 + d.y * 0.0011 + tt * 2 + d.ph) * 0.5 + 0.5;
        const w2 = Math.sin(d.y * 0.002 - tt * 1.4) * 0.5 + 0.5;
        const b = w * 0.7 + w2 * 0.3;
        const a = 0.03 + b * 0.1;
        const s = (1.1 + b * 1.9) * devicePixelRatio;
        dg.fillStyle = `rgba(250,250,250,${a.toFixed(3)})`;
        dg.fillRect(d.x - s / 2, d.y - s / 2, s, s);
      }
      if (!reduce) raf = requestAnimationFrame(ddraw);
    };
    dsize();
    addEventListener("resize", dsize);
    if (reduce) ddraw(0);
    else raf = requestAnimationFrame(ddraw);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", dsize); };
  }, []);

  return (
    <div className="landing">
      <nav>
        <div className="nav-in">
          <a href="/" className="logo" aria-label="Poplr home">Poplr.</a>
          <div className="nav-r">
            <a href="#how">How it works</a>
            <a href="#pricing">Pricing</a>
            <a href="/app" className="btn">Try free <span className="kbd">1 mo</span></a>
          </div>
        </div>
      </nav>

      <header>
        <canvas className="dots" ref={dotsRef} aria-hidden="true" />
        <div className="wrap" style={{ position: "relative", zIndex: 2 }}>
          <span className="pill"><i />now in early access</span>
          <h1>Meet <span className="name">Poplr.</span><br /><span className="headline-tail">Your AI CMO.</span></h1>
          <p className="sub">Paste your URL. Poplr learns your product, runs SEO, AI search, Reddit and content daily — and only pings you for what actually moves your numbers.</p>
          <div className="cta-row">
            <a href="/app" className="btn btn-lg">Try free for a month</a>
            <a href="#how" className="btn btn-lg btn-ghost">See how it works</a>
          </div>
          <p className="under">no card · no setup · one URL</p>
          <div className="term" role="img" aria-label="Terminal showing Poplr skipping low-value tasks">
            <div className="term-bar"><b /><b /><b /><span>poplr · daily run</span></div>
            <div className="term-body" ref={termRef} />
          </div>
        </div>
      </header>

      <section id="how">
        <div className="wrap">
          <p className="label">How it works</p>
          <h2 style={{ marginTop: 14 }}>Three steps. No dashboard babysitting.</h2>
          <div className="grid">
            {[
              ["01", "Connect", "One URL. Poplr reads your site, GA4, and Search Console to learn what your business actually is and where revenue comes from."],
              ["02", "Run", "Agents work every channel daily — SEO, AI-search visibility, Reddit, content. Everything drafts in the background."],
              ["03", "Approve", "Poplr skips low-value work with a reason attached and sends you the few things worth doing. Nothing ships without you."],
            ].map(([n, h, p]) => (
              <div className="cell" key={n}>
                <span className="label" style={{ color: "var(--green)" }}>{n}</span>
                <h3>{h}</h3>
                <p>{p}</p>
              </div>
            ))}
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
                      {a.soon && <span className="soon">SOON</span>}
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

      <section id="compare">
        <div className="wrap">
          <p className="label">The math</p>
          <h2 style={{ marginTop: 14 }}>What Poplr replaces vs. what it costs.</h2>
          <div className="cmp">
            <div className="cmp-row cmp-head"><span>What needs doing</span><span>Hiring it out</span><span className="hi">With Poplr</span></div>
            {[
              ["Marketing generalist", "$5,000/mo"], ["SEO agency", "$4,000/mo"], ["Content writer", "$1,500/mo"],
              ["Social media manager", "$1,500/mo"], ["Community & Reddit growth", "$1,000/mo"],
            ].map(([r, c]) => (
              <div className="cmp-row" key={r}><span>{r}</span><span>{c}</span><span className="hi">✓</span></div>
            ))}
            <div className="cmp-row"><span>AI-search visibility (GEO)</span><span className="na">not offered</span><span className="hi">✓</span></div>
            <div className="cmp-row"><span>Saying no to busywork</span><span className="na">rare</span><span className="hi">✓</span></div>
            <div className="cmp-row cmp-total"><span>Total per month</span><span className="strike">$13,000+</span><span className="hi">$15/mo</span></div>
          </div>
        </div>
      </section>

      <section id="pricing" style={{ borderBottom: 0 }}>
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

      <footer>
        <div className="wrap" style={{ display: "flex", justifyContent: "space-between", width: "100%", flexWrap: "wrap", gap: 10 }}>
          <a href="/" className="footer-logo" aria-label="Poplr home">Poplr.</a>
          <span style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <a href="#how" style={{ color: "var(--faint)", textDecoration: "none" }}>how it works</a>
            <a href="#pricing" style={{ color: "var(--faint)", textDecoration: "none" }}>pricing</a>
            <a href="mailto:team@poplr.in" style={{ color: "var(--faint)", textDecoration: "none" }}>contact</a>
            <a href="/privacy" className="foot-btn">Privacy Policy</a>
            <a href="/terms" className="foot-btn">Terms of Service</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
