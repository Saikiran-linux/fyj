import { desc, eq, sql } from "drizzle-orm";
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
  matchAction,
  feedbackSignal,
  memberRole,
} from "./schema";

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

// ── memberships (admin: list + invite) ─────────────────────────────────
export function listMembers(db: DB, who: Principal) {
  return withTenant(db, who, (tx) =>
    tx.select().from(memberships).where(eq(memberships.orgId, who.orgId)),
  );
}

export function inviteMember(db: DB, who: Principal, userId: string, role: MemberRole) {
  return withTenant(db, who, async (tx) => {
    const [row] = await tx
      .insert(memberships)
      .values({ orgId: who.orgId, userId, role, status: "invited" })
      .onConflictDoNothing({ target: [memberships.orgId, memberships.userId] })
      .returning();
    if (row) await audit(tx, who, "member.invite", "membership", row.id, { userId, role });
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
  status: string;
  appliedAt: string | null;
  updatedAt: string;
}

export function listApplications(db: DB, who: Principal, limit = 50): Promise<ApplicationRow[]> {
  return withTenant(db, who, async (tx) => {
    const rows = await tx
      .select({
        id: placements.id,
        clientId: placements.clientId,
        clientName: clients.fullName,
        jobId: placements.jobId,
        companyId: placements.companyId,
        status: placements.status,
        appliedAt: placements.appliedAt,
        updatedAt: placements.updatedAt,
      })
      .from(placements)
      .innerJoin(clients, eq(clients.id, placements.clientId))
      .orderBy(desc(placements.updatedAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      clientId: r.clientId,
      clientName: r.clientName,
      jobId: r.jobId,
      companyId: r.companyId,
      status: r.status,
      appliedAt: r.appliedAt ? new Date(r.appliedAt).toISOString() : null,
      updatedAt: new Date(r.updatedAt).toISOString(),
    }));
  });
}
