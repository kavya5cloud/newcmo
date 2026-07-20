import { createLaunch } from "@/lib/launch/engine";
import type { LaunchInput } from "@/lib/launch/types";
import {
  PublishingEngine, buildCalendar, calendarView, packageFromLaunchPlan,
  getPublishingRegistry, ApprovalWorkflow,
} from "@/lib/publishing";

// Marketing Dashboard (Part 10) — the execution cockpit. Every panel is derived from a
// single Launch Engine plan routed through the publishing layer: nothing is mocked.
// Sections: Publishing Queue, Approval Queue, Calendar, Campaign Timeline, Content
// Packages, Publishing Status, Dependency Viewer, Platform Health, Upcoming Launches.
const SAMPLE: LaunchInput = {
  launchType: "ai_tool_launch",
  mission: "Launch Populr, the AI CMO",
  business: { name: "Populr", audience: "seed-stage founders", oneLiner: "an AI CMO that reasons" },
  timelineDays: 28,
};

const NAV = ["Queue", "Approvals", "Calendar", "Timeline", "Packages", "Status", "Dependencies", "Platforms", "Upcoming"];

export default async function PublishingDashboard() {
  const plan = createLaunch(SAMPLE);
  const pkg = packageFromLaunchPlan(plan);
  const events = buildCalendar(plan);
  const weeks = calendarView(events, "week");

  // Lifecycle: move the first few assets partway through so the queue shows real stages.
  const engine = new PublishingEngine({ dependencyGraph: plan.dependencies });
  engine.load(plan.publishingSchedule);
  const keys = plan.publishingSchedule.slice(0, 6).map((s) => s.assetKey);
  keys.forEach((k, i) => { for (let n = 0; n < (i % 4); n++) { if (engine.get(k)!.stage === "approval") engine.approve(k); else engine.advance(k); } });
  const summary = engine.summary();

  // Approval queue: what still needs each role.
  const approvals = new ApprovalWorkflow();
  approvals.bulkApprove(keys.slice(0, 2), "creative_director", "director");
  const pendingDirector = approvals.pendingFor(pkg.assets.map((a) => a.assetKey), "creative_director");

  const health = await getPublishingRegistry().health();
  const g = plan.dependencies;
  const maxDepth = g.nodes.reduce((m, n) => Math.max(m, n.depth), 0);

  return (
    <section className="st-section lw">
      <header className="st-shead">
        <span className="label">Marketing · Publishing</span>
        <h1>Execute the launch</h1>
        <p>
          {pkg.assets.length} assets across {health.length} platforms — scheduled, approved and
          published through provider-agnostic adapters. Nothing bypasses the Asset Graph or approval.
        </p>
        <nav className="lw-subnav">{NAV.map((s) => <a key={s} href={`#${s.toLowerCase()}`}>{s}</a>)}</nav>
      </header>

      {/* Publishing Queue */}
      <section id="queue" className="lw-block">
        <h2 className="lw-h2">Publishing Queue</h2>
        <div className="lw-pipe">
          {["draft", "creative_review", "approval", "scheduled", "publishing", "published", "measured", "archived"].map((s, i) => (
            <span key={s} className="lw-pipe-stage">{s.replace(/_/g, " ")} <b className="pub-count">{summary[s as keyof typeof summary]}</b>{i < 7 ? <span className="lw-pipe-arrow">→</span> : null}</span>
          ))}
        </div>
        <div className="lw-cards">
          {engine.all().slice(0, 8).map((i) => (
            <div key={i.assetKey} className="lw-card lw-slot">
              <div className="lw-card-h">{i.assetKey.split(":")[1]?.replace(/_/g, " ") ?? i.assetKey}</div>
              <div className="lw-meta">stage <span className="lw-stage">{i.stage.replace(/_/g, " ")}</span>{i.failed ? " · failed" : ""}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Approval Queue */}
      <section id="approvals" className="lw-block">
        <h2 className="lw-h2">Approval Queue</h2>
        <p className="lw-muted lw-sub">Awaiting Creative Director sign-off ({pendingDirector.length}).</p>
        <div className="lw-chips">
          {pendingDirector.slice(0, 12).map((k) => <span key={k} className="lw-chip">{k.split(":")[1]?.replace(/_/g, " ") ?? k}</span>)}
        </div>
      </section>

      {/* Calendar (week view) */}
      <section id="calendar" className="lw-block">
        <h2 className="lw-h2">Calendar</h2>
        <div className="lw-timeline">
          {weeks.map((b) => (
            <div key={b.key} className="lw-week">
              <div className="lw-week-h">{b.label}<span className="lw-week-phase">{b.events.length} posts</span></div>
              <ul className="lw-week-items">
                {b.events.map((e) => <li key={e.assetKey}>{e.label}<span className="lw-week-ch">{e.platform}</span></li>)}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Campaign Timeline */}
      <section id="timeline" className="lw-block">
        <h2 className="lw-h2">Campaign Timeline</h2>
        <div className="lw-cards">
          {plan.campaigns.map((c) => (
            <div key={c.id} className="lw-card">
              <div className="lw-card-h">{c.title}</div>
              <div className="lw-meta">{c.assetPlan.summary.total} assets · {c.channels.join(", ")}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Content Packages */}
      <section id="packages" className="lw-block">
        <h2 className="lw-h2">Content Package</h2>
        <p className="lw-muted lw-sub">{pkg.title} · {pkg.assets.length} assets · {pkg.lineage.length} lineage links</p>
        <div className="lw-chips">
          {pkg.assets.slice(0, 16).map((a) => (
            <span key={a.assetKey} className="lw-chip">{a.label} <span className="pub-plat">{a.platform}</span></span>
          ))}
        </div>
      </section>

      {/* Publishing Status */}
      <section id="status" className="lw-block">
        <h2 className="lw-h2">Publishing Status (events)</h2>
        <div className="lw-chips">
          {Object.entries(engine.bus.counts()).map(([type, n]) => (
            <span key={type} className="lw-chip">{type.replace("asset.", "")} <b className="pub-count">{n}</b></span>
          ))}
        </div>
      </section>

      {/* Dependency Viewer */}
      <section id="dependencies" className="lw-block">
        <h2 className="lw-h2">Dependency Viewer</h2>
        <div className="lw-dep">
          {Array.from({ length: maxDepth + 1 }, (_, d) => (
            <div key={d} className="lw-dep-col">
              <div className="lw-dep-h">Depth {d}</div>
              {g.nodes.filter((n) => n.depth === d).map((n) => (
                <div key={n.key} className="lw-dep-node">{n.label}</div>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* Platform Health */}
      <section id="platforms" className="lw-block">
        <h2 className="lw-h2">Platform Health</h2>
        <div className="lw-cards">
          {health.map((h) => (
            <div key={h.platform} className="lw-card lw-perf">
              <div className="lw-perf-metric">{h.platform}</div>
              <div className="pub-health">{h.healthy ? "● healthy" : "● down"}</div>
              <div className="lw-muted">{h.rateLimitPerMin}/min</div>
            </div>
          ))}
        </div>
      </section>

      {/* Upcoming Launches */}
      <section id="upcoming" className="lw-block">
        <h2 className="lw-h2">Upcoming</h2>
        <div className="lw-rel">
          {events.slice(0, 8).sort((a, b) => a.dayOffset - b.dayOffset).map((e) => (
            <span key={e.assetKey} className="lw-rel-node">Day {e.dayOffset} · {e.label} <span className="pub-plat">{e.platform}</span></span>
          ))}
        </div>
      </section>
    </section>
  );
}
