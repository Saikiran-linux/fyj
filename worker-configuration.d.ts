// Placeholder bindings type. REGENERATE with `npm run cf-typegen` (wrangler types)
// after changing wrangler.jsonc — this file is overwritten by that command and is
// the single source of truth for the Worker's Env. Do not hand-edit long-term.
interface Env {
  HYPERDRIVE: Hyperdrive;
  RESUMES: R2Bucket;
  JOB_CACHE: KVNamespace;
  MATCH_QUEUE: Queue<QueueJob>;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  // Shared secret guarding POST /api/seed/org-admin (creates the first org +
  // admin). Set via `wrangler secret put ADMIN_BOOTSTRAP_SECRET`.
  ADMIN_BOOTSTRAP_SECRET: string;
  WEB_ORIGIN: string;
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  // Voyage: embeddings (f-134/f-152, src/embeddings.ts — voyage-4-large, 1024d;
  // HARD dependency, embed() throws without it) + reranker (f-149, src/rerank.ts
  // — NON-FATAL: with VOYAGE_API_KEY absent, or VOYAGE_RERANK_ENABLED=0/false/no,
  // matching keeps the RRF/cosine order instead). Set via
  // `wrangler secret put VOYAGE_API_KEY`; rerank model defaults to rerank-2.5
  // (override with VOYAGE_RERANK_MODEL).
  VOYAGE_API_KEY?: string;
  VOYAGE_RERANK_MODEL?: string;
  VOYAGE_RERANK_ENABLED?: string;
  FYJ_INDEX_URL: string;
  FYJ_INDEX_KEY: string;
}

// Queue message: one continuous-match run for a campaign.
interface MatchJob {
  campaignId: string;
  orgId: string;
}

// Queue message: tailor the master résumé for one approved match. Runs in the
// queue consumer (not request `waitUntil`) because the draft→critique→revise
// chain on a cold cache exceeds the post-response budget and gets cancelled
// before it can save — leaving the résumé stuck "pending" (f-147 live finding).
interface TailorJob {
  kind: "tailor";
  matchId: string;
  // The resolved request principal, captured server-side at enqueue time (never
  // from client input) so the consumer can run the RLS-scoped repo writes.
  principal: {
    principal: "staff" | "client";
    userId: string;
    orgId: string;
    role?: "admin" | "operator" | "viewer";
    clientId?: string;
  };
}

type QueueJob = MatchJob | TailorJob;
