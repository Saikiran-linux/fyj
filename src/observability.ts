/**
 * Observability seams (PostHog · LangSmith · Cloudflare AI Gateway) — all
 * OPTIONAL and env-gated, mirroring the Voyage pattern (src/rerank.ts): with no
 * key configured every helper is a cheap no-op, so the Worker behaves exactly as
 * before until the corresponding secret is set. Nothing here may ever throw into
 * a request/queue path — telemetry failures are logged and swallowed.
 *
 * Division of labor (why three seams, not one):
 *   • Sentry (src/index.ts / api.ts onError) — errors + cron/queue health.
 *   • PostHog (`capture` below)              — business events: the surfaced →
 *     approved → tailored → placed funnel, keyed to the operator + org group.
 *   • LangSmith (`langsmithTracing` below)   — semantic traces of the LangGraph
 *     runs (intake / tailor): node-level inputs/outputs for prompt debugging.
 *   • AI Gateway (`*Url` helpers below)      — transport-level capture of EVERY
 *     LLM/embedding call (tokens, cost, caching, budgets) with a base-URL swap;
 *     covers the non-graph calls (enrichment, embeddings, summarize) that
 *     LangSmith doesn't see.
 *
 * Per CLAUDE.md, Workers bindings are NOT on process.env — every helper takes
 * `env` explicitly. LangSmith's client is constructed per call site for the same
 * reason (never module-level state derived from a request).
 */

import { Client } from "langsmith";
import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";
import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";

// ── Cloudflare AI Gateway (transport) ───────────────────────────────────
// AI_GATEWAY_URL is the gateway base, e.g.
//   https://gateway.ai.cloudflare.com/v1/<account_id>/fyj
// When unset, calls go straight to the provider — byte-identical behavior.
// AI_GATEWAY_TOKEN is only needed if the gateway has authentication enabled.

const gw = (env: Env) => (env.AI_GATEWAY_URL ?? "").replace(/\/+$/, "");

export function openaiChatUrl(env: Env): string {
  return gw(env) ? `${gw(env)}/openai/chat/completions` : "https://api.openai.com/v1/chat/completions";
}

export function openaiEmbeddingsUrl(env: Env): string {
  return gw(env) ? `${gw(env)}/openai/embeddings` : "https://api.openai.com/v1/embeddings";
}

export function anthropicMessagesUrl(env: Env): string {
  return gw(env) ? `${gw(env)}/anthropic/v1/messages` : "https://api.anthropic.com/v1/messages";
}

/** Extra headers for authenticated gateways ({} when not configured). */
export function aiGatewayHeaders(env: Env): Record<string, string> {
  return env.AI_GATEWAY_URL && env.AI_GATEWAY_TOKEN
    ? { "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}` }
    : {};
}

// ── PostHog (business events) ────────────────────────────────────────────
// Deliberately a bare fetch, not posthog-node: the repo's no-SDK convention
// (src/embeddings.ts) plus posthog-node's batching/timers sit badly in the
// Workers lifecycle. One event = one POST; callers pass the returned promise to
// `ctx.waitUntil` on the request path or `await` it in queue/cron handlers.
//
// PII rule: résumé text, candidate names/emails, and JD bodies NEVER go in
// event properties — ids and counts only. The person is the OPERATOR (userId),
// never the job-seeker; org_id rides as a group so dashboards slice per tenant.

export interface CaptureOpts {
  /** Operator user id, or a "system:*" id for cron/queue events. */
  distinctId: string;
  orgId?: string;
  props?: Record<string, unknown>;
}

export async function capture(env: Env, event: string, opts: CaptureOpts): Promise<void> {
  if (!env.POSTHOG_API_KEY) return;
  const host = (env.POSTHOG_HOST ?? "https://us.i.posthog.com").replace(/\/+$/, "");
  const system = opts.distinctId.startsWith("system:");
  try {
    const res = await fetch(`${host}/capture/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: env.POSTHOG_API_KEY,
        event,
        distinct_id: opts.distinctId,
        timestamp: new Date().toISOString(),
        properties: {
          ...opts.props,
          ...(opts.orgId ? { $groups: { org: opts.orgId } } : {}),
          // Don't materialize person profiles for system actors (cron/queue).
          ...(system ? { $process_person_profile: false } : {}),
        },
      }),
    });
    if (!res.ok) console.warn(`posthog capture ${event}: HTTP ${res.status}`);
  } catch (err) {
    console.warn(`posthog capture ${event} failed: ${String(err)}`);
  }
}

// ── LangSmith (LLM traces) ───────────────────────────────────────────────
// Handle passed into LangGraph `.invoke(input, {callbacks, metadata, runName})`.
// The tracer batches runs; `flush()` MUST be awaited (queue/cron) or handed to
// `ctx.waitUntil` (request path) or traces are dropped when the isolate ends.

export interface LangsmithTracing {
  callbacks: BaseCallbackHandler[];
  metadata: Record<string, unknown>;
  flush: () => Promise<void>;
}

export function langsmithTracing(
  env: Env,
  metadata: Record<string, unknown> = {},
): LangsmithTracing | null {
  if (!env.LANGSMITH_API_KEY) return null;
  try {
    const client = new Client({ apiKey: env.LANGSMITH_API_KEY });
    const tracer = new LangChainTracer({
      client,
      projectName: env.LANGSMITH_PROJECT ?? "fyj-ops-console",
    });
    return {
      callbacks: [tracer],
      metadata,
      flush: async () => {
        try {
          await client.awaitPendingTraceBatches();
        } catch (err) {
          console.warn(`langsmith flush failed: ${String(err)}`);
        }
      },
    };
  } catch (err) {
    console.warn(`langsmith init failed: ${String(err)}`);
    return null;
  }
}
