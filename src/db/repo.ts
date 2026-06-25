import { and, desc, eq, ne, sql } from "drizzle-orm";
import { withTenant, type DB, type Principal, type Tx } from "./client";
import {
  clients,
  clientProfiles,
  campaigns,
  campaignMatches,
  placements,
  memberships,
  feedback,
  auditLog,
  clientStatus,
  consentStatus,
  matchAction,
  matchConfidence,
  feedbackSignal,
  memberRole,
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

    const [row] = await tx
      .insert(clients)
      .values({
        orgId: who.orgId,
        fullName: input.fullName,
        email: input.email ?? null,
        phone: input.phone ?? null,
        assignedOperatorId,
        notes: input.notes ?? null,
        createdBy: who.userId,
      })
      .returning();
    if (row) await audit(tx, who, "client.create", "client", row.id, { fullName: input.fullName });
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
    if (row) await audit(tx, who, "profile.create", "client_profile", row.id, { label: input.label });
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
    return rows.map((r) => ({ ...r, surfacedAt: new Date(r.surfacedAt).toISOString() }));
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

// ── candidate + track updates (f-139 P3) ───────────────────────────────
export interface UpdateClientInput {
  status?: ClientStatus;
  headline?: string | null;
  consentStatus?: ConsentStatus;
}

export function updateClient(db: DB, who: Principal, clientId: string, input: UpdateClientInput) {
  return withTenant(db, who, async (tx) => {
    const [row] = await tx
      .update(clients)
      .set({
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.headline !== undefined ? { headline: input.headline } : {}),
        ...(input.consentStatus !== undefined ? { consentStatus: input.consentStatus } : {}),
        updatedAt: new Date(),
      })
      .where(eq(clients.id, clientId))
      .returning();
    if (row) await audit(tx, who, "client.update", "client", row.id, { ...input });
    return row ?? null;
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
