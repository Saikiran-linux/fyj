import { sql } from "drizzle-orm";
import type { DB, Principal } from "./db/client";

/**
 * Resolve the authenticated user id (from Better Auth) into a tenant Principal
 * (f-133): which org, which role, or which client-portal identity. Staff takes
 * precedence over client; when a user belongs to multiple orgs the caller may
 * pin one with `requestedOrgId` (e.g. an `x-org-id` header), else the first
 * (oldest) is used.
 *
 * Reads go through the SECURITY DEFINER resolvers in db/policies.sql, which are
 * the only privileged path off the request thread and only ever return rows for
 * the passed (verified) user id. Returns null when the user has no membership
 * and no enabled portal — the API turns that into a 403.
 */
export async function resolvePrincipal(
  db: DB,
  userId: string,
  requestedOrgId?: string | null,
): Promise<Principal | null> {
  const staff = (await db.execute(
    sql`select org_id, role from app.resolve_staff_memberships(${userId})`,
  )) as unknown as Array<{ org_id: string; role: string }>;

  if (staff.length > 0) {
    // Default org selection prefers the HIGHEST-privilege role (admin > operator >
    // viewer), not just the oldest org. Otherwise a user who is admin in one org
    // and operator in another would silently resolve as operator whenever the
    // request doesn't pin an org — and because resolve_staff_memberships only
    // orders by org age (ties on created_at are unstable), the resolved role could
    // even flip between requests. An explicit `requestedOrgId` still wins when it
    // matches; a stale/unmatched one falls back to the best-role default rather
    // than failing closed.
    const rank: Record<string, number> = { admin: 3, operator: 2, viewer: 1 };
    const byRole = [...staff].sort((a, b) => (rank[b.role] ?? 0) - (rank[a.role] ?? 0));
    const m = (requestedOrgId && staff.find((r) => r.org_id === requestedOrgId)) || byRole[0];
    if (m && (m.role === "admin" || m.role === "operator" || m.role === "viewer")) {
      return { principal: "staff", userId, orgId: m.org_id, role: m.role };
    }
  }

  const client = (await db.execute(
    sql`select client_id, org_id from app.resolve_client_principal(${userId})`,
  )) as unknown as Array<{ client_id: string; org_id: string }>;

  const cr = requestedOrgId ? client.find((r) => r.org_id === requestedOrgId) : client[0];
  if (cr) {
    return { principal: "client", userId, orgId: cr.org_id, clientId: cr.client_id };
  }

  return null;
}
