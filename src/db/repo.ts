import { and, desc, eq, ne, sql } from "drizzle-orm";
import { withTenant, type DB, type Principal, type Tx } from "./client";
import {
  clients,
  clientProfiles,
  campaigns,
  campaignMatches,
  placements,
  reports,
  resumeDocuments,
  memberships,
  feedback,
  auditLog,
  clientStatus,
  consentStatus,
  matchAction,
  matchConfidence,
  feedbackSignal,
  memberRole,
  placementStatus,
} from "./schema";
import { user } from "./auth-schema";

/**
 * Org-scoped repository (f-133) — THE only sanctioned way the request path
 * touches tenant data. Every method runs inside withTenant(), which stamps the
 * per-request GUCs so Postgres RLS (db/policies.sql) is in force; the methods
 * add ergonomics + audit, NOT authorization (RLS is the boundary — a forbidden
 * write simply affects zero rows / raises, it is never silently allowed).
 *
 * Inputs never carry orgId/createdBy from the client — those are taken from the
 * verified Principal so a caller cannot write into another tenant.
 */

export type MatchAction = (typeof matchAction.enumValues)[number];
export type MatchConfidence = (typeof matchConfidence.enumValues)[number];
export type ClientStatus = (typeof clientStatus.enumValues)[number];
export type ConsentStatus = (typeof consentStatus.enumValues)[number];
export type FeedbackSignal = (typeof feedbackSignal.enumValues)[number];
export type MemberRole = (typeof memberRole.enumValues)[number];
export type PlacementStatus = (typeof placementStatus.enumValues)[number];

export interface NewClientInput {
  fullName: string;
  email?: string | null;
  phone?: string | null;
  assignedOperatorId?: string | null;
  notes?: string | null;
}

export interface NewProfileInput {
  clientId: string;
  label: string;
  resumeText?: string | null;
  targetFilters?: Record<string, unknown>;
}

export interface AttachResumeInput {
  resumeStoragePath?: string | null;
  resumeText: string;
  parsedProfile?: Record<string, unknown> | null;
  embedding: number[];
  embeddingModel: string;
}

export interface FeedbackInput {
  campaignId?: string | null;
  jobId?: string | null;
  companyId?: string | null;
  placementId?: string | null;
  signal: FeedbackSignal;
  rating?: number | null;
  note?: string | null;
}

// Audit rows are written in the SAME tx as the mutation they describe, so an
// action and its log commit or roll back together.
async function audit(
  tx: Tx,
  who: Principal,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await tx.insert(auditLog).values({
    orgId: who.orgId,
    actorUserId: who.userId,
    action,
    entityType,
    entityId,
    metadata,
  });
}

// ── clients ───────────────────────────────────────────────────────────
export function listClients(db: DB, who: Principal) {
  return withTenant(db, who, (tx) =>
    tx.select().from(clients).orderBy(desc(clients.createdAt)),
  );
}

export function getClient(db: DB, who: Principal, clientId: string) {
  return withTenant(db, who, async (tx) => {
    const [row] = await tx.select().from(clients).where(eq(clients.id, clientId)).limit(1);
    return row ?? null;
  });
}

export function createClient(db: DB, who: Principal, input: NewClientInput) {
  return withTenant(db, who, async (tx) => {
    // Operators may only create clients assigned to themselves (RLS enforces
    // this too); admins may assign to anyone, defaulting to unassigned.
    const assignedOperatorId =
      who.principal === "staff" && who.role === "operator"
        ? who.userId
        : (input.assignedOperatorId ?? null);

    // We generate the id app-side and INSERT *without* RETURNING. RETURNING
    // would make Postgres apply the clients SELECT policy to the new row, whose
    // `clients_select` USING calls app.can_access_client(id) — which re-queries
    // clients for that id, but the row written by this very command isn't yet
    // visible to that STABLE sub-query's snapshot, so it returns false and the
    // insert fails with "violates row-level security policy". Reading the row
    // back in a separate statement (after the command-counter advances) sees it.
    const id = crypto.randomUUID();
    await tx.insert(clients).values({
      id,
      orgId: who.orgId,
      fullName: input.fullName,
      email: input.email ?? null,
      phone: input.phone ?? null,
      assignedOperatorId,
      notes: input.notes ?? null,
      createdBy: who.userId,
    });
    await audit(tx, who, "client.create", "client", id, { fullName: input.fullName });
    const [row] = await tx.select().from(clients).where(eq(clients.id, id)).limit(1);
    return row ?? null;
  });
}

// ── profiles ──────────────────────────────────────────────────────────
export function listProfiles(db: DB, who: Principal, clientId: string) {
  return withTenant(db, who, (tx) =>
    tx
      .select()
      .from(clientProfiles)
      .where(eq(clientProfiles.clientId, clientId))
      .orderBy(desc(clientProfiles.createdAt)),
  );
}

export function createProfile(db: DB, who: Principal, input: NewProfileInput) {
  return withTenant(db, who, async (tx) => {
    const [row] = await tx
      .insert(clientProfiles)
      .values({
        orgId: who.orgId,
        clientId: input.clientId,
        label: input.label,
        resumeText: input.resumeText ?? null,
        targetFilters: input.targetFilters ?? {},
        createdBy: who.userId,
      })
      .returning();
    if (row) {
      // A UI "campaign" = profile + its 1:1 campaigns row. Create the (draft)
      // campaign now via the SECURITY DEFINER helper (org/client derived from the
      // profile inside the DB); it activates on first match run.
      await tx.execute(
        sql`select app.upsert_campaign_for_profile(${row.id}::uuid, false, ${who.userId})`,
      );
      await audit(tx, who, "profile.create", "client_profile", row.id, { label: input.label });
    }
    return row ?? null;
  });
}

export function getProfile(db: DB, who: Principal, profileId: string) {
  return withTenant(db, who, async (tx) => {
    const [row] = await tx
      .select()
      .from(clientProfiles)
      .where(eq(clientProfiles.id, profileId))
      .limit(1);
    return row ?? null;
  });
}

// Delete a track (profile) + its 1:1 campaign + surfaced matches (FK cascade).
// RLS (client_profiles staff-write: admin/operator with can_access_client) gates
// this — a forbidden/unknown id simply deletes zero rows → false (the API 404s).
// Unlike client_profiles' SELECT policy, the predicate reads `clients`, not the
// row being deleted, so DELETE … RETURNING is safe here (no self-referential
// re-query gotcha like createClient/deleteClient document).
export function deleteProfile(db: DB, who: Principal, profileId: string): Promise<boolean> {
  return withTenant(db, who, async (tx) => {
    const deleted = await tx
      .delete(clientProfiles)
      .where(eq(clientProfiles.id, profileId))
      .returning({ id: clientProfiles.id });
    const ok = deleted.length > 0;
    if (ok) await audit(tx, who, "profile.delete", "client_profile", profileId, {});
    return ok;
  });
}

// Persist a parsed+embedded resume onto its profile (f-134). The embedding is
// what the index search_jobs RPC queries against; embeddedAt flips the UI's
// "needs embed" → "embedded" and makes the profile matchable.
export function attachResume(db: DB, who: Principal, profileId: string, input: AttachResumeInput) {
  return withTenant(db, who, async (tx) => {
    const [row] = await tx
      .update(clientProfiles)
      .set({
        resumeStoragePath: input.resumeStoragePath ?? null,
        resumeText: input.resumeText,
        parsedProfile: input.parsedProfile ?? null,
        embedding: input.embedding,
        embeddingModel: input.embeddingModel,
        embeddedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(clientProfiles.id, profileId))
      .returning();
    if (row) await audit(tx, who, "profile.embed", "client_profile", row.id, { model: input.embeddingModel });
    return row ?? null;
  });
}

// ── campaign matches (the operator's curation surface) ─────────────────
export function listCampaignMatches(db: DB, who: Principal, campaignId: string) {
  return withTenant(db, who, (tx) =>
    tx
      .select()
      .from(campaignMatches)
      .where(eq(campaignMatches.campaignId, campaignId))
      .orderBy(campaignMatches.rank),
  );
}

export function setMatchAction(db: DB, who: Principal, matchId: string, action: MatchAction) {
  return withTenant(db, who, async (tx) => {
    const [row] = await tx
      .update(campaignMatches)
      .set({ action, actionBy: who.userId, actionAt: new Date(), updatedAt: new Date() })
      .where(eq(campaignMatches.id, matchId))
      .returning();
    if (row) await audit(tx, who, "match.action", "campaign_match", row.id, { action });
    return row ?? null;
  });
}

// ── memberships (admin: list + create operator) ────────────────────────
// listMembers joins `user` (allow-all to ops_app) so the UI shows usernames/
// names rather than opaque ids. RLS on memberships still scopes to the org.
export function listMembers(db: DB, who: Principal) {
  return withTenant(db, who, (tx) =>
    tx
      .select({
        id: memberships.id,
        orgId: memberships.orgId,
        userId: memberships.userId,
        role: memberships.role,
        status: memberships.status,
        username: user.displayUsername,
        name: user.name,
        createdAt: memberships.createdAt,
      })
      .from(memberships)
      .leftJoin(user, eq(user.id, memberships.userId))
      .where(eq(memberships.orgId, who.orgId))
      .orderBy(desc(memberships.createdAt)),
  );
}

/**
 * Add an already-created auth user to the caller's org as active staff. The
 * Better Auth user is created in the API route (auth.api.signUpEmail) BEFORE
 * this runs — repo.ts never holds the auth instance. Idempotent on
 * (orgId, userId). The admin-write RLS policy on memberships authorizes it.
 */
export function addStaffMembership(db: DB, who: Principal, userId: string, role: MemberRole) {
  return withTenant(db, who, async (tx) => {
    const [row] = await tx
      .insert(memberships)
      .values({ orgId: who.orgId, userId, role, status: "active" })
      .onConflictDoNothing({ target: [memberships.orgId, memberships.userId] })
      .returning();
    if (row) await audit(tx, who, "member.create", "membership", row.id, { userId, role });
    return row ?? null;
  });
}

// ── feedback (client portal: insert-only, immutable — RLS enforces) ────
export function submitFeedback(db: DB, who: Principal, input: FeedbackInput) {
  return withTenant(db, who, async (tx) => {
    if (who.principal !== "client") throw new Error("feedback is client-only");
    const [row] = await tx
      .insert(feedback)
      .values({
        orgId: who.orgId,
        clientId: who.clientId,
        campaignId: input.campaignId ?? null,
        jobId: input.jobId ?? null,
        companyId: input.companyId ?? null,
        placementId: input.placementId ?? null,
        signal: input.signal,
        rating: input.rating ?? null,
        note: input.note ?? null,
        createdBy: who.userId,
      })
      .returning();
    return row ?? null;
  });
}

// Staff-logged feedback on a candidate (f-146). Mirrors submitFeedback but for
// the staff-insert RLS path: clientId is explicit (not the caller's own), and
// org/createdBy come from the verified staff Principal.
export function addStaffFeedback(
  db: DB,
  who: Principal,
  clientId: string,
  input: FeedbackInput,
) {
  return withTenant(db, who, async (tx) => {
    const [row] = await tx
      .insert(feedback)
      .values({
        orgId: who.orgId,
        clientId,
        campaignId: input.campaignId ?? null,
        jobId: input.jobId ?? null,
        companyId: input.companyId ?? null,
        placementId: input.placementId ?? null,
        signal: input.signal,
        rating: input.rating ?? null,
        note: input.note ?? null,
        createdBy: who.userId,
      })
      .returning();
    return row ?? null;
  });
}

export function listFeedback(db: DB, who: Principal, clientId: string) {
  return withTenant(db, who, (tx) =>
    tx
      .select()
      .from(feedback)
      .where(eq(feedback.clientId, clientId))
      .orderBy(desc(feedback.createdAt)),
  );
}

// ── dashboard analytics (f-139) ────────────────────────────────────────
// Org-wide rollups for the operator dashboard. The heavy lifting is in the
// org-scoped SECURITY DEFINER functions in db/policies.sql (they span every
// client/operator in the org, which an operator's RLS can't); here we just call
// them inside withTenant() so the `app.org_id`/`app.principal` GUCs are set, and
// shape the snake_case rows into the client contract.
export interface DashboardKpis {
  placementsMtd: number;
  responseRate: number;
  liveApplications: number;
  awaitingReview: number;
}

export function dashboardKpis(db: DB, who: Principal): Promise<DashboardKpis> {
  return withTenant(db, who, async (tx) => {
    const rows = (await tx.execute(sql`select * from app.org_kpis()`)) as unknown as Array<{
      placements_mtd: number;
      response_rate: number;
      live_applications: number;
      awaiting_review: number;
    }>;
    const r = rows[0];
    return {
      placementsMtd: Number(r?.placements_mtd ?? 0),
      responseRate: Number(r?.response_rate ?? 0),
      liveApplications: Number(r?.live_applications ?? 0),
      awaitingReview: Number(r?.awaiting_review ?? 0),
    };
  });
}

export interface FunnelRow {
  label: string;
  value: number;
}

export function dashboardFunnel(db: DB, who: Principal): Promise<FunnelRow[]> {
  return withTenant(db, who, async (tx) => {
    const rows = (await tx.execute(
      sql`select label, value from app.org_funnel() order by ord`,
    )) as unknown as Array<{ label: string; value: number }>;
    return rows.map((r) => ({ label: r.label, value: Number(r.value) }));
  });
}

export interface OperatorStat {
  userId: string;
  name: string | null;
  email: string | null;
  candidateCount: number;
  matchesAwaiting: number;
  applicationsWeek: number;
  responseRate: number;
  placementsMtd: number;
}

export function dashboardLeaderboard(db: DB, who: Principal): Promise<OperatorStat[]> {
  return withTenant(db, who, async (tx) => {
    const rows = (await tx.execute(sql`select * from app.operator_stats()`)) as unknown as Array<{
      user_id: string;
      name: string | null;
      email: string | null;
      candidate_count: number;
      matches_awaiting: number;
      applications_week: number;
      response_rate: number;
      placements_mtd: number;
    }>;
    return rows.map((r) => ({
      userId: r.user_id,
      name: r.name,
      email: r.email,
      candidateCount: Number(r.candidate_count),
      matchesAwaiting: Number(r.matches_awaiting),
      applicationsWeek: Number(r.applications_week),
      responseRate: Number(r.response_rate),
      placementsMtd: Number(r.placements_mtd),
    }));
  });
}

export interface TrendPoint {
  day: string;
  applications: number;
  responses: number;
  placements: number;
}

export function dashboardTrends(db: DB, who: Principal): Promise<TrendPoint[]> {
  return withTenant(db, who, async (tx) => {
    const rows = (await tx.execute(sql`select * from app.org_trends()`)) as unknown as Array<{
      day: string;
      applications: number;
      responses: number;
      placements: number;
    }>;
    return rows.map((r) => ({
      day: String(r.day),
      applications: Number(r.applications),
      responses: Number(r.responses),
      placements: Number(r.placements),
    }));
  });
}

export interface ActivityEvent {
  id: string;
  action: string;
  entityType: string | null;
  actorUserId: string | null;
  actorName: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export function dashboardActivity(db: DB, who: Principal, limit = 12): Promise<ActivityEvent[]> {
  return withTenant(db, who, async (tx) => {
    const rows = (await tx.execute(
      sql`select * from app.org_activity(${limit})`,
    )) as unknown as Array<{
      id: string;
      action: string;
      entity_type: string | null;
      actor_user_id: string | null;
      actor_name: string | null;
      metadata: Record<string, unknown> | null;
      created_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entity_type,
      actorUserId: r.actor_user_id,
      actorName: r.actor_name,
      metadata: r.metadata ?? {},
      createdAt: String(r.created_at),
    }));
  });
}

// "Top live applications" — placements joined to their client, RLS-scoped (an
// operator sees their own book; an admin sees the whole org). Job title/company
// are hydrated later (Phase 3 denormalizes them onto placements).
export interface ApplicationRow {
  id: string;
  clientId: string;
  clientName: string;
  jobId: string | null;
  companyId: string | null;
  jobTitle: string | null;
  companyName: string | null;
  status: string;
  appliedAt: string | null;
  updatedAt: string;
}

export interface ListApplicationsOptions {
  clientId?: string;
  limit?: number;
}

export function listApplications(
  db: DB,
  who: Principal,
  opts: ListApplicationsOptions = {},
): Promise<ApplicationRow[]> {
  return withTenant(db, who, async (tx) => {
    const base = tx
      .select({
        id: placements.id,
        clientId: placements.clientId,
        clientName: clients.fullName,
        jobId: placements.jobId,
        companyId: placements.companyId,
        jobTitle: placements.jobTitle,
        companyName: placements.companyName,
        status: placements.status,
        appliedAt: placements.appliedAt,
        updatedAt: placements.updatedAt,
      })
      .from(placements)
      .innerJoin(clients, eq(clients.id, placements.clientId));
    const rows = await (opts.clientId
      ? base.where(eq(placements.clientId, opts.clientId))
      : base
    )
      .orderBy(desc(placements.updatedAt))
      .limit(opts.limit ?? 50);
    return rows.map((r) => ({
      id: r.id,
      clientId: r.clientId,
      clientName: r.clientName,
      jobId: r.jobId,
      companyId: r.companyId,
      jobTitle: r.jobTitle,
      companyName: r.companyName,
      status: r.status,
      appliedAt: r.appliedAt ? new Date(r.appliedAt).toISOString() : null,
      updatedAt: new Date(r.updatedAt).toISOString(),
    }));
  });
}

// ── placement writes (f-155) ────────────────────────────────────────────
// The pipeline is presented as tables/lists (per the design — no kanban);
// these are the stage/notes mutations behind those lists. Stage changes stamp
// stage_changed_at (time-in-stage) and the first move to "applied" stamps
// applied_at without ever un-setting it on later transitions.

export interface UpdatePlacementInput {
  status?: PlacementStatus;
  notes?: string | null;
  followUps?: unknown[];
}

export function updatePlacement(
  db: DB,
  who: Principal,
  placementId: string,
  input: UpdatePlacementInput,
) {
  return withTenant(db, who, async (tx) => {
    const now = new Date();
    const [row] = await tx
      .update(placements)
      .set({
        ...(input.status !== undefined
          ? {
              status: input.status,
              stageChangedAt: now,
              ...(input.status === "applied"
                ? { appliedAt: sql`coalesce(${placements.appliedAt}, now())` }
                : {}),
            }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.followUps !== undefined ? { followUps: input.followUps } : {}),
        updatedAt: now,
      })
      .where(eq(placements.id, placementId))
      .returning();
    if (row) await audit(tx, who, "placement.update", "placement", row.id, { ...input });
    return row ?? null;
  });
}

export interface CreatePlacementInput {
  clientId: string;
  jobTitle: string;
  companyName: string;
  jobId?: string | null;
  companyId?: string | null;
  status?: PlacementStatus;
  notes?: string | null;
}

export function createPlacement(db: DB, who: Principal, input: CreatePlacementInput) {
  return withTenant(db, who, async (tx) => {
    const [row] = await tx
      .insert(placements)
      .values({
        orgId: who.orgId,
        clientId: input.clientId,
        jobId: input.jobId ?? null,
        companyId: input.companyId ?? null,
        jobTitle: input.jobTitle,
        companyName: input.companyName,
        status: input.status ?? "lead",
        stageChangedAt: new Date(),
        notes: input.notes ?? null,
        createdBy: who.userId,
      })
      .returning();
    if (row)
      await audit(tx, who, "placement.create", "placement", row.id, {
        clientId: input.clientId,
        jobTitle: input.jobTitle,
        companyName: input.companyName,
      });
    return row ?? null;
  });
}

// ── match review / Explore (f-139 P2) ──────────────────────────────────
// Cross-campaign match list for the Explore view. RLS-scoped: an operator only
// sees matches for their assigned clients (via the campaign_matches policy),
// an admin sees the whole org. Job title/company are NOT stored (the index is
// read-only) — the API hydrates them via get_job/KV after this returns.
export interface MatchRow {
  id: string;
  clientId: string;
  clientName: string;
  campaignId: string;
  jobId: string;
  companyId: string;
  score: number | null;
  rank: number | null;
  fitScore: number | null;
  confidence: MatchConfidence | null;
  rationale: string | null;
  matchedSkills: string[] | null;
  missingSkills: string[] | null;
  guardrails: string[] | null;
  action: MatchAction;
  surfacedAt: string;
}

export interface ListMatchesFilters {
  candidateId?: string | null;
  confidence?: MatchConfidence | null;
  limit?: number;
}

export function listMatches(
  db: DB,
  who: Principal,
  filters: ListMatchesFilters = {},
): Promise<MatchRow[]> {
  return withTenant(db, who, async (tx) => {
    const conds = [ne(campaignMatches.action, "dismissed")];
    if (filters.candidateId) conds.push(eq(campaignMatches.clientId, filters.candidateId));
    if (filters.confidence) conds.push(eq(campaignMatches.confidence, filters.confidence));
    const rows = await tx
      .select({
        id: campaignMatches.id,
        clientId: campaignMatches.clientId,
        clientName: clients.fullName,
        campaignId: campaignMatches.campaignId,
        jobId: campaignMatches.jobId,
        companyId: campaignMatches.companyId,
        score: campaignMatches.score,
        rank: campaignMatches.rank,
        fitScore: campaignMatches.fitScore,
        confidence: campaignMatches.confidence,
        rationale: campaignMatches.rationale,
        matchedSkills: campaignMatches.matchedSkills,
        missingSkills: campaignMatches.missingSkills,
        guardrails: campaignMatches.guardrails,
        action: campaignMatches.action,
        surfacedAt: campaignMatches.surfacedAt,
      })
      .from(campaignMatches)
      .innerJoin(clients, eq(clients.id, campaignMatches.clientId))
      .where(and(...conds))
      .orderBy(
        sql`${campaignMatches.fitScore} desc nulls last, ${campaignMatches.score} desc nulls last`,
      )
      .limit(filters.limit ?? 100);
    // Collapse the SAME job surfaced for the SAME candidate by more than one track
    // (two similar profiles/campaigns surface overlapping jobs). Rows are already
    // ordered best-fit first, so keeping the first occurrence per (client, job)
    // keeps the strongest one. Different candidates matching the same job stay
    // separate (keyed on clientId), as do the same job for one candidate is shown once.
    const seen = new Set<string>();
    const deduped = rows.filter((r) => {
      const key = `${r.clientId}:${r.jobId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return deduped.map((r) => ({ ...r, surfacedAt: new Date(r.surfacedAt).toISOString() }));
  });
}

/** One match by id (same shape as listMatches) — the tailor workspace header. */
export function getMatch(db: DB, who: Principal, matchId: string): Promise<MatchRow | null> {
  return withTenant(db, who, async (tx) => {
    const [r] = await tx
      .select({
        id: campaignMatches.id,
        clientId: campaignMatches.clientId,
        clientName: clients.fullName,
        campaignId: campaignMatches.campaignId,
        jobId: campaignMatches.jobId,
        companyId: campaignMatches.companyId,
        score: campaignMatches.score,
        rank: campaignMatches.rank,
        fitScore: campaignMatches.fitScore,
        confidence: campaignMatches.confidence,
        rationale: campaignMatches.rationale,
        matchedSkills: campaignMatches.matchedSkills,
        missingSkills: campaignMatches.missingSkills,
        guardrails: campaignMatches.guardrails,
        action: campaignMatches.action,
        surfacedAt: campaignMatches.surfacedAt,
      })
      .from(campaignMatches)
      .innerJoin(clients, eq(clients.id, campaignMatches.clientId))
      .where(eq(campaignMatches.id, matchId))
      .limit(1);
    return r ? { ...r, surfacedAt: new Date(r.surfacedAt).toISOString() } : null;
  });
}

// Approve a match: mark it out of the review queue and queue a placement (the
// "application" the operator will tailor + send). Idempotent on (client, job).
export interface ApproveMatchResult {
  matchId: string;
  action: MatchAction;
  placementId: string | null;
}

export function approveMatch(
  db: DB,
  who: Principal,
  matchId: string,
): Promise<ApproveMatchResult | null> {
  return withTenant(db, who, async (tx) => {
    const [m] = await tx
      .select()
      .from(campaignMatches)
      .where(eq(campaignMatches.id, matchId))
      .limit(1);
    if (!m) return null;

    const [updated] = await tx
      .update(campaignMatches)
      .set({ action: "shortlisted", actionBy: who.userId, actionAt: new Date(), updatedAt: new Date() })
      .where(eq(campaignMatches.id, matchId))
      .returning();

    const [existing] = await tx
      .select({ id: placements.id })
      .from(placements)
      .where(and(eq(placements.clientId, m.clientId), eq(placements.jobId, m.jobId)))
      .limit(1);

    let placementId = existing?.id ?? null;
    if (!existing) {
      const [p] = await tx
        .insert(placements)
        .values({
          orgId: who.orgId,
          clientId: m.clientId,
          campaignId: m.campaignId,
          jobId: m.jobId,
          companyId: m.companyId,
          status: "ready_to_send",
          stageChangedAt: new Date(),
          createdBy: who.userId,
        })
        .returning({ id: placements.id });
      placementId = p?.id ?? null;
    }

    await audit(tx, who, "match.approve", "campaign_match", matchId, { placementId });
    return {
      matchId,
      action: (updated?.action ?? "shortlisted") as MatchAction,
      placementId,
    };
  });
}

// ── f-141 value loop: campaigns, on-demand matching, enrichment, tailoring ──

/** Ensure the profile's 1:1 campaign exists; optionally activate it. Returns id. */
export function ensureCampaign(db: DB, who: Principal, profileId: string, activate: boolean) {
  return withTenant(db, who, async (tx) => {
    const rows = (await tx.execute(
      sql`select app.upsert_campaign_for_profile(${profileId}::uuid, ${activate}, ${who.userId}) as id`,
    )) as unknown as Array<{ id: string | null }>;
    return rows[0]?.id ?? null;
  });
}

/**
 * Surface index matches onto a campaign (dedup in DB), deriving org/client there.
 * `fitScore`/`confidence`/`guardrails` are optional (f-149 rerank + soft signals);
 * when omitted, app.record_campaign_run falls back to the cosine-derived band.
 */
export function recordRun(
  db: DB,
  who: Principal,
  campaignId: string,
  matches: Array<{
    jobId: string;
    companyId: string;
    score: number;
    rank: number;
    fitScore?: number;
    confidence?: MatchConfidence;
    guardrails?: string[];
  }>,
) {
  return withTenant(db, who, (tx) =>
    tx.execute(
      sql`select app.record_campaign_run(${campaignId}::uuid, ${JSON.stringify(matches)}::jsonb)`,
    ),
  );
}

/** Populate the candidate's profile + targeting criteria from résumé extraction. */
export interface ResumeExtraction {
  fullName: string | null;
  headline: string | null;
  location: string | null;
  seniority: string | null;
  skills: string[];
  roleFamilies: string[];
  minComp: number | null;
  workplace: string | null;
  targetTitles: string[];
}
export function applyResumeExtraction(
  db: DB,
  who: Principal,
  clientId: string,
  profileId: string,
  ex: ResumeExtraction,
) {
  return withTenant(db, who, async (tx) => {
    // Fill the client headline (and name if it's still a placeholder) only when empty.
    const [client] = await tx
      .select({ headline: clients.headline, fullName: clients.fullName })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (client && !client.headline && ex.headline) patch.headline = ex.headline;
    if (client && ex.fullName && (!client.fullName || /^(unknown|candidate)$/i.test(client.fullName)))
      patch.fullName = ex.fullName;
    if (Object.keys(patch).length > 1)
      await tx.update(clients).set(patch).where(eq(clients.id, clientId));

    // INDEX-SAFE filters only (no `families`/`seniority`/`titles`/`locations` —
    // the index uses controlled vocabularies for these that our free-text values
    // don't match, which zeroes the search; verified live that a `seniority:["mid"]`
    // filter returned 0 where dropping it returned 25). Those live in
    // parsed_profile.candidate for display; the embedding carries role/seniority fit.
    const targetFilters = {
      targetOnly: true,
      ...(ex.workplace === "remote" ? { remote: true } : {}),
      ...(typeof ex.minComp === "number" && ex.minComp > 0 ? { compFloor: ex.minComp } : {}),
    };
    await tx
      .update(clientProfiles)
      .set({ targetFilters, updatedAt: new Date() })
      .where(eq(clientProfiles.id, profileId));
    await audit(tx, who, "profile.extract", "client_profile", profileId, {
      headline: ex.headline,
      families: ex.roleFamilies,
    });
  });
}

/** The profile context (résumé + summary) behind a campaign, for AI steps. */
export function getCampaignProfile(db: DB, who: Principal, campaignId: string) {
  return withTenant(db, who, async (tx) => {
    const [row] = await tx
      .select({
        clientId: campaigns.clientId,
        resumeText: clientProfiles.resumeText,
        parsedProfile: clientProfiles.parsedProfile,
      })
      .from(campaigns)
      .innerJoin(clientProfiles, eq(clientProfiles.id, campaigns.profileId))
      .where(eq(campaigns.id, campaignId))
      .limit(1);
    return row ?? null;
  });
}

/** Surfaced matches on a campaign that still need LLM enrichment. */
export function listMatchesToEnrich(db: DB, who: Principal, campaignId: string, limit = 25) {
  return withTenant(db, who, (tx) =>
    tx
      .select({
        id: campaignMatches.id,
        jobId: campaignMatches.jobId,
        companyId: campaignMatches.companyId,
      })
      .from(campaignMatches)
      .where(and(eq(campaignMatches.campaignId, campaignId), sql`${campaignMatches.rationale} is null`))
      .orderBy(campaignMatches.rank)
      .limit(limit),
  );
}

/** Write one match's LLM enrichment (staff UPDATE path, same as setMatchAction). */
export function enrichMatch(
  db: DB,
  who: Principal,
  matchId: string,
  e: { rationale: string; matchedSkills: string[]; missingSkills: string[]; guardrails: string[] },
) {
  return withTenant(db, who, (tx) =>
    tx
      .update(campaignMatches)
      .set({
        rationale: e.rationale,
        matchedSkills: e.matchedSkills,
        missingSkills: e.missingSkills,
        guardrails: e.guardrails,
        updatedAt: new Date(),
      })
      .where(eq(campaignMatches.id, matchId)),
  );
}

/** Everything the tailoring graph needs for one match. */
export function getTailoringContext(db: DB, who: Principal, matchId: string) {
  return withTenant(db, who, async (tx) => {
    const [row] = await tx
      .select({
        clientId: campaignMatches.clientId,
        jobId: campaignMatches.jobId,
        companyId: campaignMatches.companyId,
        resumeText: clientProfiles.resumeText,
        parsedProfile: clientProfiles.parsedProfile,
      })
      .from(campaignMatches)
      .innerJoin(campaigns, eq(campaigns.id, campaignMatches.campaignId))
      .innerJoin(clientProfiles, eq(clientProfiles.id, campaigns.profileId))
      .where(eq(campaignMatches.id, matchId))
      .limit(1);
    return row ?? null;
  });
}

// All documents for a candidate (f-146 Documents tab): the uploaded master
// résumé per campaign/profile, plus every generated tailored résumé (one per
// approved match). Tailored rows carry jobId/companyId for the caller to
// hydrate a title via the index; their `matchId` opens the existing résumé route.
export function listDocuments(db: DB, who: Principal, clientId: string) {
  return withTenant(db, who, async (tx) => {
    const profileRows = await tx
      .select({
        profileId: clientProfiles.id,
        label: clientProfiles.label,
        storagePath: clientProfiles.resumeStoragePath,
        resumeText: clientProfiles.resumeText,
        embeddedAt: clientProfiles.embeddedAt,
        createdAt: clientProfiles.createdAt,
      })
      .from(clientProfiles)
      .where(eq(clientProfiles.clientId, clientId))
      .orderBy(desc(clientProfiles.createdAt));

    const resumes = profileRows
      .filter((r) => r.storagePath || r.resumeText)
      .map((r) => ({
        profileId: r.profileId,
        label: r.label,
        fileName: r.storagePath ? (r.storagePath.split("/").pop() ?? "résumé") : "résumé (text)",
        hasFile: Boolean(r.storagePath),
        hasText: Boolean(r.resumeText),
        embeddedAt: r.embeddedAt,
        uploadedAt: r.embeddedAt ?? r.createdAt,
      }));

    const tailored = await tx
      .select({
        matchId: reports.campaignMatchId,
        model: reports.model,
        generatedAt: reports.generatedAt,
        jobId: campaignMatches.jobId,
        companyId: campaignMatches.companyId,
      })
      .from(reports)
      .innerJoin(campaignMatches, eq(campaignMatches.id, reports.campaignMatchId))
      .where(eq(reports.clientId, clientId))
      .orderBy(desc(reports.generatedAt));

    return { resumes, tailored };
  });
}

/** Upsert the tailored résumé (Markdown) for a match + tag the placement. */
export function saveTailoredResume(
  db: DB,
  who: Principal,
  input: { matchId: string; clientId: string; markdown: string; model: string; resumeName: string },
) {
  return withTenant(db, who, async (tx) => {
    const [existing] = await tx
      .select({ id: reports.id })
      .from(reports)
      .where(eq(reports.campaignMatchId, input.matchId))
      .limit(1);
    if (existing) {
      await tx
        .update(reports)
        .set({ fullMarkdown: input.markdown, model: input.model, generatedAt: new Date() })
        .where(eq(reports.id, existing.id));
    } else {
      await tx.insert(reports).values({
        orgId: who.orgId,
        clientId: input.clientId,
        campaignMatchId: input.matchId,
        model: input.model,
        fullMarkdown: input.markdown,
        generatedBy: who.userId,
      });
    }
    // Tag the placement (idempotent on client+job) so the tracker shows it's tailored.
    const [m] = await tx
      .select({ jobId: campaignMatches.jobId, clientId: campaignMatches.clientId })
      .from(campaignMatches)
      .where(eq(campaignMatches.id, input.matchId))
      .limit(1);
    if (m) {
      await tx
        .update(placements)
        .set({ tailoredResumeName: input.resumeName, updatedAt: new Date() })
        .where(and(eq(placements.clientId, m.clientId), eq(placements.jobId, m.jobId)));
    }
  });
}

/** The tailored résumé (Markdown) for a match, or null if not generated yet. */
export function getTailoredResume(db: DB, who: Principal, matchId: string) {
  return withTenant(db, who, async (tx) => {
    const [row] = await tx
      .select({ markdown: reports.fullMarkdown, model: reports.model, generatedAt: reports.generatedAt })
      .from(reports)
      .where(eq(reports.campaignMatchId, matchId))
      .orderBy(desc(reports.generatedAt))
      .limit(1);
    return row ?? null;
  });
}

/** Save operator edits to a tailored résumé. */
export function updateTailoredResume(db: DB, who: Principal, matchId: string, markdown: string) {
  return withTenant(db, who, async (tx) => {
    const [row] = await tx
      .update(reports)
      .set({ fullMarkdown: markdown, generatedAt: new Date() })
      .where(eq(reports.campaignMatchId, matchId))
      .returning({ id: reports.id });
    return row ?? null;
  });
}

// ── resume documents (Write library + tailor workspace, f-156) ─────────
// body_json is an opaque editor document ({meta, blocks, versions}) owned by
// the web block editor — the Worker stores/returns it without interpreting it.
// version bumps on every body write so concurrent tabs can detect staleness.

export interface ResumeDocumentListRow {
  id: string;
  clientId: string | null;
  clientName: string | null;
  sourceMatchId: string | null;
  title: string;
  version: number;
  updatedAt: Date;
  createdAt: Date;
}

export interface ListResumeDocumentsFilters {
  clientId?: string | null;
  sourceMatchId?: string | null;
}

export function listResumeDocuments(
  db: DB,
  who: Principal,
  filters: ListResumeDocumentsFilters = {},
): Promise<ResumeDocumentListRow[]> {
  return withTenant(db, who, async (tx) => {
    const conds = [];
    if (filters.clientId) conds.push(eq(resumeDocuments.clientId, filters.clientId));
    if (filters.sourceMatchId) conds.push(eq(resumeDocuments.sourceMatchId, filters.sourceMatchId));
    return tx
      .select({
        id: resumeDocuments.id,
        clientId: resumeDocuments.clientId,
        clientName: clients.fullName,
        sourceMatchId: resumeDocuments.sourceMatchId,
        title: resumeDocuments.title,
        version: resumeDocuments.version,
        updatedAt: resumeDocuments.updatedAt,
        createdAt: resumeDocuments.createdAt,
      })
      .from(resumeDocuments)
      .leftJoin(clients, eq(clients.id, resumeDocuments.clientId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(resumeDocuments.updatedAt));
  });
}

export function getResumeDocument(db: DB, who: Principal, docId: string) {
  return withTenant(db, who, async (tx) => {
    const [row] = await tx
      .select()
      .from(resumeDocuments)
      .where(eq(resumeDocuments.id, docId))
      .limit(1);
    return row ?? null;
  });
}

export interface CreateResumeDocumentInput {
  title: string;
  clientId?: string | null;
  sourceMatchId?: string | null;
  bodyJson?: Record<string, unknown>;
}

export function createResumeDocument(db: DB, who: Principal, input: CreateResumeDocumentInput) {
  return withTenant(db, who, async (tx) => {
    const [row] = await tx
      .insert(resumeDocuments)
      .values({
        orgId: who.orgId,
        clientId: input.clientId ?? null,
        sourceMatchId: input.sourceMatchId ?? null,
        title: input.title,
        bodyJson: input.bodyJson ?? {},
        createdBy: who.userId,
      })
      .returning();
    if (row)
      await audit(tx, who, "resume_document.create", "resume_document", row.id, {
        title: input.title,
        clientId: input.clientId ?? null,
        sourceMatchId: input.sourceMatchId ?? null,
      });
    return row ?? null;
  });
}

export interface UpdateResumeDocumentInput {
  title?: string;
  clientId?: string | null;
  bodyJson?: Record<string, unknown>;
}

export function updateResumeDocument(
  db: DB,
  who: Principal,
  docId: string,
  input: UpdateResumeDocumentInput,
) {
  return withTenant(db, who, async (tx) => {
    const [row] = await tx
      .update(resumeDocuments)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
        ...(input.bodyJson !== undefined
          ? { bodyJson: input.bodyJson, version: sql`${resumeDocuments.version} + 1` }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(resumeDocuments.id, docId))
      .returning();
    if (row)
      await audit(tx, who, "resume_document.update", "resume_document", row.id, {
        title: input.title,
        bodyChanged: input.bodyJson !== undefined,
      });
    return row ?? null;
  });
}

export function deleteResumeDocument(db: DB, who: Principal, docId: string): Promise<boolean> {
  return withTenant(db, who, async (tx) => {
    const [row] = await tx
      .delete(resumeDocuments)
      .where(eq(resumeDocuments.id, docId))
      .returning({ id: resumeDocuments.id, title: resumeDocuments.title });
    if (row)
      await audit(tx, who, "resume_document.delete", "resume_document", row.id, {
        title: row.title,
      });
    return Boolean(row);
  });
}

// ── candidate + track updates (f-139 P3) ───────────────────────────────
export interface UpdateClientInput {
  fullName?: string;
  email?: string | null;
  phone?: string | null;
  status?: ClientStatus;
  headline?: string | null;
  consentStatus?: ConsentStatus;
  notes?: string | null;
}

export function updateClient(db: DB, who: Principal, clientId: string, input: UpdateClientInput) {
  return withTenant(db, who, async (tx) => {
    const [row] = await tx
      .update(clients)
      .set({
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.headline !== undefined ? { headline: input.headline } : {}),
        ...(input.consentStatus !== undefined ? { consentStatus: input.consentStatus } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        updatedAt: new Date(),
      })
      .where(eq(clients.id, clientId))
      .returning();
    if (row) await audit(tx, who, "client.update", "client", row.id, { ...input });
    return row ?? null;
  });
}

// Permanently delete a candidate and everything hanging off it. The client_id
// FKs on client_profiles / campaigns / campaign_matches / reports / placements /
// feedback are all ON DELETE CASCADE, so one delete removes the whole subtree;
// audit_log has no client FK so the trail (incl. this row) survives. RLS
// (clients_delete) only permits admins — an operator's delete affects zero rows.
// We pre-read the row WITHOUT relying on DELETE…RETURNING (the clients SELECT
// policy re-queries the row mid-command, same gotcha createClient documents),
// and hand back the résumé R2 keys so the caller can purge object storage (no
// cascade reaches R2).
export function deleteClient(db: DB, who: Principal, clientId: string) {
  return withTenant(db, who, async (tx) => {
    const [row] = await tx
      .select({ id: clients.id, fullName: clients.fullName })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    if (!row) return null;
    const profs = await tx
      .select({ path: clientProfiles.resumeStoragePath })
      .from(clientProfiles)
      .where(eq(clientProfiles.clientId, clientId));
    await tx.delete(clients).where(eq(clients.id, clientId));
    await audit(tx, who, "client.delete", "client", clientId, { fullName: row.fullName });
    const resumeKeys = profs.map((p) => p.path).filter((p): p is string => Boolean(p));
    return { id: clientId, fullName: row.fullName, resumeKeys };
  });
}

export interface UpdateProfileInput {
  autopilot?: boolean;
  targetFilters?: Record<string, unknown>;
}

export function updateProfile(
  db: DB,
  who: Principal,
  profileId: string,
  input: UpdateProfileInput,
) {
  return withTenant(db, who, async (tx) => {
    const [row] = await tx
      .update(clientProfiles)
      .set({
        ...(input.autopilot !== undefined ? { autopilot: input.autopilot } : {}),
        ...(input.targetFilters !== undefined ? { targetFilters: input.targetFilters } : {}),
        updatedAt: new Date(),
      })
      .where(eq(clientProfiles.id, profileId))
      .returning();
    if (row) await audit(tx, who, "profile.update", "client_profile", row.id, { autopilot: input.autopilot });
    return row ?? null;
  });
}

// Editable Experience/Skills sections on the Overview (f-146). These live in the
// profile's parsed_profile.candidate jsonb (populated by the résumé intake graph);
// operators can correct them by hand. We read-merge so we never clobber the rest of
// parsed_profile (summary/email/embedding inputs). Display-only — does NOT re-embed.
export interface ProfileExtractionPatch {
  experience?: Array<{
    title: string | null;
    company: string | null;
    period: string | null;
    summary: string | null;
  }>;
  skills?: string[];
}

export function updateProfileCandidate(
  db: DB,
  who: Principal,
  profileId: string,
  patch: ProfileExtractionPatch,
) {
  return withTenant(db, who, async (tx) => {
    const [current] = await tx
      .select({ parsedProfile: clientProfiles.parsedProfile })
      .from(clientProfiles)
      .where(eq(clientProfiles.id, profileId))
      .limit(1);
    if (!current) return null;
    const parsed = (current.parsedProfile ?? {}) as Record<string, unknown>;
    const candidate = (parsed.candidate ?? {}) as Record<string, unknown>;
    const nextCandidate = {
      ...candidate,
      ...(patch.experience !== undefined ? { experience: patch.experience } : {}),
      ...(patch.skills !== undefined ? { skills: patch.skills } : {}),
    };
    const [row] = await tx
      .update(clientProfiles)
      .set({ parsedProfile: { ...parsed, candidate: nextCandidate }, updatedAt: new Date() })
      .where(eq(clientProfiles.id, profileId))
      .returning();
    if (row) await audit(tx, who, "profile.extraction.edit", "client_profile", profileId, {});
    return row ?? null;
  });
}

// ── calendar (f-139 P4) ────────────────────────────────────────────────
// Schedule events derived from placements (no separate table): a placement's
// stage maps to an event kind, dated by stage_changed_at ?? applied_at ??
// updated_at. RLS-scoped to the caller's book via the placements policy.
export type CalendarKind = "interview" | "offer" | "call" | "sync";

export interface CalendarEvent {
  id: string;
  date: string; // YYYY-MM-DD
  kind: CalendarKind;
  status: string;
  clientName: string;
  jobTitle: string | null;
  companyName: string | null;
}

export function listCalendarEvents(
  db: DB,
  who: Principal,
  opts: { year: number; month: number }, // month: 0–11
): Promise<CalendarEvent[]> {
  return withTenant(db, who, async (tx) => {
    const rows = await tx
      .select({
        id: placements.id,
        clientName: clients.fullName,
        jobTitle: placements.jobTitle,
        companyName: placements.companyName,
        status: placements.status,
        appliedAt: placements.appliedAt,
        stageChangedAt: placements.stageChangedAt,
        updatedAt: placements.updatedAt,
      })
      .from(placements)
      .innerJoin(clients, eq(clients.id, placements.clientId));

    const out: CalendarEvent[] = [];
    for (const r of rows) {
      if (r.status === "rejected" || r.status === "withdrawn") continue;
      const when = r.stageChangedAt ?? r.appliedAt ?? r.updatedAt;
      const d = new Date(when);
      if (d.getFullYear() !== opts.year || d.getMonth() !== opts.month) continue;
      const kind: CalendarKind =
        r.status === "interview"
          ? "interview"
          : r.status === "offer"
            ? "offer"
            : r.status === "responded" || r.status === "screening"
              ? "call"
              : "sync";
      out.push({
        id: r.id,
        date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
        kind,
        status: r.status,
        clientName: r.clientName,
        jobTitle: r.jobTitle,
        companyName: r.companyName,
      });
    }
    return out;
  });
}
