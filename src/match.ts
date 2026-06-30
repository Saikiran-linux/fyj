/**
 * Profile↔job match orchestrator (f-149) — the one pipeline behind every place
 * we surface jobs for a profile (résumé intake, on-demand "Find matches", the
 * background campaign matcher):
 *
 *   hybrid retrieve (dense + lexical, RRF)  →  Voyage rerank-2.5  →  soft adjust
 *   (seniority band + comp floor)  →  top-K
 *
 * Why this shape: the scanner's own bake-off ranks raw dense cosine LAST of 10
 * methods; a lexical arm to feed a cross-encoder reranker is the validated win
 * (docs/matching-embedding-assessment.md). Voyage scoring is NON-FATAL — if it's
 * disabled or unreachable, we keep the RRF order, so matching degrades, never
 * breaks.
 *
 * FILTER POLICY (the deliberate part): compFloor / families / seniority are NEVER
 * sent as hard predicates — comp is sparse (a floor drops the majority null-comp
 * jobs) and the seniority/family vocabularies don't match the résumé side (a
 * `mid` filter returned 0 live). They ride the embedding and act here as SOFT
 * signals: a small ranking nudge + a guardrail note, which never excludes a row.
 * Only the minimal safe set reaches the index (targetOnly, opt-in remote, since).
 */

import { searchJobs, searchJobsHybrid, type HybridCandidate, type JobFilters } from "./index-client";
import { rerankRelevance } from "./rerank";

export type Confidence = "high" | "medium" | "low";

export interface SurfacedMatch {
  jobId: string;
  companyId: string;
  /** Retrieval score persisted to campaign_matches.score: RRF (hybrid) or cosine (fallback). */
  score: number;
  rank: number;
  /** 0..100 fit used for ordering + display; from rerank relevance when available, else cosine. */
  fitScore: number;
  /** Calibrated on cosine (stable across rerank on/off) — same 0.82/0.64 bands the DB used. */
  confidence: Confidence;
  /** Soft-signal notes (seniority band / comp floor); [] when nothing fired. */
  guardrails: string[];
}

export interface MatchProfileInput {
  embedding: number[];
  /** Rerank query — the résumé precis (parsed_profile.summary) or résumé text. */
  queryText: string;
  /** Lexical arm query — the candidate's skills/keywords (free text); null = dense-only. */
  lexicalQuery: string | null;
  /** Targeting filters as stored; compFloor/families/seniority are stripped before the index call. */
  filters: JobFilters;
  /** Candidate seniority (intern…vp) for the soft band guardrail; null skips it. */
  profileSeniority?: string | null;
  topK?: number;
}

const DEFAULT_TOPK = 25;

// Cosine confidence bands — identical thresholds to app.record_campaign_run, so
// confidence semantics stay stable whether or not the reranker ran.
function cosineConfidence(cosine: number): Confidence {
  if (cosine >= 0.82) return "high";
  if (cosine >= 0.64) return "medium";
  return "low";
}

// Coarse seniority band shared by both sides. Maps the index's controlled
// vocabulary AND the résumé side's free-text (which emits `mid`, absent from the
// index) onto one ordered scale, so we compare bands — not exact strings (the
// exact-match mismatch is what zeroed the old hard filter).
const SENIORITY_BAND: Record<string, number> = {
  intern: 1, junior: 1, entry: 1, associate: 1,
  mid: 2, midlevel: 2, "mid-level": 2, intermediate: 2,
  senior: 3, staff: 3, principal: 3, lead: 3, manager: 3,
  director: 4, vp: 4, "vice president": 4, exec: 4, executive: 4, "c-level": 4,
};

export function seniorityBand(label: string | null | undefined): number | null {
  if (!label) return null;
  const key = label.trim().toLowerCase();
  const direct = SENIORITY_BAND[key];
  if (direct !== undefined) return direct;
  // First word fallback ("senior (IC track)" → "senior"; "Sr." / "Jr." abbrevs).
  const first = key.split(/[\s,(/]/)[0] ?? "";
  if (/^sr\.?$/.test(first)) return 3;
  if (/^jr\.?$/.test(first)) return 1;
  const byFirst = SENIORITY_BAND[first];
  return byFirst !== undefined ? byFirst : null;
}

/**
 * Soft adjustment: small penalties (relevance is 0..1, so these stay well under a
 * typical fit delta — the reranker dominates) plus human-readable guardrail notes.
 * Comp penalty fires ONLY on a known comp below floor — null comp is never
 * penalised (the whole reason comp is not a hard filter).
 */
function softAdjust(
  c: HybridCandidate,
  profileBand: number | null,
  compFloor: number | null,
): { penalty: number; guardrails: string[] } {
  const guardrails: string[] = [];
  let penalty = 0;

  if (profileBand != null) {
    const jobBand = seniorityBand(c.seniority);
    if (jobBand != null && Math.abs(jobBand - profileBand) >= 2) {
      penalty += 0.05 * (Math.abs(jobBand - profileBand) - 1);
      guardrails.push(
        `seniority gap: role ${c.seniority ?? "?"} vs profile band ${profileBand}`,
      );
    }
  }

  if (compFloor != null && c.compMax != null && c.compMax < compFloor) {
    penalty += 0.05;
    guardrails.push(
      `comp below target: max ${c.compMax}${c.compCurrency ? " " + c.compCurrency : ""} < ${compFloor}`,
    );
  }

  return { penalty, guardrails };
}

/** Strip the soft-signal keys so they can never act as hard predicates. */
function indexFilters(filters: JobFilters, topK: number): JobFilters {
  const { compFloor: _c, families: _f, seniority: _s, ...safe } = filters;
  return {
    ...safe,
    targetOnly: safe.targetOnly ?? true,
    // Pool the reranker sees: ~2× the surface, bounded by the RPC (caps at 200).
    limit: Math.min(Math.max(topK * 2, 50), 200),
  };
}

function rerankDoc(c: HybridCandidate): string {
  return [c.title, c.descriptionSummary].filter(Boolean).join("\n") || (c.title ?? "");
}

export async function matchProfile(env: Env, input: MatchProfileInput): Promise<SurfacedMatch[]> {
  const topK = input.topK ?? DEFAULT_TOPK;
  const compFloor = typeof input.filters.compFloor === "number" ? input.filters.compFloor : null;
  const profileBand = seniorityBand(input.profileSeniority);
  const filters = indexFilters(input.filters, topK);

  // Stage 1 — hybrid retrieval. If the index predates search_jobs_hybrid (404) or
  // the call fails, fall back to dense-only searchJobs and return cosine order
  // (no text → no rerank / soft signals). Matching never breaks.
  let candidates: HybridCandidate[];
  try {
    candidates = await searchJobsHybrid(env, input.embedding, input.lexicalQuery, filters);
  } catch (err) {
    console.warn(`matchProfile: hybrid retrieval failed, falling back to dense (${String(err)})`);
    const hits = await searchJobs(env, input.embedding, filters);
    return hits.slice(0, topK).map((h, i) => ({
      jobId: h.jobId,
      companyId: h.companyId,
      score: h.score,
      rank: i + 1,
      fitScore: Math.max(0, Math.min(100, Math.round(h.score * 100))),
      confidence: cosineConfidence(h.score),
      guardrails: [],
    }));
  }
  if (candidates.length === 0) return [];

  // Stage 2 — rerank the pool on text (non-fatal: null = keep RRF order).
  const relevance = await rerankRelevance(
    env,
    input.queryText,
    candidates.map(rerankDoc),
  );

  // Stage 3 — primary fit (rerank relevance when present, else cosine) minus soft
  // penalties for ordering; keep an unpenalised fitScore for display.
  const scored = candidates.map((c, i) => {
    const reranked = relevance?.[i];
    const primary = typeof reranked === "number" && Number.isFinite(reranked) ? reranked : c.cosine;
    const { penalty, guardrails } = softAdjust(c, profileBand, compFloor);
    return {
      c,
      sortKey: primary - penalty,
      fitScore: Math.max(0, Math.min(100, Math.round(primary * 100))),
      guardrails,
    };
  });

  // Stable sort by adjusted fit desc; tie-break on RRF score so a reranker tie
  // keeps the better-retrieved row first.
  scored.sort((a, b) => b.sortKey - a.sortKey || b.c.score - a.c.score);

  return scored.slice(0, topK).map((s, i) => ({
    jobId: s.c.jobId,
    companyId: s.c.companyId,
    score: s.c.score,
    rank: i + 1,
    fitScore: s.fitScore,
    confidence: cosineConfidence(s.c.cosine),
    guardrails: s.guardrails,
  }));
}
