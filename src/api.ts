import { Hono } from "hono";
import { createDb, type DB, type Principal } from "./db/client";
import { createAuth } from "./auth";
import { resolvePrincipal } from "./principal";
import * as repo from "./db/repo";
import { matchAction, feedbackSignal, memberRole } from "./db/schema";

type Vars = { db: DB; principal: Principal };

const isStaff = (p: Principal): p is Extract<Principal, { principal: "staff" }> =>
  p.principal === "staff";

/**
 * The ops-console HTTP API (f-133). Better Auth owns /api/auth/**; every other
 * /api route resolves a tenant Principal and goes through the repository layer
 * (src/db/repo.ts → withTenant → RLS). Mounted by the Worker's fetch handler.
 */
export function createApi() {
  const app = new Hono<{ Bindings: Env; Variables: Vars }>();

  app.get("/health", (c) => c.json({ ok: true, service: "fyj-ops-console" }));

  // Per-request Hyperdrive pool, closed after the response is flushed.
  app.use("/api/*", async (c, next) => {
    const { db, close } = createDb(c.env.HYPERDRIVE.connectionString);
    c.set("db", db);
    try {
      await next();
    } finally {
      c.executionCtx.waitUntil(close());
    }
  });

  // Better Auth: sign-up / sign-in / session / sign-out / …
  app.on(["GET", "POST"], "/api/auth/*", (c) => {
    const auth = createAuth(c.env, c.get("db"), (p) => c.executionCtx.waitUntil(p));
    return auth.handler(c.req.raw);
  });

  // Authn + tenant resolution for the rest of /api.
  app.use("/api/*", async (c, next) => {
    if (c.req.path.startsWith("/api/auth/")) return next();
    const auth = createAuth(c.env, c.get("db"), (p) => c.executionCtx.waitUntil(p));
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session?.user) return c.json({ error: "unauthenticated" }, 401);
    const principal = await resolvePrincipal(
      c.get("db"),
      session.user.id,
      c.req.header("x-org-id") ?? null,
    );
    if (!principal) return c.json({ error: "no_tenant_access" }, 403);
    c.set("principal", principal);
    return next();
  });

  app.get("/api/me", (c) => c.json({ principal: c.get("principal") }));

  // ── clients ──────────────────────────────────────────────────────────
  app.get("/api/clients", async (c) =>
    c.json(await repo.listClients(c.get("db"), c.get("principal"))),
  );

  app.post("/api/clients", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p) || p.role === "viewer") return c.json({ error: "forbidden" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as Partial<repo.NewClientInput>;
    if (!body.fullName) return c.json({ error: "fullName required" }, 400);
    const row = await repo.createClient(c.get("db"), p, { fullName: body.fullName, ...body });
    return c.json(row, 201);
  });

  app.get("/api/clients/:id", async (c) => {
    const row = await repo.getClient(c.get("db"), c.get("principal"), c.req.param("id"));
    return row ? c.json(row) : c.json({ error: "not_found" }, 404);
  });

  // ── profiles ─────────────────────────────────────────────────────────
  app.get("/api/clients/:id/profiles", async (c) =>
    c.json(await repo.listProfiles(c.get("db"), c.get("principal"), c.req.param("id"))),
  );

  app.post("/api/clients/:id/profiles", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p) || p.role === "viewer") return c.json({ error: "forbidden" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as Partial<repo.NewProfileInput>;
    if (!body.label) return c.json({ error: "label required" }, 400);
    const row = await repo.createProfile(c.get("db"), p, {
      clientId: c.req.param("id"),
      label: body.label,
      resumeText: body.resumeText ?? null,
      targetFilters: body.targetFilters ?? {},
    });
    return c.json(row, 201);
  });

  // ── campaign matches (curation) ──────────────────────────────────────
  app.get("/api/campaigns/:id/matches", async (c) =>
    c.json(await repo.listCampaignMatches(c.get("db"), c.get("principal"), c.req.param("id"))),
  );

  app.post("/api/matches/:id/action", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p) || p.role === "viewer") return c.json({ error: "forbidden" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as { action?: string };
    const action = body.action as repo.MatchAction | undefined;
    if (!action || !matchAction.enumValues.includes(action))
      return c.json({ error: "invalid action" }, 400);
    const row = await repo.setMatchAction(c.get("db"), p, c.req.param("id"), action);
    return row ? c.json(row) : c.json({ error: "not_found" }, 404);
  });

  // ── members (admin) ──────────────────────────────────────────────────
  app.get("/api/members", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p) || p.role !== "admin") return c.json({ error: "forbidden" }, 403);
    return c.json(await repo.listMembers(c.get("db"), p));
  });

  app.post("/api/members", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p) || p.role !== "admin") return c.json({ error: "forbidden" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as { userId?: string; role?: string };
    const role = body.role as repo.MemberRole | undefined;
    if (!body.userId || !role || !memberRole.enumValues.includes(role))
      return c.json({ error: "userId + valid role required" }, 400);
    const row = await repo.inviteMember(c.get("db"), p, body.userId, role);
    return c.json(row, 201);
  });

  // ── feedback (client portal, insert-only) ────────────────────────────
  app.post("/api/feedback", async (c) => {
    const p = c.get("principal");
    if (p.principal !== "client") return c.json({ error: "client_only" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as Partial<repo.FeedbackInput>;
    const signal = body.signal as repo.FeedbackSignal | undefined;
    if (!signal || !feedbackSignal.enumValues.includes(signal))
      return c.json({ error: "valid signal required" }, 400);
    const row = await repo.submitFeedback(c.get("db"), p, { ...body, signal });
    return c.json(row, 201);
  });

  return app;
}
