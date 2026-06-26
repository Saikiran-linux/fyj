import { createDb, type Principal } from "./db/client";
import { listActiveCampaignIds, runCampaignMatch } from "./matcher";
import { createApi, tailorMatchBackground } from "./api";

/**
 * Ops Console Worker — three entrypoints:
 *  • fetch     — the API (Hono). Better Auth + tenant-scoped routes (src/api.ts).
 *  • scheduled — hourly cron: enqueue every active campaign for matching (f-135).
 *  • queue     — consume match jobs: pull new index jobs and surface them.
 *
 * Bindings come from the generated `Env` (worker-configuration.d.ts). The DB is
 * reached via Hyperdrive; never store request state in module globals.
 */

const app = createApi();

export default {
  fetch: app.fetch,

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
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
            await runCampaignMatch(db, env, body);
          }
          msg.ack();
        } catch (err) {
          const id = "kind" in body ? body.matchId : body.campaignId;
          console.error(JSON.stringify({ at: "queue", kind: "kind" in body ? body.kind : "match", id, err: String(err) }));
          msg.retry();
        }
      }
    } finally {
      await close();
    }
  },
} satisfies ExportedHandler<Env, QueueJob>;
