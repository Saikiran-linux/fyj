/**
 * Second-stage reranker for profile↔job matching (f-149): Voyage `rerank-2.5`.
 *
 * Dense cosine (and even RRF-fused hybrid) retrieval is strong for recall but a
 * rough proxy for actual fit. A cross-encoder reranker reads the resume and each
 * job's text together and scores true relevance, reordering the shortlist far
 * better — the validated shape in fyj_scanner's bake-off (docs/matching-benchmark
 * + scripts/voyage-vs-openai.mjs, where VOY→2.5 led the two-stage track).
 *
 * The request/response contract here is the one already proven against the live
 * Voyage API in fyj_scanner/scripts/voyage-vs-openai.mjs:
 *   POST https://api.voyageai.com/v1/rerank
 *   { model, query, documents: string[], top_k } → { data: [{ index, relevance_score }] }
 *
 * NON-FATAL by design (mirrors fyj_scanner/src/rerank.mjs): with no VOYAGE_API_KEY,
 * a transport error, a timeout, or an unparseable reply, we return null so the
 * caller keeps its prior (RRF / cosine) order. A degraded match is acceptable; a
 * broken one is not — matching must never hard-depend on Voyage being reachable.
 *
 * Cost: rerank-2.5 is query-time only (never on the index). One call per match run
 * over a ~50-candidate pool of short summaries ≈ a few thousand tokens.
 */

export const DEFAULT_RERANK_MODEL = "rerank-2.5";

const RERANK_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 600;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** On by default when the key is present; VOYAGE_RERANK_ENABLED=0/false/no opts out. */
export function isEnabled(env: Env): boolean {
  if (/^(0|false|no)$/i.test(env.VOYAGE_RERANK_ENABLED ?? "")) return false;
  return Boolean(env.VOYAGE_API_KEY);
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Score how well each document matches the query, 0..1, aligned to input order.
 *
 * Returns an array the SAME length/order as `documents` (so the caller can zip
 * scores back onto its candidates), or `null` when reranking is disabled or the
 * call permanently fails — the signal to keep the pre-rerank order. Retries
 * transient (429 / 5xx / network) errors with backoff.
 */
export async function rerankRelevance(
  env: Env,
  query: string,
  documents: string[],
  opts: { model?: string } = {},
): Promise<number[] | null> {
  if (!isEnabled(env) || !query.trim() || documents.length === 0) return null;

  const model = opts.model || env.VOYAGE_RERANK_MODEL || DEFAULT_RERANK_MODEL;
  // Voyage rejects empty document strings; substitute a single space so indices
  // stay aligned with the caller's candidate array.
  const docs = documents.map((d) => (d && d.trim() ? d : " "));

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetchWithTimeout(
        "https://api.voyageai.com/v1/rerank",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${env.VOYAGE_API_KEY}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ model, query, documents: docs, top_k: docs.length }),
        },
        RERANK_TIMEOUT_MS,
      );
    } catch {
      if (attempt === MAX_ATTEMPTS) return null;
      await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      if (attempt === MAX_ATTEMPTS) return null;
      const retryAfter = Number(res.headers.get("retry-after")) * 1000 || 0;
      await sleep(Math.max(retryAfter, RETRY_BASE_MS * 2 ** (attempt - 1)));
      continue;
    }
    if (!res.ok) return null; // 4xx other than 429 — permanent, don't retry

    const data = (await res.json().catch(() => null)) as {
      data?: Array<{ index: number; relevance_score: number }>;
    } | null;
    if (!data?.data) return null;

    // Voyage may return results out of order (and, with top_k, a subset); map
    // back onto input positions. Unscored positions stay null → caller treats
    // them as "keep prior order, behind scored ones".
    const scores = new Array<number>(docs.length).fill(NaN);
    for (const d of data.data) {
      if (d.index >= 0 && d.index < scores.length && Number.isFinite(d.relevance_score)) {
        scores[d.index] = d.relevance_score;
      }
    }
    // If nothing usable came back, signal failure rather than an all-NaN array.
    return scores.some((s) => Number.isFinite(s)) ? scores : null;
  }
  return null;
}
