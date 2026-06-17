import { and, desc, eq } from "drizzle-orm";
import { withTenant, type DB, type Principal, type Tx } from "./client";
import {
  clients,
  clientProfiles,
  campaigns,
  campaignMatches,
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
