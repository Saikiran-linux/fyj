import * as Sentry from "@sentry/cloudflare";
import { createDb, type Principal } from "./db/client";
import { listActiveCampaignIds, runCampaignMatch } from "./matcher";
import { createApi, tailorMatchBackground } from "./api";
import { capture } from "./observability";

/**
 * Ops Console Worker — three entrypoints:
 *  • fetch     — the API (Hono). Better Auth + tenant-scoped routes (src/api.ts).
 *  • scheduled — hourly cron: enqueue every active campaign for matching (f-135).
 *  • queue     — consume match jobs: pull new index jobs and surface them.
 *
 * Bindings come from the generated `Env` (worker-configuration.d.ts). The DB is
 * reached via Hyperdrive; never store request state in module globals.
 *
 * Observability: the whole handler is wrapped in Sentry.withSentry (no-op until
 * `wrangler secret put SENTRY_DSN`). The cron reports check-ins to a Sentry
 * monitor ("hourly-matcher") so a dead cron ALERTS instead of failing silently —
 * the NULL-embedding regression ran dark for days precisely because nothing
 * watched this path. Queue-consumer failures (tailor + match jobs) become Sentry
 * issues; per-campaign `match_run` events go to PostHog with the surfaced count
 * so a flatline (surfaced=0 across runs) is visible on a dashboard.
 */

const app = createApi();

// Upserted with every check-in; keep `value` in lockstep with wrangler.jsonc's
// triggers.crons. checkinMargin/maxRuntime are minutes.
const CRON_MONITOR = {
  schedule: { type: "crontab", value: "17 * * * *" },
  checkinMargin: 10,
  maxRuntime: 15,
  timezone: "Etc/UTC",
} as const;

const handler = {
  fetch: app.fetch,

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const checkInId = Sentry.captureCheckIn(
      { monitorSlug: "hourly-matcher", status: "in_progress" },
      CRON_MONITOR,
    );
    const { db, close } = createDb(env.HYPERDRIVE.connectionString);
    ctx.waitUntil(
      (async () => {
        try {
          const campaigns = await listActiveCampaignIds(db);
          if (campaigns.length > 0) {
            await env.MATCH_QUEUE.sendBatch(
              campaigns.map((c) => ({ body: { campaignId: c.id, orgId: c.orgId } })),
            );
          }
          Sentry.captureCheckIn(
            { checkInId, monitorSlug: "hourly-matcher", status: "ok" },
            CRON_MONITOR,
          );
        } catch (err) {
          console.error(JSON.stringify({ at: "scheduled", err: String(err) }));
          Sentry.captureException(err, { data: { at: "scheduled" } });
          Sentry.captureCheckIn(
            { checkInId, monitorSlug: "hourly-matcher", status: "error" },
            CRON_MONITOR,
          );
        } finally {
          await close();
        }
      })(),
    );
  },

  // Two message kinds share the queue: continuous-match runs (MatchJob) and
  // résumé-tailoring jobs (TailorJob). Tailoring lives here, NOT in request
  // `waitUntil`, because the cold-cache draft→critique→revise chain outlasts the
  // post-response budget and gets cancelled before it saves (f-147). A queue
  // consumer is a full background invocation with room to finish.
  async queue(batch: MessageBatch<QueueJob>, env: Env): Promise<void> {
    const { db, close } = createDb(env.HYPERDRIVE.connectionString);
    try {
      for (const msg of batch.messages) {
        const body = msg.body;
        try {
          if ("kind" in body) {
            // TailorJob (the only message kind with a `kind` field).
            await tailorMatchBackground(env, body.principal as Principal, body.matchId);
          } else {
            const { surfaced } = await runCampaignMatch(db, env, body);
            // Business heartbeat: cron-driven surfacing per campaign. A sustained
            // surfaced=0 across all campaigns = matching is dark (dead embedding,
            // index unreachable) — alert on this insight in PostHog.
            await capture(env, "match_run", {
              distinctId: "system:matcher",
              orgId: body.orgId,
              props: { mode: "cron", campaignId: body.campaignId, surfaced },
            });
          }
          msg.ack();
        } catch (err) {
          const id = "kind" in body ? body.matchId : body.campaignId;
          console.error(JSON.stringify({ at: "queue", kind: "kind" in body ? body.kind : "match", id, err: String(err) }));
          Sentry.captureException(err, {
            data: { at: "queue", kind: "kind" in body ? body.kind : "match", id },
          });
          msg.retry();
        }
      }
    } finally {
      await close();
    }
  },
} satisfies ExportedHandler<Env, QueueJob>;

// No-op without SENTRY_DSN (the SDK disables itself when dsn is undefined), so
// local dev and un-keyed deploys behave exactly as before. Explicit generics:
// withSentry can't back-infer Env from the handler, and its default is Sentry's
// own empty env stub.
export default Sentry.withSentry<Env, QueueJob>(
  (env) => ({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? "production",
    // Errors + cron monitors are the point here; keep perf tracing cheap.
    tracesSampleRate: 0.05,
    // Résumés/candidate data must never ride error payloads.
    sendDefaultPii: false,
  }),
  handler,
);
