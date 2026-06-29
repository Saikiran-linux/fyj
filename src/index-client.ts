/**
 * Read-only client for the fyj job index (Supabase Postgres, owned by the
 * `fyj_scanner` repo). This is the ONLY coupling between the two systems. The
 * ops-console never writes the index.
 *
 * Backed by the `search_jobs`/`get_job` RPCs (f-132 / f-114) exposed over HTTPS
 * (PostgREST-style). Keep this contract additive/backward-compatible so the two
 * repos deploy independently.
 */

export interface JobFilters {
  targetOnly?: boolean;
  families?: string[];
  seniority?: string[];
  remote?: boolean;
  compFloor?: number;
  /** ISO timestamp — only jobs first seen after this (incremental matching). */
  since?: string;
  limit?: number;
}

export interface JobMatch {
  jobId: string;
  companyId: string;
  score: number;
}

/**
 * A candidate row from search_jobs_hybrid (f-149): a JobMatch enriched with the
 * text + structured fields the Worker needs to (a) rerank on text via Voyage and
 * (b) score the soft comp/seniority signals — WITHOUT N get_job round-trips.
 * `score` is the RRF fusion score; `cosine` is the dense similarity (display +
 * tie-break). dense_rank/lexical_rank are null when a row came from only one arm.
 */
export interface HybridCandidate {
  jobId: string;
  companyId: string;
  score: number; // RRF
  cosine: number;
  denseRank: number | null;
  lexicalRank: number | null;
  title: string | null;
  descriptionSummary: string | null;
  seniority: string | null;
  remote: string | null;
  compMin: number | null;
  compMax: number | null;
  compCurrency: string | null;
  compInterval: string | null;
  compText: string | null;
}

export interface JobDetail {
  jobId: string;
  companyId: string;
  title: string;
  company: string;
  location: string | null;
  url: string | null;
  description: string | null;
  // f-139 display enrichment (additive; null on older index builds that predate
  // the get_job extension, so the Worker degrades gracefully).
  workplace: string | null; // "remote" | "hybrid" | …
  employmentType: string | null;
  source: string | null; // ATS provider: greenhouse | ashby | lever | …
  postedAt: string | null;
  compMin: number | null;
  compMax: number | null;
  compCurrency: string | null;
  compInterval: string | null;
  compText: string | null;
}

/** A ranked job hydrated with its display detail. What the Jobs UI renders. */
export interface JobHit extends JobDetail {
  score: number;
  rank: number;
}

function headers(env: Env): HeadersInit {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${env.FYJ_INDEX_KEY}`,
    apikey: env.FYJ_INDEX_KEY,
  };
}

// Bound every index round-trip. Without this a slow/unreachable index makes the
// hydration in GET /api/matches hang with no error — the browser then sees the
// matches request stall and the tab spins on "Loading…" forever (looks like
// "no matches"). A timeout turns that into a fast, catchable failure so the
// match still renders (with title/company unhydrated) instead of disappearing.
async function fetchWithTimeout(url: string, init: RequestInit, ms = 8_000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Vector + filter search against the index. Returns ranked job refs. */
export async function searchJobs(
  env: Env,
  embedding: number[],
  filters: JobFilters,
): Promise<JobMatch[]> {
  const res = await fetchWithTimeout(`${env.FYJ_INDEX_URL}/rest/v1/rpc/search_jobs`, {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify({ query_vec: embedding, filters }),
  });
  if (!res.ok) {
    throw new Error(`search_jobs ${res.status}: ${await res.text()}`);
  }
  const rows = (await res.json()) as Array<{ job_id: string; company_id: string; score: number }>;
  return rows.map((r) => ({ jobId: r.job_id, companyId: r.company_id, score: r.score }));
}

/**
 * Hybrid (dense + lexical, RRF-fused) retrieval against the index (f-149). Calls
 * the additive search_jobs_hybrid RPC and returns a candidate pool already
 * carrying title/summary/comp/seniority, so the caller can rerank + soft-score
 * locally. `lexicalQuery` is the candidate's skills/keywords (free text); pass
 * null/empty to run dense-only (the RPC simply skips the lexical arm).
 *
 * Kept separate from searchJobs (which stays the lean job_id/score contract used
 * by display/hydration paths). If the index predates this RPC, the POST 404s and
 * the caller's matchProfile falls back to searchJobs — matching never breaks.
 */
export async function searchJobsHybrid(
  env: Env,
  embedding: number[],
  lexicalQuery: string | null,
  filters: JobFilters,
): Promise<HybridCandidate[]> {
  const res = await fetchWithTimeout(`${env.FYJ_INDEX_URL}/rest/v1/rpc/search_jobs_hybrid`, {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify({
      query_vec: embedding,
      lexical_query: lexicalQuery && lexicalQuery.trim() ? lexicalQuery : null,
      filters,
    }),
  });
  if (!res.ok) {
    throw new Error(`search_jobs_hybrid ${res.status}: ${await res.text()}`);
  }
  const rows = (await res.json()) as Array<{
    job_id: string;
    company_id: string;
    score: number;
    cosine: number;
    dense_rank: number | null;
    lexical_rank: number | null;
    title: string | null;
    description_summary: string | null;
    seniority: string | null;
    remote: string | null;
    comp_min: number | null;
    comp_max: number | null;
    comp_currency: string | null;
    comp_interval: string | null;
    comp_text: string | null;
  }>;
  return rows.map((r) => ({
    jobId: r.job_id,
    companyId: r.company_id,
    score: r.score,
    cosine: r.cosine,
    denseRank: r.dense_rank,
    lexicalRank: r.lexical_rank,
    title: r.title,
    descriptionSummary: r.description_summary,
    seniority: r.seniority,
    remote: r.remote,
    compMin: r.comp_min,
    compMax: r.comp_max,
    compCurrency: r.comp_currency,
    compInterval: r.comp_interval,
    compText: r.comp_text,
  }));
}

/** Hydrate one job's detail for display. Cache in KV (JOB_CACHE) by job id. */
export async function getJob(
  env: Env,
  jobId: string,
  companyId: string,
): Promise<JobDetail | null> {
  const cacheKey = `job:${jobId}`;
  const cached = await env.JOB_CACHE.get<JobDetail>(cacheKey, "json");
  if (cached) return cached;

  const res = await fetchWithTimeout(`${env.FYJ_INDEX_URL}/rest/v1/rpc/get_job`, {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify({ p_job_id: jobId, p_company_id: companyId }),
  });
  if (!res.ok) throw new Error(`get_job ${res.status}: ${await res.text()}`);
  const row = (await res.json()) as JobDetail | null;
  if (row) await env.JOB_CACHE.put(cacheKey, JSON.stringify(row), { expirationTtl: 86_400 });
  return row;
}

/**
 * Search the index and hydrate the top hits for display in one call (f-134).
 * search_jobs returns ranked refs; get_job (KV-cached) fills in title/company/
 * url/description. We only hydrate the first `hydrate` hits (parallel) to bound
 * fan-out — the long tail is rarely scrolled and each get_job is a round-trip.
 */
export async function searchAndHydrate(
  env: Env,
  embedding: number[],
  filters: JobFilters,
  hydrate = 25,
): Promise<JobHit[]> {
  const matches = await searchJobs(env, embedding, filters);
  const top = matches.slice(0, hydrate);
  const hits = await Promise.all(
    top.map(async (m, i): Promise<JobHit | null> => {
      const detail = await getJob(env, m.jobId, m.companyId);
      if (!detail) return null;
      return { ...detail, score: m.score, rank: i + 1 };
    }),
  );
  return hits.filter((h): h is JobHit => h !== null);
}
