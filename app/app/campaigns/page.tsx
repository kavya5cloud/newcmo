"use client";
import { useCallback, useEffect, useState } from "react";
import { loadState, workspaceId, type Profile } from "@/lib/store";
import { CAMPAIGN_GOALS, type CampaignTask } from "@/lib/services/contracts";

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

export default function Missions() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [url, setUrl] = useState("");
  const [ready, setReady] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [planning, setPlanning] = useState<string | null>(null); // goal id being planned
  const [err, setErr] = useState<string | null>(null);

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
                  <div className="m-label">Tasks</div>
                  <div className="m-tasks">
                    {c.tasks.map((t, i) => {
                      const isDone = c.done_tasks.includes(i);
                      return (
                        <button key={i} className={"m-task" + (isDone ? " done" : "")} onClick={() => toggleTask(c, i)}>
                          <span className="m-check">{isDone ? "✓" : "○"}</span>
                          <span className="m-tbody">
                            <span className="m-ttitle">{t.title}</span>
                            <span className="m-tmeta">week {t.week} · {t.channel}{t.intent ? ` — ${t.intent}` : ""}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
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
    </div>
  );
}
