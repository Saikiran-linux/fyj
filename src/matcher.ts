import { sql } from "drizzle-orm";
import type { DB } from "./db/client";
import { searchJobs, type JobFilters } from "./index-client";

/**
 * Continuous matcher (f-135). Runs in the cron + queue handlers, NOT on the
 * request path.
 *
 * SECURITY NOTE: this is a trusted cross-tenant background job — listing active
 * campaigns spans all orgs, and surfacing matches writes without a request
 * principal, both of which RLS blocks for `ops_app` (and a synthetic principal
 * can't satisfy `can_access_client`). Neon's owner role can't grant a BYPASSRLS
 * role via SQL, so instead of a separate `ops_system` connection the matcher
 * runs on the SAME `ops_app` Hyperdrive connection and goes through the
 * SECURITY DEFINER functions in db/policies.sql (owner = table owner, RLS-exempt).
 * org_id/client_id for every write are derived inside the DB from the campaign
 * id — never trusted from here — so each run still touches exactly one
 * campaign's tenant data.
 */

export async function listActiveCampaignIds(db: DB): Promise<Array<{ id: string; orgId: string }>> {
  const rows = (await db.execute(
    sql`select id, org_id from app.list_active_campaigns()`,
  )) as unknown as Array<{ id: string; org_id: string }>;
  return rows.map((r) => ({ id: r.id, orgId: r.org_id }));
}

export async function runCampaignMatch(
  db: DB,
  env: Env,
  job: MatchJob,
): Promise<{ surfaced: number }> {
  // 1. Load the campaign + its 1:1 profile (embedding + filters + watermark).
  const rows = (await db.execute(
    sql`select campaign_id, org_id, client_id, last_run_at, embedding, target_filters
        from app.get_campaign_for_match(${job.campaignId})`,
  )) as unknown as Array<{
    campaign_id: string;
    org_id: string;
    client_id: string;
    last_run_at: string | null;
    embedding: string | null; // pgvector serialized as "[a,b,c]"
    target_filters: JobFilters | null;
  }>;

  const row = rows[0];
  // No embedding yet (resume not uploaded) — nothing to match; don't advance the
  // watermark, so the first jobs aren't skipped once the profile is embedded.
  if (!row || !row.embedding) return { surfaced: 0 };

  // 2. Incremental search against the index — only jobs newer than last run.
  const embedding = JSON.parse(row.embedding) as number[];
  const tf = row.target_filters ?? {};
  const filters: JobFilters = {
    ...tf,
    since: row.last_run_at ? new Date(row.last_run_at).toISOString() : undefined,
    targetOnly: tf.targetOnly ?? true,
  };
  const matches = await searchJobs(env, embedding, filters);

  // 3. Surface matches + bump the watermark atomically (dedup in the DB on
  //    (campaign_id, job_id)). org_id/client_id are derived from the campaign.
  const payload = matches.map((m, i) => ({
    jobId: m.jobId,
    companyId: m.companyId,
    score: m.score,
    rank: i + 1,
  }));
  await db.execute(
    sql`select app.record_campaign_run(${job.campaignId}, ${JSON.stringify(payload)}::jsonb)`,
  );
  return { surfaced: matches.length };
}
