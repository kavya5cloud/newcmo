"use client";
import { useCallback, useEffect, useState } from "react";
import { loadState, workspaceId, type Profile } from "@/lib/store";
import { CAMPAIGN_GOALS, type CampaignTask } from "@/lib/services/contracts";
import type { AssetRow } from "@/lib/services/assets";

// Marketing Missions — the AI CMO assigns work, not tips.
// Flow (decision-first, enforced): pick a mission → decision engine ranks channels
// from real outcome data → LLM plans the campaign + creative brief → validated and
// stored server-side → every task becomes a tracked recommendation.

type Campaign = {
  id: string;
  goal: string;
  title: string;
  brief: Record<string, string>;
  channels: string[];
  timeline_days: number;
  priority: number;
  expected_impact: string;
  reasoning: string;
  tasks: CampaignTask[];
  status: string;
  created_at: string;
  done_tasks: number[];
};

async function ai(prompt: string, url?: string): Promise<string> {
  const r = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, url: url || null }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error([d.error, d.detail].filter(Boolean).join(" · ") || "api " + r.status);
  return d.text as string;
}

function parseJSON(txt: string) {
  const clean = txt.replace(/```json|```/g, "").trim();
  const s = clean.indexOf("{"), e = clean.lastIndexOf("}");
  return JSON.parse(clean.slice(s, e + 1));
}

const GOAL_LABEL = Object.fromEntries(CAMPAIGN_GOALS.map((g) => [g.id, g.label]));

const BRIEF_LABELS: [string, string][] = [
  ["objective", "Objective"], ["audience", "Audience"], ["keyMessage", "Key message"],
  ["emotionalAngle", "Emotional angle"], ["proof", "Proof"], ["cta", "CTA"],
  ["visualDirection", "Visual direction"], ["successMetric", "Success metric"],
];

const TYPE_LABEL: Record<string, string> = {
  blog: "Blog", linkedin_post: "LinkedIn post", x_thread: "X thread",
  reddit_post: "Reddit post", email: "Email",
};

/** One asset chain = all versions sharing a root_id; latest version is the live one. */
type AssetChain = { rootId: string; latest: AssetRow; versions: AssetRow[]; parentRootId: string | null };

function chainsFromRows(rows: AssetRow[]): AssetChain[] {
  const byRoot = new Map<string, AssetRow[]>();
  for (const r of rows) {
    const list = byRoot.get(r.root_id) || [];
    list.push(r);
    byRoot.set(r.root_id, list);
  }
  return [...byRoot.entries()].map(([rootId, versions]) => {
    versions.sort((a, b) => a.version - b.version);
    return { rootId, latest: versions[versions.length - 1], versions, parentRootId: versions[0].parent_asset_id };
  });
}

function briefText(brief: Record<string, string>): string {
  return BRIEF_LABELS.map(([k, label]) => (brief?.[k] ? `${label}: ${brief[k]}` : null)).filter(Boolean).join("\n");
}

export default function Missions() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [url, setUrl] = useState("");
  const [ready, setReady] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [planning, setPlanning] = useState<string | null>(null); // goal id being planned
  const [err, setErr] = useState<string | null>(null);
  const [assets, setAssets] = useState<Record<string, AssetRow[]>>({}); // campaignId → rows
  const [genBusy, setGenBusy] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ campaign: Campaign; rootId: string } | null>(null);
  const [editorVersion, setEditorVersion] = useState<number | null>(null); // null = latest
  const [editorText, setEditorText] = useState("");
  const [editorBusy, setEditorBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch(`/api/campaigns?wsid=${encodeURIComponent(workspaceId())}`)
      .then((r) => r.json())
      .then((d) => setCampaigns(Array.isArray(d.campaigns) ? d.campaigns : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      const { saved } = await loadState();
      if (saved?.profile) { setProfile(saved.profile); setUrl(saved.url); }
      setReady(true);
      refresh();
    })();
  }, [refresh]);

  async function startMission(goalId: string) {
    if (!profile || planning) return;
    setPlanning(goalId);
    setErr(null);
    try {
      // 1. DECIDE — the engine ranks channels from real outcome data, before any LLM.
      const rank = await fetch(`/api/intel/next?wsid=${encodeURIComponent(workspaceId())}`)
        .then((r) => r.json())
        .catch(() => ({ ranking: [] }));
      const top = (rank.ranking || []).slice(0, 5)
        .map((r: { channel: string; score: number }) => `${r.channel} (score ${r.score})`)
        .join(", ");

      // 2. PLAN — the LLM turns the decision into a campaign + creative brief.
      const goalLabel = GOAL_LABEL[goalId] || goalId;
      const prompt = `You are Populr, the AI CMO for ${profile.name} — ${profile.oneLiner}. Audience: ${profile.audience}. Voice: ${profile.voice}. Positioning: ${profile.positioning}
Mission: ${goalLabel}.
Populr's decision engine ranked the most effective channels for this business (from measured outcomes): ${top || "no data yet — use judgment"}. Prefer higher-ranked channels.
Plan a focused campaign. Output ONLY valid JSON, no markdown, exactly this shape:
{"title":"campaign name (not the mission name)","brief":{"objective":"...","audience":"...","keyMessage":"one sentence","emotionalAngle":"...","proof":"concrete evidence to lean on","cta":"...","visualDirection":"...","successMetric":"how we'll know it worked"},"channels":["2-4 of: reddit,seo,geo,x,linkedin,articles,hn"],"timelineDays":<7-90>,"priority":<1-5>,"expectedImpact":"honest narrative, no invented numbers","reasoning":"why this plan for this business, referencing the channel ranking","tasks":[{"week":1,"channel":"reddit","title":"specific deliverable in 6-14 words","intent":"what this task achieves"}]}
Give 4-8 tasks total across the timeline, each concrete enough to execute. Never invent statistics.`;

      let campaign: unknown = null;
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 2 && !campaign; attempt++) {
        try { campaign = parseJSON(await ai(prompt, url)); }
        catch (e) { lastErr = e; }
      }
      if (!campaign) throw lastErr || new Error("plan_failed");

      // 3. PERSIST — server validates the creative-brief contract before anything is stored.
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wsid: workspaceId(), url, profile, campaign: { ...(campaign as object), goal: goalId } }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error === "invalid_campaign" ? "plan came back malformed — try again" : d.error || "save failed");
      refresh();
      setOpenId(d.id);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e).slice(0, 160));
    } finally {
      setPlanning(null);
    }
  }

  /* ---------- asset graph (Content Studio) ---------- */

  const loadAssets = useCallback((campaignId: string) => {
    fetch(`/api/studio/assets?wsid=${encodeURIComponent(workspaceId())}&campaignId=${campaignId}`)
      .then((r) => r.json())
      .then((d) => setAssets((a) => ({ ...a, [campaignId]: Array.isArray(d.assets) ? d.assets : [] })))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (openId) loadAssets(openId);
  }, [openId, loadAssets]);

  async function generateGraph(c: Campaign) {
    if (genBusy) return;
    setGenBusy(c.id);
    setErr(null);
    try {
      const brief = briefText(c.brief);
      // ROOT: the cornerstone blog, generated from the creative brief.
      const blogRaw = await ai(
        `You are Populr, the AI CMO. Campaign: "${c.title}".\nCreative brief:\n${brief}\nWrite the cornerstone blog post for this campaign (400-600 words, specific, on-message, no invented statistics).\nOutput ONLY JSON: {"title":"post title","body":"the full post as plain text with short paragraphs"}`,
        url
      );
      const blog = parseJSON(blogRaw) as { title?: string; body?: string };
      if (!blog?.title || !blog?.body) throw new Error("blog generation came back malformed");

      // CHILDREN: derived FROM the blog, not generated independently — one ecosystem.
      const childrenRaw = await ai(
        `You are Populr, the AI CMO. Campaign "${c.title}".\nCreative brief:\n${brief}\nThe cornerstone blog post (source material — derive everything from it, stay consistent):\nTITLE: ${blog.title}\n${String(blog.body).slice(0, 2500)}\nRepurpose the blog into channel assets. Output ONLY JSON, exactly:\n{"linkedin":{"title":"...","body":"LinkedIn post, 120-200 words, ends without hard sell"},"x_thread":{"title":"...","tweets":["5-7 tweets, each under 280 chars, first is the hook"]},"reddit":{"title":"post title","subreddit":"one relevant subreddit","body":"helpful non-promotional Reddit post"},"email":{"subject":"...","body":"newsletter email, 100-180 words"}}`,
        url
      );
      const kids = parseJSON(childrenRaw) as Record<string, { title?: string; body?: string; tweets?: string[]; subject?: string; subreddit?: string }>;

      const graph = [
        { clientKey: "blog", parentKey: null, assetType: "blog", purpose: "Cornerstone content", title: blog.title, body: blog.body, structure: null },
        kids.linkedin?.body && { clientKey: "li", parentKey: "blog", assetType: "linkedin_post", purpose: "Awareness", title: kids.linkedin.title || blog.title, body: kids.linkedin.body, structure: null },
        Array.isArray(kids.x_thread?.tweets) && kids.x_thread.tweets.length && {
          clientKey: "x", parentKey: "blog", assetType: "x_thread", purpose: "Awareness",
          title: kids.x_thread.title || blog.title, body: kids.x_thread.tweets.join("\n\n"),
          structure: { tweets: kids.x_thread.tweets },
        },
        kids.reddit?.body && {
          clientKey: "rd", parentKey: "blog", assetType: "reddit_post", purpose: "High-intent discussion",
          title: kids.reddit.title || blog.title, body: kids.reddit.body,
          structure: kids.reddit.subreddit ? { subreddit: kids.reddit.subreddit } : null,
        },
        kids.email?.body && {
          clientKey: "em", parentKey: "blog", assetType: "email", purpose: "Nurture",
          title: kids.email.subject || blog.title, body: kids.email.body,
          structure: kids.email.subject ? { subject: kids.email.subject } : null,
        },
      ].filter(Boolean);

      const res = await fetch("/api/studio/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wsid: workspaceId(), campaignId: c.id, assets: graph }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || "save failed");
      loadAssets(c.id);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e).slice(0, 160));
    } finally {
      setGenBusy(null);
    }
  }

  async function assetEvent(
    assetId: string,
    event: string,
    campaignId: string,
    extra?: { body?: string; title?: string; metadata?: Record<string, unknown> }
  ) {
    const res = await fetch(`/api/studio/assets/${assetId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wsid: workspaceId(), event, ...extra }),
    }).catch(() => null);
    loadAssets(campaignId);
    return res;
  }

  async function regenerateAsset(c: Campaign, chain: AssetChain, parent: AssetChain | undefined) {
    setEditorBusy("regenerating");
    try {
      const brief = briefText(c.brief);
      const parentCtx = parent ? `\nDerive from this source material and stay consistent with it:\n${parent.latest.body.slice(0, 2500)}` : "";
      const raw = await ai(
        `You are Populr, the AI CMO. Campaign "${c.title}".\nCreative brief:\n${brief}${parentCtx}\nProduce an improved alternative version of this ${TYPE_LABEL[chain.latest.asset_type] || chain.latest.asset_type} (same goal, fresh angle):\nCURRENT VERSION:\n${chain.latest.body.slice(0, 2000)}\nOutput ONLY JSON: {"title":"...","body":"the full asset"}`,
        url
      );
      const next = parseJSON(raw) as { title?: string; body?: string };
      if (!next?.body) throw new Error("regeneration came back malformed");
      await assetEvent(chain.latest.id, "regenerated", c.id, { body: next.body, title: next.title });
      setEditorVersion(null);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e).slice(0, 160));
    } finally {
      setEditorBusy(null);
    }
  }

  function campaignEvent(id: string, event: string, metadata?: Record<string, unknown>) {
    return fetch(`/api/campaigns/${id}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wsid: workspaceId(), event, metadata }),
    }).catch(() => {});
  }

  async function toggleTask(c: Campaign, idx: number) {
    if (c.done_tasks.includes(idx)) return; // event-sourced: done is done
    setCampaigns((cs) => cs.map((x) => x.id === c.id ? { ...x, done_tasks: [...x.done_tasks, idx] } : x));
    await campaignEvent(c.id, "task_done", { taskIndex: idx });
    // The task is also a recommendation — completion feeds the outcome dataset.
    const recId = c.tasks[idx]?.recId;
    if (recId) {
      fetch("/api/intel/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wsid: workspaceId(), recommendationId: recId, event: "completed" }),
      }).catch(() => {});
    }
    const doneCount = c.done_tasks.length + 1;
    if (doneCount >= c.tasks.length) {
      await campaignEvent(c.id, "completed");
      refresh();
    }
  }

  if (!ready) return <div className="missions"><div className="m-empty">Loading…</div></div>;

  return (
    <div className="missions">
      <div className="m-top">
        <a href="/app">← Back to dashboard</a>
        <span className="m-wordmark">Populr.</span>
      </div>

      <h1>Marketing Missions</h1>
      <p className="m-sub">
        Your AI CMO assigns work, not tips. Pick a mission — Populr decides the channels from measured outcomes,
        writes the creative brief, and plans every task.
      </p>

      {!profile ? (
        <div className="m-empty">
          Analyze your business first — missions are planned from your profile.{" "}
          <a href="/app">Go to the dashboard →</a>
        </div>
      ) : (
        <>
          <h2>Start a mission{profile.name ? ` for ${profile.name}` : ""}</h2>
          <div className="m-goals">
            {CAMPAIGN_GOALS.map((g) => (
              <button key={g.id} className="m-goal" disabled={!!planning} onClick={() => startMission(g.id)}>
                {planning === g.id ? "planning…" : g.label}
              </button>
            ))}
          </div>
          {err && <div className="m-err">{err}</div>}
        </>
      )}

      <h2>Active missions</h2>
      {campaigns.length === 0 ? (
        <div className="m-empty">No missions yet. Pick one above — the plan takes a few seconds.</div>
      ) : (
        campaigns.map((c) => {
          const done = c.done_tasks.length;
          const total = c.tasks.length;
          const open = openId === c.id;
          return (
            <div key={c.id} className={"m-card" + (open ? " open" : "")}>
              <button className="m-head" onClick={() => setOpenId(open ? null : c.id)}>
                <span className="m-status" data-s={c.status}>{c.status}</span>
                <span className="m-title">{c.title}</span>
                <span className="m-meta">{GOAL_LABEL[c.goal] || c.goal} · {c.timeline_days}d · {done}/{total} tasks</span>
                <span className="m-bar"><span style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} /></span>
              </button>
              {open && (
                <div className="m-body">
                  <div className="m-label">Creative brief</div>
                  <div className="m-brief">
                    {BRIEF_LABELS.map(([k, label]) => c.brief?.[k] ? (
                      <div key={k}><span>{label}</span>{c.brief[k]}</div>
                    ) : null)}
                  </div>
                  <div className="m-label">Why this plan</div>
                  <p className="m-reason">{c.reasoning}</p>
                  <p className="m-impact">Expected impact: {c.expected_impact} · Channels: {c.channels.join(", ")}</p>
                  <div className="m-label">Mission timeline</div>
                  {[...new Set(c.tasks.map((t) => t.week))].sort((a, b) => a - b).map((w) => (
                    <div key={w}>
                      <div className="m-week">week {w}</div>
                      <div className="m-tasks">
                        {c.tasks.map((t, i) => ({ t, i })).filter(({ t }) => t.week === w).map(({ t, i }) => {
                          const isDone = c.done_tasks.includes(i);
                          return (
                            <button key={i} className={"m-task" + (isDone ? " done" : "")} onClick={() => toggleTask(c, i)}>
                              <span className="m-check">{isDone ? "✓" : "○"}</span>
                              <span className="m-tbody">
                                <span className="m-ttitle">{t.title}</span>
                                <span className="m-tmeta">{t.channel}{t.intent ? ` — ${t.intent}` : ""}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  <div className="m-label">Assets</div>
                  {(() => {
                    const chains = chainsFromRows(assets[c.id] || []);
                    if (!chains.length) {
                      return (
                        <button className="m-activate" disabled={genBusy === c.id} onClick={() => generateGraph(c)}>
                          {genBusy === c.id ? "deriving asset graph…" : "Generate asset graph →"}
                        </button>
                      );
                    }
                    const roots = chains.filter((ch) => !ch.parentRootId);
                    const childrenOf = (rootId: string) => chains.filter((ch) => ch.parentRootId === rootId);
                    const AssetLine = ({ ch, depth }: { ch: AssetChain; depth: number }) => (
                      <button
                        className="m-asset"
                        style={{ marginLeft: depth * 22 }}
                        onClick={() => { setEditor({ campaign: c, rootId: ch.rootId }); setEditorVersion(null); setEditorText(ch.latest.body); }}
                      >
                        <span className="m-atype">{depth > 0 ? "└ " : ""}{TYPE_LABEL[ch.latest.asset_type] || ch.latest.asset_type}</span>
                        <span className="m-atitle">{ch.latest.title}</span>
                        <span className="m-astatus" data-s={ch.latest.status}>{ch.latest.status}{ch.versions.length > 1 ? ` · v${ch.latest.version}` : ""}</span>
                      </button>
                    );
                    return (
                      <div className="m-assets">
                        {roots.map((r) => (
                          <div key={r.rootId}>
                            <AssetLine ch={r} depth={0} />
                            {childrenOf(r.rootId).map((k) => <AssetLine key={k.rootId} ch={k} depth={1} />)}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  {c.status === "draft" && (
                    <button className="m-activate" onClick={async () => { await campaignEvent(c.id, "activated"); refresh(); }}>
                      Activate mission →
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}

      <p className="m-note">
        every task is tracked in the outcome dataset — completions show up in{" "}
        <a href="/worked">what actually worked</a> once results are measured.
      </p>

      {editor && (() => {
        const rows = assets[editor.campaign.id] || [];
        const chains = chainsFromRows(rows);
        const chain = chains.find((ch) => ch.rootId === editor.rootId);
        if (!chain) return null;
        const parent = chain.parentRootId ? chains.find((ch) => ch.rootId === chain.parentRootId) : undefined;
        const shown = editorVersion == null
          ? chain.latest
          : chain.versions.find((v) => v.version === editorVersion) || chain.latest;
        const viewingOld = shown.id !== chain.latest.id;
        const dirty = editorText !== shown.body;
        return (
          <div className="m-overlay" onClick={() => setEditor(null)}>
            <div className="m-editor" onClick={(e) => e.stopPropagation()}>
              <div className="m-ehead">
                <span className="m-atype">{TYPE_LABEL[shown.asset_type] || shown.asset_type}{parent ? " · derived from blog" : ""}</span>
                <span className="m-astatus" data-s={chain.latest.status}>{chain.latest.status}</span>
                <button className="m-eclose" onClick={() => setEditor(null)}>✕</button>
              </div>
              <div className="m-etitle">{shown.title}</div>
              <div className="m-eversions">
                {chain.versions.map((v) => (
                  <button
                    key={v.id}
                    className={"m-vpill" + (v.id === shown.id ? " on" : "")}
                    onClick={() => { setEditorVersion(v.version); setEditorText(v.body); }}
                  >
                    v{v.version}
                  </button>
                ))}
              </div>
              <textarea
                className="m-ebody"
                value={editorText}
                readOnly={viewingOld}
                onChange={(e) => setEditorText(e.target.value)}
              />
              {viewingOld && <div className="m-ehint">viewing v{shown.version} (read-only history) — switch to v{chain.latest.version} to edit</div>}
              <div className="m-eactions">
                <button
                  disabled={!dirty || viewingOld || !!editorBusy}
                  onClick={async () => {
                    setEditorBusy("saving");
                    await assetEvent(chain.latest.id, "edited", editor.campaign.id, { body: editorText });
                    setEditorBusy(null); setEditorVersion(null);
                  }}
                >{editorBusy === "saving" ? "saving…" : "Save as new version"}</button>
                <button
                  disabled={!!editorBusy || chain.latest.status === "approved"}
                  onClick={() => assetEvent(chain.latest.id, "approved", editor.campaign.id)}
                >Approve</button>
                <button
                  disabled={!!editorBusy}
                  onClick={() => regenerateAsset(editor.campaign, chain, parent)}
                >{editorBusy === "regenerating" ? "regenerating…" : "Regenerate"}</button>
                <button
                  disabled={!!editorBusy}
                  className="m-earchive"
                  onClick={async () => { await assetEvent(chain.latest.id, "archived", editor.campaign.id); setEditor(null); }}
                >Archive</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
