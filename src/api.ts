import { Hono } from "hono";
import { cors } from "hono/cors";
import { createDb, type DB, type Principal } from "./db/client";
import { createAuth } from "./auth";
import { resolvePrincipal } from "./principal";
import * as repo from "./db/repo";
import {
  matchAction,
  matchConfidence,
  clientStatus,
  consentStatus,
  feedbackSignal,
  memberRole,
} from "./db/schema";
import { parseResume } from "./resume";
import { embedText, embedRaw } from "./embeddings";
import { summarizeResume } from "./summarize";
import { searchAndHydrate, getJob, type JobFilters } from "./index-client";

type Vars = { db: DB; principal: Principal };

/** Minimal Blob/File shape for an uploaded multipart part (see resume route). */
interface UploadedFile {
  name: string;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

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

  // CORS for the browser UI (a different origin, e.g. *.vercel.app). Credentials
  // are on (the Better Auth session cookie), so the allowed origin must be the
  // exact request origin, never "*". WEB_ORIGIN is a comma-separated allowlist;
  // requests from an unlisted origin get no CORS headers (browser blocks them).
  // Registered first so OPTIONS preflight is answered before the DB middleware.
  app.use("/api/*", (c, next) => {
    const allow = (c.env.WEB_ORIGIN ?? "http://localhost:3000")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    return cors({
      origin: (origin) => (allow.includes(origin) ? origin : allow[0] ?? null),
      credentials: true,
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "x-org-id"],
    })(c, next);
  });

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

  // Update a candidate (status / headline / consent) — f-139 P3.
  app.patch("/api/clients/:id", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p) || p.role === "viewer") return c.json({ error: "forbidden" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as {
      status?: string;
      headline?: string | null;
      consentStatus?: string;
    };
    if (body.status !== undefined && !clientStatus.enumValues.includes(body.status as repo.ClientStatus))
      return c.json({ error: "invalid status" }, 400);
    if (
      body.consentStatus !== undefined &&
      !consentStatus.enumValues.includes(body.consentStatus as repo.ConsentStatus)
    )
      return c.json({ error: "invalid consentStatus" }, 400);
    const row = await repo.updateClient(c.get("db"), p, c.req.param("id"), {
      status: body.status as repo.ClientStatus | undefined,
      headline: body.headline,
      consentStatus: body.consentStatus as repo.ConsentStatus | undefined,
    });
    return row ? c.json(row) : c.json({ error: "not_found" }, 404);
  });

  // Applications (placements) for one candidate — f-139 P3.
  app.get("/api/clients/:id/applications", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p)) return c.json({ error: "forbidden" }, 403);
    return c.json(
      await repo.listApplications(c.get("db"), p, { clientId: c.req.param("id") }),
    );
  });

  // Update a track/profile (autopilot, criteria) — f-139 P3.
  app.patch("/api/profiles/:id", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p) || p.role === "viewer") return c.json({ error: "forbidden" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as {
      autopilot?: boolean;
      targetFilters?: Record<string, unknown>;
    };
    const row = await repo.updateProfile(c.get("db"), p, c.req.param("id"), body);
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

  // ── resume upload → R2 → parse → embed (f-134) ───────────────────────
  // multipart/form-data with a `file` field. We store the original bytes in R2,
  // extract text (PDF/DOCX/text), embed it into the index's vector space, and
  // persist embedding + parsedProfile onto the profile so it becomes matchable.
  app.post("/api/clients/:id/profiles/:profileId/resume", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p) || p.role === "viewer") return c.json({ error: "forbidden" }, 403);

    const clientId = c.req.param("id");
    const profileId = c.req.param("profileId");

    // RLS-checked read: only resolves if this staff can access the client's profile.
    const profile = await repo.getProfile(c.get("db"), p, profileId);
    if (!profile || profile.clientId !== clientId) return c.json({ error: "not_found" }, 404);

    const form = await c.req.formData().catch(() => null);
    // The uploaded part is a Blob/File; workers-types narrows FormData.get to
    // `string | null`, so treat it as unknown and structurally check it.
    const file = form?.get("file") as UploadedFile | string | null | undefined;
    if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
      return c.json({ error: "file required" }, 400);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength === 0) return c.json({ error: "empty file" }, 400);

    const parsed = await parseResume(bytes, file.name, file.type || null);
    if (!parsed.text.trim()) return c.json({ error: "no text extracted from resume" }, 422);

    // R2 key namespaced by tenant so listings/lifecycle stay org-scoped.
    const storagePath = `resumes/${p.orgId}/${clientId}/${profileId}/${file.name}`;
    await c.env.RESUMES.put(storagePath, bytes, {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
    });

    // Match how the index embeds JOBS: summarize the resume into the same
    // JD-style 14-field precis + title/signal prelude (src/summarize.ts mirrors
    // fyj_scanner's summarize.mjs + buildJobText), then embed that VERBATIM so
    // the resume lands in the job vector distribution. Embedding raw prose would
    // rank worse — jobs.embedding comes from the summary, not the description.
    const summary = await summarizeResume(c.env, parsed.text);
    const { embedding, model } = await embedRaw(c.env, summary.embedInput);
    const row = await repo.attachResume(c.get("db"), p, profileId, {
      resumeStoragePath: storagePath,
      resumeText: parsed.text,
      parsedProfile: {
        ...parsed.profile,
        kind: parsed.kind,
        title: summary.title,
        summary: summary.summary,
      },
      embedding,
      embeddingModel: model,
    });
    return row ? c.json(row) : c.json({ error: "not_found" }, 404);
  });

  // ── index search (f-134) ─────────────────────────────────────────────
  // Match a profile's embedding against the index, hydrated for display. The
  // embedding is a tenant resource, so it's read through the repository (RLS).
  app.get("/api/profiles/:id/jobs", async (c) => {
    const profile = await repo.getProfile(c.get("db"), c.get("principal"), c.req.param("id"));
    if (!profile) return c.json({ error: "not_found" }, 404);
    if (!profile.embedding) return c.json({ error: "profile_not_embedded" }, 409);
    const filters: JobFilters = {
      ...(profile.targetFilters as JobFilters),
      limit: 50,
    };
    const hits = await searchAndHydrate(c.env, profile.embedding as number[], filters);
    return c.json(hits);
  });

  // Ad-hoc text search (dashboard command bar / Jobs free search): embed the
  // query string on the fly, then the same hydrated index search.
  app.post("/api/search", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { query?: string; filters?: JobFilters };
    const query = body.query?.trim();
    if (!query) return c.json({ error: "query required" }, 400);
    const { embedding } = await embedText(c.env, query);
    const hits = await searchAndHydrate(c.env, embedding, { limit: 50, ...(body.filters ?? {}) });
    return c.json(hits);
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

  // ── match review / Explore (f-139 P2) ────────────────────────────────
  // Cross-campaign match list, RLS-scoped to the caller's book, hydrated with
  // job title/company/location/url from the read-only index (KV-cached).
  app.get("/api/matches", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p)) return c.json({ error: "forbidden" }, 403);
    const conf = c.req.query("confidence");
    const confidence =
      conf && matchConfidence.enumValues.includes(conf as repo.MatchConfidence)
        ? (conf as repo.MatchConfidence)
        : null;
    const limit = Math.min(Math.max(Number(c.req.query("limit")) || 50, 1), 50);
    const matches = await repo.listMatches(c.get("db"), p, {
      candidateId: c.req.query("candidateId") ?? null,
      confidence,
      limit,
    });
    const hydrated = await Promise.all(
      matches.map(async (m) => {
        const job = await getJob(c.env, m.jobId, m.companyId).catch(() => null);
        return {
          ...m,
          jobTitle: job?.title ?? null,
          company: job?.company ?? null,
          location: job?.location ?? null,
          url: job?.url ?? null,
        };
      }),
    );
    return c.json(hydrated);
  });

  // Approve a match → mark it actioned + queue a placement (idempotent).
  app.post("/api/matches/:id/approve", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p) || p.role === "viewer") return c.json({ error: "forbidden" }, 403);
    const result = await repo.approveMatch(c.get("db"), p, c.req.param("id"));
    return result ? c.json(result) : c.json({ error: "not_found" }, 404);
  });

  // ── dashboard analytics (f-139) ──────────────────────────────────────
  // Org-wide rollups for the operator home. Any staff seat (incl. viewer) may
  // read; the org scoping + cross-client aggregation happens in the SECURITY
  // DEFINER functions the repo calls.
  app.get("/api/dashboard/kpis", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p)) return c.json({ error: "forbidden" }, 403);
    return c.json(await repo.dashboardKpis(c.get("db"), p));
  });

  app.get("/api/dashboard/funnel", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p)) return c.json({ error: "forbidden" }, 403);
    return c.json(await repo.dashboardFunnel(c.get("db"), p));
  });

  app.get("/api/dashboard/leaderboard", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p)) return c.json({ error: "forbidden" }, 403);
    return c.json(await repo.dashboardLeaderboard(c.get("db"), p));
  });

  app.get("/api/dashboard/trends", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p)) return c.json({ error: "forbidden" }, 403);
    return c.json(await repo.dashboardTrends(c.get("db"), p));
  });

  app.get("/api/dashboard/activity", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p)) return c.json({ error: "forbidden" }, 403);
    return c.json(await repo.dashboardActivity(c.get("db"), p));
  });

  // Top live applications (placements), RLS-scoped to the caller's book.
  app.get("/api/applications", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p)) return c.json({ error: "forbidden" }, 403);
    return c.json(await repo.listApplications(c.get("db"), p));
  });

  // Calendar (f-139 P4): schedule events derived from placements by date.
  app.get("/api/calendar", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p)) return c.json({ error: "forbidden" }, 403);
    const now = new Date();
    const year = Number(c.req.query("year")) || now.getUTCFullYear();
    const monthQ = c.req.query("month");
    const month = monthQ != null && monthQ !== "" ? Number(monthQ) : now.getUTCMonth();
    return c.json(await repo.listCalendarEvents(c.get("db"), p, { year, month }));
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
