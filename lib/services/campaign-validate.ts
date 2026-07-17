// Pure validation for campaign creation — no I/O, unit-tested in
// tests/campaign-validate.test.ts. The LLM plans the campaign, but nothing enters
// the database unless it passes this shape check (LLMs drop fields; we don't).

import { CAMPAIGN_GOALS, type CampaignInput, type CreativeBrief } from "@/lib/services/contracts";

const KNOWN_CHANNELS = ["reddit", "seo", "geo", "x", "linkedin", "articles", "hn"];
const BRIEF_FIELDS: (keyof CreativeBrief)[] = [
  "objective", "audience", "keyMessage", "emotionalAngle", "proof", "cta", "visualDirection", "successMetric",
];

export type ValidationResult = { ok: true; value: CampaignInput } | { ok: false; errors: string[] };

function str(v: unknown, max = 500): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.length <= max ? t : null;
}

export function validateCampaignInput(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const r = (raw ?? {}) as Record<string, unknown>;

  const goalIds = CAMPAIGN_GOALS.map((g) => g.id as string);
  const goal = str(r.goal, 60);
  if (!goal || !(goalIds.includes(goal) || goal.length >= 3)) errors.push("goal");

  const title = str(r.title, 120);
  if (!title || title.length < 3) errors.push("title");

  const briefRaw = (r.brief ?? {}) as Record<string, unknown>;
  const brief = {} as CreativeBrief;
  for (const f of BRIEF_FIELDS) {
    const v = str(briefRaw[f]);
    if (!v) errors.push(`brief.${f}`);
    else brief[f] = v;
  }

  const channels = Array.isArray(r.channels)
    ? [...new Set(r.channels.map((c) => String(c).toLowerCase().trim()))].filter((c) => KNOWN_CHANNELS.includes(c))
    : [];
  if (channels.length < 1 || channels.length > 6) errors.push("channels");

  const timelineDays = Number(r.timelineDays);
  if (!Number.isFinite(timelineDays) || timelineDays < 7 || timelineDays > 90) errors.push("timelineDays");

  const priority = Number(r.priority);
  if (!Number.isInteger(priority) || priority < 1 || priority > 5) errors.push("priority");

  const expectedImpact = str(r.expectedImpact, 300);
  if (!expectedImpact) errors.push("expectedImpact");

  const reasoning = str(r.reasoning, 2000);
  if (!reasoning || reasoning.length < 20) errors.push("reasoning");

  const tasksRaw = Array.isArray(r.tasks) ? r.tasks : [];
  const tasks = tasksRaw
    .map((t) => {
      const o = (t ?? {}) as Record<string, unknown>;
      const tTitle = str(o.title, 200);
      const channel = String(o.channel ?? "").toLowerCase().trim();
      const week = Number(o.week);
      const intent = str(o.intent, 200) || "";
      if (!tTitle || tTitle.length < 5 || !KNOWN_CHANNELS.includes(channel)) return null;
      return { week: Number.isFinite(week) ? Math.min(13, Math.max(1, Math.round(week))) : 1, channel, title: tTitle, intent };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);
  if (tasks.length < 3 || tasks.length > 14) errors.push("tasks");

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      goal: goal!, title: title!, brief, channels, timelineDays: Math.round(timelineDays),
      priority, expectedImpact: expectedImpact!, reasoning: reasoning!, tasks,
    },
  };
}
