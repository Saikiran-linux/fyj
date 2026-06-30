import { sql } from "drizzle-orm";
import type { DB } from "./db/client";
import { type JobFilters } from "./index-client";
import { matchProfile } from "./match";

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
  // 1. Load the campaign + its 1:1 profile (embedding + filters + watermark, plus
  //    the résumé precis + extracted skills/seniority the reranker needs — f-149).
  const rows = (await db.execute(
    sql`select campaign_id, org_id, client_id, last_run_at, embedding, target_filters,
               resume_text, parsed_profile
        from app.get_campaign_for_match(${job.campaignId})`,
  )) as unknown as Array<{
    campaign_id: string;
    org_id: string;
    client_id: string;
    last_run_at: string | null;
    embedding: string | null; // pgvector serialized as "[a,b,c]"
    target_filters: JobFilters | null;
    resume_text: string | null;
    parsed_profile: {
      summary?: string;
      candidate?: { skills?: string[]; seniority?: string | null } | null;
    } | null;
  }>;

  const row = rows[0];
  // No embedding yet (resume not uploaded) — nothing to match; don't advance the
  // watermark, so the first jobs aren't skipped once the profile is embedded.
  if (!row || !row.embedding) return { surfaced: 0 };

  // 2. Incremental match against the index — only jobs newer than last run. The
  //    full pipeline (hybrid retrieve → rerank → soft adjust) lives in
  //    matchProfile; it strips compFloor/families/seniority from the hard filters
  //    and applies them as soft signals, so we just pass targeting + the `since`
  //    watermark through.
  const embedding = JSON.parse(row.embedding) as number[];
  const parsed = row.parsed_profile ?? {};
  const filters: JobFilters = {
    ...(row.target_filters ?? {}),
    since: row.last_run_at ? new Date(row.last_run_at).toISOString() : undefined,
    targetOnly: row.target_filters?.targetOnly ?? true,
  };
  const matches = await matchProfile(env, {
    embedding,
    queryText: parsed.summary ?? row.resume_text ?? "",
    lexicalQuery: (parsed.candidate?.skills ?? []).join(", ") || null,
    filters,
    profileSeniority: parsed.candidate?.seniority ?? null,
  });

  // 3. Surface matches + bump the watermark atomically (dedup in the DB on
  //    (campaign_id, job_id)). org_id/client_id are derived from the campaign;
  //    fitScore/confidence/guardrails ride the payload (f-149).
  await db.execute(
    sql`select app.record_campaign_run(${job.campaignId}, ${JSON.stringify(matches)}::jsonb)`,
  );
  return { surfaced: matches.length };
}
