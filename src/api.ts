import { Hono } from "hono";
import { cors } from "hono/cors";
import { sql } from "drizzle-orm";
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
import * as Sentry from "@sentry/cloudflare";
import { parseResume } from "./resume";
import { embedText } from "./embeddings";
import { getJob, recentJobs, type JobFilters } from "./index-client";
import { matchProfile } from "./match";
import { runIntake } from "./graph/intake";
import { enrichOne } from "./graph/enrich";
import { tailorResume } from "./graph/tailor";
import { hasAnthropic } from "./graph/llm";
import {
  runTailorLab,
  labDefaults,
  LAB_MODELS,
  LAB_SAMPLE,
  type LabRequest,
  type LabStageConfig,
} from "./graph/tailor-lab";
import { capture, langsmithTracing } from "./observability";

type Vars = { db: DB; principal: Principal };

/** Minimal Blob/File shape for an uploaded multipart part (see resume route). */
interface UploadedFile {
  name: string;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

const isStaff = (p: Principal): p is Extract<Principal, { principal: "staff" }> =>
  p.principal === "staff";

/** Build a human pay string from the index's structured comp fields (f-139). */
function formatComp(j: {
  compMin: number | null;
  compMax: number | null;
  compCurrency: string | null;
  compInterval: string | null;
  compText: string | null;
}): string | null {
  if (j.compText) return j.compText;
  if (j.compMin == null && j.compMax == null) return null;
  const sym = !j.compCurrency || j.compCurrency === "USD" ? "$" : `${j.compCurrency} `;
  const fmt = (n: number) => (n >= 1000 && n % 1000 === 0 ? `${n / 1000}k` : n.toLocaleString("en-US"));
  const lo = j.compMin != null ? `${sym}${fmt(j.compMin)}` : null;
  const hi = j.compMax != null ? `${sym}${fmt(j.compMax)}` : null;
  const range = lo && hi ? `${lo}–${hi}` : (lo ?? hi);
  const per = j.compInterval === "hour" ? "/hr" : j.compInterval === "month" ? "/mo" : "";
  return range ? `${range}${per}` : null;
}

/**
 * Create a Better Auth user from a username + password (used by the seed and
 * admin "create operator" paths). Email/password is the underlying credential,
 * so we synthesize a non-deliverable placeholder email — it's never used to log
 * in (staff sign in by username) and is unique because the username is. Returns
 * the new user id; throws the Better Auth error on conflict/validation.
 */
async function createAuthUser(
  auth: ReturnType<typeof createAuth>,
  input: { username: string; password: string; name?: string },
): Promise<string> {
  const res = await auth.api.signUpEmail({
    body: {
      email: `${input.username.toLowerCase()}@staff.fyj.local`,
      password: input.password,
      name: input.name?.trim() || input.username,
      username: input.username,
    },
  });
  return res.user.id;
}

/** Best-effort message for a failed user creation (e.g. username taken). */
function authUserError(e: unknown): string {
  if (e && typeof e === "object" && "body" in e) {
    const body = (e as { body?: { message?: string; code?: string } }).body;
    if (body?.message) return body.message;
    if (body?.code) return body.code;
  }
  return e instanceof Error ? e.message : "could not create user";
}

function profileSummary(parsed: unknown): string {
  const p = parsed as { summary?: string } | null;
  return (p?.summary ?? "").toString();
}

/**
 * Background (waitUntil) enrichment of a campaign's freshly surfaced matches.
 * Runs the LangGraph enrich graph per match with bounded concurrency. Opens its
 * OWN DB connection — the per-request Hyperdrive pool is closed once the response
 * is flushed, so background work must not borrow it.
 */
async function enrichCampaignBackground(env: Env, who: Principal, campaignId: string): Promise<void> {
  if (!hasAnthropic(env)) return; // rationale/skills need Claude; no-op until the key is set
  const { db, close } = createDb(env.HYPERDRIVE.connectionString);
  try {
    const ctx = await repo.getCampaignProfile(db, who, campaignId);
    const summary = ctx ? profileSummary(ctx.parsedProfile) || (ctx.resumeText ?? "") : "";
    if (!summary) return;
    const pending = await repo.listMatchesToEnrich(db, who, campaignId, 25);
    const queue = [...pending];
    const worker = async () => {
      for (let m = queue.shift(); m; m = queue.shift()) {
        try {
          const job = await getJob(env, m.jobId, m.companyId);
          if (!job) continue;
          const e = await enrichOne(env, summary, job);
          await repo.enrichMatch(db, who, m.id, e);
        } catch (err) {
          console.error(JSON.stringify({ at: "enrich", matchId: m.id, err: String(err) }));
          Sentry.captureException(err, { data: { at: "enrich", matchId: m.id } });
        }
      }
    };
    await Promise.all(Array.from({ length: 5 }, worker));
  } catch (err) {
    console.error(JSON.stringify({ at: "enrichCampaign", campaignId, err: String(err) }));
    Sentry.captureException(err, { data: { at: "enrichCampaign", campaignId } });
  } finally {
    await close();
  }
}

/**
 * Résumé tailoring for an approved match (own DB conn). Runs in the QUEUE
 * consumer (src/index.ts), not request `waitUntil`: a cold-cache draft→critique→
 * revise chain takes longer than the post-response budget and Cloudflare cancels
 * it before `saveTailoredResume`, leaving the résumé stuck "pending" (f-147 live
 * finding). The queue gives it a full background invocation. Exported for the
 * consumer; the request path only ENQUEUES (see `enqueueTailor`).
 */
export async function tailorMatchBackground(env: Env, who: Principal, matchId: string): Promise<void> {
  if (!hasAnthropic(env)) return;
  const { db, close } = createDb(env.HYPERDRIVE.connectionString);
  const startedAt = Date.now();
  // LangSmith trace of the write→review→revise graph (no-op without the key).
  // Queue consumer = full background invocation, so the flush is awaited inline.
  const tracing = langsmithTracing(env, { matchId, orgId: who.orgId });
  try {
    const ctx = await repo.getTailoringContext(db, who, matchId);
    if (!ctx || !ctx.resumeText) return;
    const job = await getJob(env, ctx.jobId, ctx.companyId);
    if (!job) return;
    const result = await tailorResume(env, ctx.resumeText, job, profileSummary(ctx.parsedProfile), tracing);
    const resumeName = `${(job.title ?? "role").replace(/[^a-z0-9]+/gi, "_").slice(0, 48)}.md`;
    await repo.saveTailoredResume(db, who, {
      matchId,
      clientId: ctx.clientId,
      markdown: result.markdown,
      model: result.model,
      resumeName,
    });
    await capture(env, "tailor_completed", {
      distinctId: who.userId,
      orgId: who.orgId,
      props: { matchId, durationMs: Date.now() - startedAt, iterations: result.iterations, model: result.model },
    });
  } catch (err) {
    console.error(JSON.stringify({ at: "tailorMatch", matchId, err: String(err) }));
    Sentry.captureException(err, { data: { at: "tailorMatch", matchId } });
    await capture(env, "tailor_failed", {
      distinctId: who.userId,
      orgId: who.orgId,
      props: { matchId, durationMs: Date.now() - startedAt },
    });
    // Swallowed (no rethrow), as before: a failed tailor stays "pending" and the
    // drawer's "Regenerate" re-kicks it — the queue does not retry tailor jobs.
  } finally {
    await tracing?.flush();
    await close();
  }
}

/**
 * The ops-console HTTP API (f-133). Better Auth owns /api/auth/**; every other
 * /api route resolves a tenant Principal and goes through the repository layer
 * (src/db/repo.ts → withTenant → RLS). Mounted by the Worker's fetch handler.
 */
export function createApi() {
  const app = new Hono<{ Bindings: Env; Variables: Vars }>();

  // Surface the real cause of a failed request. Drizzle wraps DB errors as
  // "Failed query: …" and hides the underlying Postgres message (permission /
  // RLS / constraint) on `.cause` — log the whole chain so failures are
  // diagnosable from `wrangler tail` instead of an opaque 500.
  app.onError((err, c) => {
    const cause = (err as { cause?: unknown }).cause;
    console.error(
      JSON.stringify({
        at: "onError",
        path: c.req.path,
        method: c.req.method,
        message: err instanceof Error ? err.message : String(err),
        cause: cause instanceof Error ? cause.message : cause ? String(cause) : null,
        code: (cause as { code?: string } | undefined)?.code ?? null,
      }),
    );
    // Hono catches route errors, so withSentry never sees them as unhandled —
    // this single hook is where every API error becomes a Sentry issue.
    Sentry.captureException(err, { data: { path: c.req.path, method: c.req.method } });
    return c.json({ error: "internal_error" }, 500);
  });


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

  // ONBOARDING: public self-sign-up is closed. Hard-block the Better Auth
  // sign-up HTTP route (every method/sub-path) BEFORE the catch-all below — the
  // seed + admin "create operator" paths create users via auth.api.signUpEmail
  // directly (off this route), so this only stops anonymous self-registration.
  app.all("/api/auth/sign-up/*", (c) => c.json({ error: "signup_disabled" }, 403));

  // Better Auth: sign-in / session / sign-out / …
  app.on(["GET", "POST"], "/api/auth/*", (c) => {
    const auth = createAuth(c.env, c.get("db"), (p) => c.executionCtx.waitUntil(p));
    return auth.handler(c.req.raw);
  });

  // Seed: create the first org + its admin. Unauthenticated by design (there is
  // no admin yet); guarded by a shared secret instead. Exempt from the session
  // middleware below, like /api/auth.
  app.post("/api/seed/org-admin", async (c) => {
    const secret = c.env.ADMIN_BOOTSTRAP_SECRET;
    if (!secret || c.req.header("x-seed-secret") !== secret)
      return c.json({ error: "forbidden" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as {
      username?: string;
      password?: string;
      name?: string;
      orgName?: string;
    };
    const username = body.username?.trim();
    if (!username || !body.password) return c.json({ error: "username + password required" }, 400);
    const db = c.get("db");
    const auth = createAuth(c.env, db, (p) => c.executionCtx.waitUntil(p));
    let userId: string;
    try {
      userId = await createAuthUser(auth, {
        username,
        password: body.password,
        name: body.name,
      });
    } catch (e) {
      return c.json({ error: authUserError(e) }, 409);
    }
    // SECURITY DEFINER: creates organization + admin membership atomically.
    const rows = (await db.execute(
      sql`select app.bootstrap_org_for_user(${userId}, ${body.orgName ?? `${username}'s org`}) as org_id`,
    )) as unknown as Array<{ org_id: string }>;
    return c.json({ userId, orgId: rows[0]?.org_id ?? null, username }, 201);
  });

  // Authn + tenant resolution for the rest of /api.
  app.use("/api/*", async (c, next) => {
    if (c.req.path.startsWith("/api/auth/")) return next();
    if (c.req.path.startsWith("/api/seed/")) return next();
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

  // Update a candidate — core details (name/email/phone/headline/notes) plus
  // status / consent (f-139 P3, extended f-144 for the edit-profile modal).
  app.patch("/api/clients/:id", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p) || p.role === "viewer") return c.json({ error: "forbidden" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as {
      fullName?: string;
      email?: string | null;
      phone?: string | null;
      status?: string;
      headline?: string | null;
      consentStatus?: string;
      notes?: string | null;
    };
    if (body.fullName !== undefined && !body.fullName.trim())
      return c.json({ error: "fullName cannot be empty" }, 400);
    if (body.status !== undefined && !clientStatus.enumValues.includes(body.status as repo.ClientStatus))
      return c.json({ error: "invalid status" }, 400);
    if (
      body.consentStatus !== undefined &&
      !consentStatus.enumValues.includes(body.consentStatus as repo.ConsentStatus)
    )
      return c.json({ error: "invalid consentStatus" }, 400);
    const row = await repo.updateClient(c.get("db"), p, c.req.param("id"), {
      fullName: body.fullName?.trim(),
      email: body.email,
      phone: body.phone,
      status: body.status as repo.ClientStatus | undefined,
      headline: body.headline,
      consentStatus: body.consentStatus as repo.ConsentStatus | undefined,
      notes: body.notes,
    });
    return row ? c.json(row) : c.json({ error: "not_found" }, 404);
  });

  // Permanently delete a candidate (admin only — matches the clients_delete RLS
  // policy). The DB cascade removes profiles/campaigns/matches/reports/placements/
  // feedback; we additionally purge the candidate's résumé objects from R2 since
  // object storage isn't reached by the FK cascade.
  app.delete("/api/clients/:id", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p)) return c.json({ error: "forbidden" }, 403);
    if (p.role !== "admin") return c.json({ error: "admin_only" }, 403);
    const clientId = c.req.param("id");
    const result = await repo.deleteClient(c.get("db"), p, clientId);
    if (!result) return c.json({ error: "not_found" }, 404);
    // Best-effort R2 purge — the DB row is already gone, so a storage hiccup must
    // not fail the request (it would only leave orphan objects, logged below).
    try {
      const prefix = `resumes/${p.orgId}/${clientId}/`;
      const listed = await c.env.RESUMES.list({ prefix });
      const keys = listed.objects.map((o) => o.key);
      if (keys.length) await c.env.RESUMES.delete(keys);
    } catch (err) {
      console.error(JSON.stringify({ at: "deleteClient.r2", clientId, err: String(err) }));
    }
    return c.json({ ok: true, id: clientId });
  });

  // Applications (placements) for one candidate — f-139 P3.
  app.get("/api/clients/:id/applications", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p)) return c.json({ error: "forbidden" }, 403);
    return c.json(
      await repo.listApplications(c.get("db"), p, { clientId: c.req.param("id") }),
    );
  });

  // ── candidate feedback (f-146 activity panel) ────────────────────────
  app.get("/api/clients/:id/feedback", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p)) return c.json({ error: "forbidden" }, 403);
    return c.json(await repo.listFeedback(c.get("db"), p, c.req.param("id")));
  });

  app.post("/api/clients/:id/feedback", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p) || p.role === "viewer") return c.json({ error: "forbidden" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as Partial<repo.FeedbackInput>;
    const signal = body.signal as repo.FeedbackSignal | undefined;
    if (!signal || !feedbackSignal.enumValues.includes(signal))
      return c.json({ error: "valid signal required" }, 400);
    const row = await repo.addStaffFeedback(c.get("db"), p, c.req.param("id"), { ...body, signal });
    return row ? c.json(row, 201) : c.json({ error: "not_found" }, 404);
  });

  // ── documents (f-146): résumés + generated tailored résumés ──────────
  app.get("/api/clients/:id/documents", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p)) return c.json({ error: "forbidden" }, 403);
    const docs = await repo.listDocuments(c.get("db"), p, c.req.param("id"));
    // Hydrate the tailored-résumé job titles from the index (KV-cached), same as /api/matches.
    const tailored = await Promise.all(
      docs.tailored.map(async (t) => {
        const job = t.jobId && t.companyId ? await getJob(c.env, t.jobId, t.companyId).catch(() => null) : null;
        return { ...t, jobTitle: job?.title ?? null, company: job?.company ?? null };
      }),
    );
    return c.json({ resumes: docs.resumes, tailored });
  });

  // Stream the original uploaded résumé file from R2. RLS-checked: getProfile
  // only resolves if this staff can access the profile's candidate.
  app.get("/api/clients/:id/profiles/:profileId/resume-file", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p)) return c.json({ error: "forbidden" }, 403);
    const profile = await repo.getProfile(c.get("db"), p, c.req.param("profileId"));
    if (!profile || profile.clientId !== c.req.param("id") || !profile.resumeStoragePath)
      return c.json({ error: "not_found" }, 404);
    const obj = await c.env.RESUMES.get(profile.resumeStoragePath);
    if (!obj) return c.json({ error: "not_found" }, 404);
    const fileName = profile.resumeStoragePath.split("/").pop() ?? "resume";
    return new Response(obj.body, {
      headers: {
        "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
        "content-disposition": `inline; filename="${fileName.replace(/"/g, "")}"`,
      },
    });
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

  // Save operator edits to the résumé-extracted Experience / Skills sections
  // (f-146). Display-only — merged into parsed_profile.candidate; not re-embedded.
  app.patch("/api/profiles/:id/extraction", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p) || p.role === "viewer") return c.json({ error: "forbidden" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as {
      experience?: unknown;
      skills?: unknown;
    };
    const patch: repo.ProfileExtractionPatch = {};
    if (body.skills !== undefined) {
      if (!Array.isArray(body.skills)) return c.json({ error: "skills must be an array" }, 400);
      patch.skills = body.skills.map((s) => String(s).trim()).filter(Boolean).slice(0, 40);
    }
    if (body.experience !== undefined) {
      if (!Array.isArray(body.experience))
        return c.json({ error: "experience must be an array" }, 400);
      patch.experience = body.experience.slice(0, 20).map((e) => {
        const o = (e ?? {}) as Record<string, unknown>;
        const str = (v: unknown) => {
          const t = v == null ? "" : String(v).trim();
          return t ? t.slice(0, 600) : null;
        };
        return { title: str(o.title), company: str(o.company), period: str(o.period), summary: str(o.summary) };
      });
    }
    if (patch.experience === undefined && patch.skills === undefined)
      return c.json({ error: "nothing to update" }, 400);
    const row = await repo.updateProfileCandidate(c.get("db"), p, c.req.param("id"), patch);
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

    // Intake graph (LangGraph): extract structured candidate fields (gpt-4o-mini),
    // summarize + embed into the index's vector space (reuses f-134), and search
    // the index for the top matches — all in one graph run. LangSmith-traced when
    // configured; the flush rides waitUntil so it never blocks the response.
    const tracing = langsmithTracing(c.env, { orgId: p.orgId, clientId, profileId });
    const intake = await runIntake(c.env, parsed.text, tracing);
    if (tracing) c.executionCtx.waitUntil(tracing.flush());
    if (!intake.embedding) return c.json({ error: "could not embed resume" }, 422);

    const row = await repo.attachResume(c.get("db"), p, profileId, {
      resumeStoragePath: storagePath,
      resumeText: parsed.text,
      parsedProfile: {
        ...parsed.profile,
        kind: parsed.kind,
        candidate: intake.candidate,
        summary: intake.embedInput, // JD-style precis — reused by enrichment/tailoring
      },
      embedding: intake.embedding,
      embeddingModel: intake.embeddingModel ?? "text-embedding-3-small",
    });
    if (!row) return c.json({ error: "not_found" }, 404);

    // Auto-populate the candidate + targeting criteria, then activate the
    // campaign and surface the matches the graph found.
    if (intake.candidate)
      await repo.applyResumeExtraction(c.get("db"), p, clientId, profileId, intake.candidate);
    const campaignId = await repo.ensureCampaign(c.get("db"), p, profileId, true);
    if (campaignId && intake.matches.length)
      await repo.recordRun(c.get("db"), p, campaignId, intake.matches);
    if (campaignId)
      c.executionCtx.waitUntil(enrichCampaignBackground(c.env, p, campaignId));

    c.executionCtx.waitUntil(
      capture(c.env, "resume_uploaded", {
        distinctId: p.userId,
        orgId: p.orgId,
        props: { clientId, profileId, surfaced: intake.matches.length, kind: parsed.kind },
      }),
    );
    return c.json({ profile: row, surfaced: intake.matches.length });
  });

  // On-demand "Find matches" for a profile/campaign — surfaces the top ~25 into
  // campaign_matches now (dedup in DB) and enriches them in the background.
  app.post("/api/profiles/:id/match", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p) || p.role === "viewer") return c.json({ error: "forbidden" }, 403);
    const profile = await repo.getProfile(c.get("db"), p, c.req.param("id"));
    if (!profile) return c.json({ error: "not_found" }, 404);
    if (!profile.embedding) return c.json({ error: "profile_not_embedded" }, 409);

    const campaignId = await repo.ensureCampaign(c.get("db"), p, profile.id, true);
    if (!campaignId) return c.json({ error: "no_campaign" }, 409);
    // Full pipeline (hybrid retrieve → Voyage rerank → soft adjust). matchProfile
    // strips compFloor/families/seniority from the hard filters and applies them
    // as soft signals (so a `mid` seniority no longer zeroes results, and a comp
    // floor no longer drops the null-comp majority).
    const parsed = (profile.parsedProfile ?? {}) as {
      summary?: string;
      candidate?: { skills?: string[]; seniority?: string | null } | null;
    };
    const matches = await matchProfile(c.env, {
      embedding: profile.embedding as number[],
      queryText: parsed.summary ?? profile.resumeText ?? "",
      lexicalQuery: (parsed.candidate?.skills ?? []).join(", ") || null,
      filters: (profile.targetFilters as JobFilters) ?? { targetOnly: true },
      profileSeniority: parsed.candidate?.seniority ?? null,
    });
    if (matches.length) await repo.recordRun(c.get("db"), p, campaignId, matches);
    c.executionCtx.waitUntil(enrichCampaignBackground(c.env, p, campaignId));
    c.executionCtx.waitUntil(
      capture(c.env, "match_run", {
        distinctId: p.userId,
        orgId: p.orgId,
        props: { mode: "manual", campaignId, surfaced: matches.length },
      }),
    );

    const surfaced = await repo.listMatches(c.get("db"), p, { candidateId: profile.clientId });
    return c.json({ surfaced: matches.length, matches: surfaced });
  });

  // Delete a track (profile) + its 1:1 campaign and surfaced matches (DB cascade).
  // RLS (client_profiles staff-write) restricts this to admin/operator with access.
  app.delete("/api/profiles/:id", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p) || p.role === "viewer") return c.json({ error: "forbidden" }, 403);
    const ok = await repo.deleteProfile(c.get("db"), p, c.req.param("id"));
    if (!ok) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true, id: c.req.param("id") });
  });

  // ── index search (f-134) ─────────────────────────────────────────────
  // Match a profile's embedding against the index, hydrated for display. The
  // embedding is a tenant resource, so it's read through the repository (RLS).
  app.get("/api/profiles/:id/jobs", async (c) => {
    const profile = await repo.getProfile(c.get("db"), c.get("principal"), c.req.param("id"));
    if (!profile) return c.json({ error: "not_found" }, 404);
    if (!profile.embedding) return c.json({ error: "profile_not_embedded" }, 409);
    // Same reranked pipeline as the surfacing paths, then hydrate the ranked refs
    // for display, so the Jobs view and the campaign matches agree on ordering.
    const parsed = (profile.parsedProfile ?? {}) as {
      summary?: string;
      candidate?: { skills?: string[]; seniority?: string | null } | null;
    };
    const ranked = await matchProfile(c.env, {
      embedding: profile.embedding as number[],
      queryText: parsed.summary ?? profile.resumeText ?? "",
      lexicalQuery: (parsed.candidate?.skills ?? []).join(", ") || null,
      filters: (profile.targetFilters as JobFilters) ?? { targetOnly: true },
      profileSeniority: parsed.candidate?.seniority ?? null,
    });
    const hits = (
      await Promise.all(
        ranked.map(async (m) => {
          const detail = await getJob(c.env, m.jobId, m.companyId).catch(() => null);
          return detail
            ? {
                ...detail,
                score: m.score,
                rank: m.rank,
                fitScore: m.fitScore,
                confidence: m.confidence,
                guardrails: m.guardrails,
              }
            : null;
        }),
      )
    ).filter((h): h is NonNullable<typeof h> => h !== null);
    return c.json(hits);
  });

  // Explore: newest active postings to browse before a query (f-151). Behind the
  // auth middleware; a plain "newest first" listing, not a search.
  app.get("/api/jobs/recent", async (c) => {
    const limit = Math.min(Math.max(Number(c.req.query("limit")) || 30, 1), 100);
    return c.json(await recentJobs(c.env, limit));
  });

  // Ad-hoc natural-language job search (Explore / command bar). f-151: routes
  // through the SAME hybrid (dense + lexical RRF) + Voyage rerank pipeline as
  // candidate matching — the query doubles as the lexical-arm query (exact skill
  // tokens) and the rerank query — then hydrates the ranked refs for display.
  app.post("/api/search", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { query?: string; filters?: JobFilters };
    const query = body.query?.trim();
    if (!query) return c.json({ error: "query required" }, 400);
    const { embedding } = await embedText(c.env, query);
    const ranked = await matchProfile(c.env, {
      embedding,
      queryText: query,
      lexicalQuery: query,
      filters: { targetOnly: true, ...(body.filters ?? {}) },
      profileSeniority: null,
    });
    const hits = (
      await Promise.all(
        ranked.map(async (m) => {
          const detail = await getJob(c.env, m.jobId, m.companyId).catch(() => null);
          return detail ? { ...detail, score: m.score, rank: m.rank, fitScore: m.fitScore } : null;
        }),
      )
    ).filter((h): h is NonNullable<typeof h> => h !== null);
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
          workplace: job?.workplace ?? null,
          employmentType: job?.employmentType ?? null,
          source: job?.source ?? null,
          postedAt: job?.postedAt ?? null,
          comp: job ? formatComp(job) : null,
        };
      }),
    );
    return c.json(hydrated);
  });

  // Approve a match → mark it actioned + queue a placement (idempotent).
  app.post("/api/matches/:id/approve", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p) || p.role === "viewer") return c.json({ error: "forbidden" }, 403);
    const matchId = c.req.param("id");
    const result = await repo.approveMatch(c.get("db"), p, matchId);
    if (!result) return c.json({ error: "not_found" }, 404);
    // Tailor the master résumé to this job — ENQUEUED, not run in `waitUntil`,
    // so the cold-cache draft→critique→revise chain runs in a full queue
    // invocation instead of being cancelled by the short post-response budget
    // (which left the résumé stuck "pending" — f-147 live finding).
    //
    // Only kick it once: if this match already HAS a tailored résumé we must not
    // regenerate it — re-approving (matches reappear after a reload) would upsert
    // over the stored one and wipe any operator edits. The drawer shows the saved
    // résumé via GET; an explicit "Regenerate" is the way to deliberately redo it.
    let tailoring = false;
    if (hasAnthropic(c.env)) {
      const existing = await repo.getTailoredResume(c.get("db"), p, matchId);
      if (!existing) {
        c.executionCtx.waitUntil(c.env.MATCH_QUEUE.send({ kind: "tailor", matchId, principal: p }));
        tailoring = true;
      }
    }
    c.executionCtx.waitUntil(
      capture(c.env, "match_approved", {
        distinctId: p.userId,
        orgId: p.orgId,
        props: { matchId, tailoring },
      }),
    );
    return c.json({ ...result, tailoring });
  });

  // Kick (or re-kick) résumé tailoring for a match WITHOUT changing its action —
  // used when the operator opens the tailored-résumé drawer directly. Returns a
  // precise reason when tailoring can't run so the UI shows a message instead of
  // spinning forever (the silent-no-op that made "Tailored résumé" look broken).
  app.post("/api/matches/:id/tailor", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p) || p.role === "viewer") return c.json({ error: "forbidden" }, 403);
    const matchId = c.req.param("id");
    const ctx = await repo.getTailoringContext(c.get("db"), p, matchId);
    if (!ctx) return c.json({ error: "not_found" }, 404);
    if (!ctx.resumeText)
      return c.json({ tailoring: false, reason: "no_resume" as const });
    if (!hasAnthropic(c.env)) return c.json({ tailoring: false, reason: "no_ai" as const });
    c.executionCtx.waitUntil(c.env.MATCH_QUEUE.send({ kind: "tailor", matchId, principal: p }));
    return c.json({ tailoring: true });
  });

  // Tailored résumé (Markdown) for an approved match — read + operator edits.
  app.get("/api/matches/:id/resume", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p)) return c.json({ error: "forbidden" }, 403);
    const row = await repo.getTailoredResume(c.get("db"), p, c.req.param("id"));
    if (!row) return c.json({ status: "pending", markdown: null });
    return c.json({ status: "ready", markdown: row.markdown, model: row.model, generatedAt: row.generatedAt });
  });

  app.put("/api/matches/:id/resume", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p) || p.role === "viewer") return c.json({ error: "forbidden" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as { markdown?: string };
    if (typeof body.markdown !== "string") return c.json({ error: "markdown required" }, 400);
    const row = await repo.updateTailoredResume(c.get("db"), p, c.req.param("id"), body.markdown);
    return row ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
  });

  // ── résumé prompt lab (dev tool) ─────────────────────────────────────
  // Staff-only harness to A/B tailoring prompts + model combinations across the
  // planner/generator/verifier stages. GET returns the shipped defaults + model
  // catalogue + a runnable sample; POST runs the pipeline synchronously and
  // returns the full trace (see src/graph/tailor-lab.ts). No DB access — inputs
  // are pasted, so it works without provisioned tenant data.
  app.get("/api/tools/tailor-lab", (c) => {
    const p = c.get("principal");
    if (!isStaff(p) || p.role === "viewer") return c.json({ error: "forbidden" }, 403);
    return c.json({
      models: LAB_MODELS,
      defaults: labDefaults(),
      sample: LAB_SAMPLE,
      hasAnthropic: hasAnthropic(c.env),
      hasOpenai: Boolean(c.env.OPENAI_API_KEY),
    });
  });

  app.post("/api/tools/tailor-lab", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p) || p.role === "viewer") return c.json({ error: "forbidden" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as Partial<{
      master: string;
      jobText: string;
      candidateSummary: string;
      maxIterations: number;
      maxOutputTokens: number;
      planner: LabStageConfig | null;
      generator: LabStageConfig;
      verifier: LabStageConfig;
    }>;

    const master = (body.master ?? "").trim();
    const jobText = (body.jobText ?? "").trim();
    if (!master) return c.json({ error: "master résumé is required" }, 400);
    if (!jobText) return c.json({ error: "job description is required" }, 400);

    const d = labDefaults();
    const stage = (s: LabStageConfig | null | undefined, fallback: LabStageConfig): LabStageConfig => ({
      model: (s?.model ?? fallback.model).trim() || fallback.model,
      system: (s?.system ?? fallback.system).trim() || fallback.system,
    });

    const req: LabRequest = {
      master,
      jobText,
      candidateSummary: (body.candidateSummary ?? "").trim(),
      maxIterations: typeof body.maxIterations === "number" ? body.maxIterations : d.maxIterations,
      maxOutputTokens:
        typeof body.maxOutputTokens === "number" ? body.maxOutputTokens : d.maxOutputTokens,
      // planner === null (explicit) disables the stage; undefined falls back to default (off).
      planner: body.planner === null ? null : body.planner ? stage(body.planner, d.planner) : null,
      generator: stage(body.generator, d.generator),
      verifier: stage(body.verifier, d.verifier),
    };

    const result = await runTailorLab(c.env, req);
    return c.json(result);
  });

  // Lab helper: parse an uploaded résumé (PDF/DOCX/text) to plain text so the
  // operator can populate the master field by upload instead of pasting. Pure
  // extraction — no R2, no embedding, no DB write (unlike the real intake route).
  app.post("/api/tools/tailor-lab/parse", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p) || p.role === "viewer") return c.json({ error: "forbidden" }, 403);
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file") as UploadedFile | string | null | undefined;
    if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
      return c.json({ error: "file required" }, 400);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength === 0) return c.json({ error: "empty file" }, 400);
    const parsed = await parseResume(bytes, file.name, file.type || null);
    if (!parsed.text.trim()) return c.json({ error: "no text extracted from resume" }, 422);
    return c.json({ text: parsed.text, kind: parsed.kind, name: file.name });
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

  // Admin creates a staff account (operator/admin/viewer) with username +
  // password. We create the Better Auth user directly (off the blocked sign-up
  // route, so no session cookie is minted for the admin), then add the active
  // membership in the admin's org. Username is globally unique (Better Auth),
  // which also makes the synthesized placeholder email unique.
  app.post("/api/members", async (c) => {
    const p = c.get("principal");
    if (!isStaff(p) || p.role !== "admin") return c.json({ error: "forbidden" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as {
      username?: string;
      password?: string;
      name?: string;
      role?: string;
    };
    const username = body.username?.trim();
    const role = body.role as repo.MemberRole | undefined;
    if (!username || !body.password || !role || !memberRole.enumValues.includes(role))
      return c.json({ error: "username + password + valid role required" }, 400);

    const db = c.get("db");
    const auth = createAuth(c.env, db, (pr) => c.executionCtx.waitUntil(pr));
    let userId: string;
    try {
      userId = await createAuthUser(auth, { username, password: body.password, name: body.name });
    } catch (e) {
      return c.json({ error: authUserError(e) }, 409);
    }
    const row = await repo.addStaffMembership(db, p, userId, role);
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
