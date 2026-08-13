import { db, ensureSchema, RUNTIME_DDL, type Sql } from "@/lib/db";
import type { Subscription, SubscriptionStatus } from "./access";

// Storing what the provider told us.
//
// One row per user, overwritten on every webhook — the provider is the source of truth for
// billing state, so keeping a local history of it would only create a second version to
// disagree with. What we do keep is `updated_at`, because the grace period is measured from
// the moment a payment failed and there is nowhere else to read that from.
//
// Follows the repository pattern used everywhere else: in-memory so the product runs and is
// testable with no database, Neon for production.

export interface SubscriptionRepo {
  get(userId: string): Promise<Subscription | null>;
  upsert(sub: Subscription): Promise<void>;
  /** Look up by the provider's id — webhooks identify the subscription, not our user. */
  byExternalId(externalId: string): Promise<Subscription | null>;
}

export class InMemorySubscriptionRepo implements SubscriptionRepo {
  private rows = new Map<string, Subscription>();

  async get(userId: string) {
    return this.rows.get(userId) ?? null;
  }
  async upsert(sub: Subscription) {
    this.rows.set(sub.userId, sub);
  }
  async byExternalId(externalId: string) {
    for (const s of this.rows.values()) if (s.externalId === externalId) return s;
    return null;
  }
}

async function ensureTable(sql: Sql) {
  if (!RUNTIME_DDL) return;
  await sql`
    CREATE TABLE IF NOT EXISTS subscriptions (
      user_id TEXT PRIMARY KEY,
      external_id TEXT NOT NULL,
      status TEXT NOT NULL,
      current_period_end BIGINT,
      product_id TEXT,
      updated_at BIGINT NOT NULL
    )`;
  // Webhooks arrive knowing the provider's id, not ours.
  await sql`CREATE INDEX IF NOT EXISTS subscriptions_external ON subscriptions (external_id)`;
}

type Row = {
  user_id: string; external_id: string; status: string;
  current_period_end: string | number | null; product_id: string | null; updated_at: string | number;
};

const toSub = (r: Row): Subscription => ({
  userId: r.user_id,
  externalId: r.external_id,
  status: r.status as SubscriptionStatus,
  currentPeriodEnd: r.current_period_end == null ? null : Number(r.current_period_end),
  productId: r.product_id,
  updatedAt: Number(r.updated_at),
});

export class NeonSubscriptionRepo implements SubscriptionRepo {
  constructor(private sql: Sql) {}

  private async ready() {
    await ensureSchema(this.sql);
    await ensureTable(this.sql);
  }

  async get(userId: string) {
    await this.ready();
    const rows = (await this.sql`SELECT * FROM subscriptions WHERE user_id = ${userId}`) as Row[];
    return rows.length ? toSub(rows[0]) : null;
  }

  async byExternalId(externalId: string) {
    await this.ready();
    const rows = (await this.sql`SELECT * FROM subscriptions WHERE external_id = ${externalId}`) as Row[];
    return rows.length ? toSub(rows[0]) : null;
  }

  async upsert(sub: Subscription) {
    await this.ready();
    await this.sql`
      INSERT INTO subscriptions (user_id, external_id, status, current_period_end, product_id, updated_at)
      VALUES (${sub.userId}, ${sub.externalId}, ${sub.status}, ${sub.currentPeriodEnd},
              ${sub.productId}, ${sub.updatedAt})
      ON CONFLICT (user_id) DO UPDATE SET
        external_id = EXCLUDED.external_id,
        status = EXCLUDED.status,
        current_period_end = EXCLUDED.current_period_end,
        product_id = EXCLUDED.product_id,
        updated_at = EXCLUDED.updated_at`;
  }
}

let memo: SubscriptionRepo | null = null;

export function subscriptionRepo(): SubscriptionRepo {
  if (memo) return memo;
  const sql = db();
  memo = sql ? new NeonSubscriptionRepo(sql) : new InMemorySubscriptionRepo();
  return memo;
}
