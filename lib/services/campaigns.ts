import type { Sql } from "@/lib/db";
import { logRecommendations } from "@/lib/intel";
import type { CampaignInput, CampaignEvent, CampaignTask } from "@/lib/services/contracts";

// Campaign Planner service — campaigns are decision containers ("Marketing Missions").
// A campaign row stores the creative brief + plan; task lifecycle is event-sourced:
// each task is ALSO a recommendation row (rec_type=mission_task) so campaign work
// feeds the same recommendation → action → outcome dataset as the feed.

let campaignTablesReady = false;
export async function ensureCampaignTables(sql: Sql) {
  if (campaignTablesReady) return;
  await sql`CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_key TEXT NOT NULL,
    website TEXT NOT NULL,
    goal TEXT NOT NULL,
    title TEXT NOT NULL,
    brief JSONB NOT NULL,
    channels TEXT[] NOT NULL,
    timeline_days INT NOT NULL,
    priority INT NOT NULL DEFAULT 3,
    expected_impact TEXT NOT NULL,
    reasoning TEXT NOT NULL,
    tasks JSONB NOT NULL,
    business_profile_snapshot JSONB,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_campaigns_ws ON campaigns (workspace_key, created_at DESC)`;
  await sql`CREATE TABLE IF NOT EXISTS campaign_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id),
    event TEXT NOT NULL,
    actor TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_campaign_events ON campaign_events (campaign_id, created_at)`;
  campaignTablesReady = true;
}

export async function createCampaign(
  sql: Sql,
  wsKey: string,
  website: string,
  profile: unknown,
  input: CampaignInput,
  actor: string
): Promise<{ id: string; tasks: CampaignTask[] }> {
  await ensureCampaignTables(sql);

  // Every task becomes a recommendation row → the intelligence dataset grows with
  // every mission, and task approvals/outcomes are attributable like feed items.
  const recIds = await logRecommendations(
    sql, wsKey, website, profile,
    input.tasks.map((t, i) => ({
      channel: t.channel,
      title: t.title,
      actionLabel: "Mission task",
      recType: "mission_task",
      reasoning: t.intent || undefined,
      clientKey: `task:${i}`,
    })),
    { provider: null, model: null, snapshotVersion: null }
  );
  const tasks: CampaignTask[] = input.tasks.map((t, i) => ({ ...t, recId: recIds[`task:${i}`] }));

  const rows = (await sql`
    INSERT INTO campaigns
      (workspace_key, website, goal, title, brief, channels, timeline_days, priority,
       expected_impact, reasoning, tasks, business_profile_snapshot)
    VALUES
      (${wsKey}, ${website}, ${input.goal}, ${input.title}, ${JSON.stringify(input.brief)},
       ${input.channels}, ${input.timelineDays}, ${input.priority}, ${input.expectedImpact},
       ${input.reasoning}, ${JSON.stringify(tasks)}, ${JSON.stringify(profile ?? {})})
    RETURNING id`) as { id: string }[];
  const id = rows[0].id;
  await sql`INSERT INTO campaign_events (campaign_id, event, actor) VALUES (${id}, 'created', ${actor})`;
  return { id, tasks };
}

export type CampaignRow = {
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

export async function listCampaigns(sql: Sql, wsKey: string): Promise<CampaignRow[]> {
  await ensureCampaignTables(sql);
  const rows = (await sql`
    SELECT c.id, c.goal, c.title, c.brief, c.channels, c.timeline_days, c.priority,
           c.expected_impact, c.reasoning, c.tasks, c.status, c.created_at,
           COALESCE(
             (SELECT array_agg(DISTINCT (e.metadata->>'taskIndex')::int)
              FROM campaign_events e
              WHERE e.campaign_id = c.id AND e.event = 'task_done' AND e.metadata ? 'taskIndex'),
             '{}'
           ) AS done_tasks
    FROM campaigns c
    WHERE c.workspace_key = ${wsKey} AND c.status != 'archived'
    ORDER BY c.created_at DESC
    LIMIT 25`) as CampaignRow[];
  return rows;
}

const STATUS_FOR_EVENT: Partial<Record<CampaignEvent, string>> = {
  activated: "active",
  paused: "paused",
  completed: "completed",
  archived: "archived",
};

/** Append a campaign event (ownership-checked). Status transitions update the
 *  registry column; history stays in campaign_events. */
export async function logCampaignEvent(
  sql: Sql,
  wsKey: string,
  campaignId: string,
  event: CampaignEvent,
  actor: string,
  metadata: Record<string, unknown> = {}
): Promise<boolean> {
  await ensureCampaignTables(sql);
  const owns = (await sql`
    SELECT 1 FROM campaigns WHERE id = ${campaignId} AND workspace_key = ${wsKey}`) as unknown[];
  if (!owns.length) return false;
  await sql`INSERT INTO campaign_events (campaign_id, event, actor, metadata)
            VALUES (${campaignId}, ${event}, ${actor.slice(0, 200)}, ${JSON.stringify(metadata)})`;
  const status = STATUS_FOR_EVENT[event];
  if (status) {
    await sql`UPDATE campaigns SET status = ${status} WHERE id = ${campaignId}`;
  }
  return true;
}
