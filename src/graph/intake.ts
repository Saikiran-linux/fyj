/**
 * Intake + matching graph (f-141, Phase B). A LangGraph StateGraph that turns a
 * résumé into (a) structured candidate fields used to populate the profile +
 * targeting criteria, and (b) the top ~25 ranked job matches from the index.
 *
 *   START → extract ⇄(retry) → summarize → embed → search → END
 *
 * The LLM extraction is OpenAI gpt-4o-mini (cheap, per the hybrid choice). The
 * summarize/embed steps reuse the existing f-134 pipeline so the résumé vector
 * still lands in the job-posting distribution. Persistence (R2, attachResume,
 * record_campaign_run) happens in the API route around this graph — the graph
 * stays free of tenant/DB side effects.
 */
import { StateGraph, START, END, Annotation } from "@langchain/langgraph/web";
import { summarizeResume } from "../summarize";
import { embedRaw } from "../embeddings";
import { type JobFilters } from "../index-client";
import { matchProfile, type SurfacedMatch } from "../match";
import { openaiJson } from "./llm";

/** One role from the candidate's work history (for the editable Experience section). */
export interface ExperienceEntry {
  title: string | null;
  company: string | null;
  period: string | null; // free-text dates, e.g. "2021 – Present"
  summary: string | null; // 1-2 line impact summary
}

export interface ExtractedCandidate {
  fullName: string | null;
  headline: string | null;
  location: string | null;
  seniority: string | null;
  skills: string[];
  experience: ExperienceEntry[];
  roleFamilies: string[];
  minComp: number | null;
  workplace: string | null; // remote | hybrid | onsite
  targetTitles: string[];
}

// Re-exported from ../match so the intake result and the matcher/api share ONE
// surfaced-match shape (jobId/companyId/score/rank + rerank fitScore/confidence/
// guardrails). The `search` node below produces these via matchProfile().
export type { SurfacedMatch } from "../match";

export interface IntakeResult {
  candidate: ExtractedCandidate | null;
  embedInput: string | null;
  embedding: number[] | null;
  embeddingModel: string | null;
  filters: JobFilters;
  matches: SurfacedMatch[];
}

const EXTRACT_SYSTEM = `You read a candidate's RESUME and extract a structured profile used to source jobs for them. Reply with ONLY a JSON object, no prose, with EXACTLY these keys:
{
  "fullName": string|null,            // the candidate's name if clearly present
  "headline": string,                 // a concise professional headline, e.g. "Senior Backend Engineer · Fintech"
  "location": string|null,            // city/region if stated
  "seniority": string|null,           // one of: intern, junior, mid, senior, staff, principal, lead, manager, director, vp
  "skills": string[],                 // 8-15 strongest concrete skills/technologies
  "experience": [                     // up to 6 most recent roles, most recent first ([] if none)
    {
      "title": string|null,           // job title held
      "company": string|null,         // employer
      "period": string|null,          // dates as written, e.g. "Jan 2021 – Present"
      "summary": string|null          // 1-2 sentences on scope + a concrete impact
    }
  ],
  "roleFamilies": string[],           // 1-3 role families, e.g. ["Backend", "Platform"]
  "minComp": number|null,             // target base comp in USD as a number if stated, else null
  "workplace": string|null,           // remote | hybrid | onsite preference if derivable
  "targetTitles": string[]            // 2-5 canonical job titles to target
}
Base everything ONLY on the resume. Use null / [] when unknown — never invent.`;

const MAX_EXTRACT_ATTEMPTS = 2;

const IntakeState = Annotation.Root({
  resumeText: Annotation<string>(),
  candidate: Annotation<ExtractedCandidate | null>(),
  attempts: Annotation<number>(),
  embedInput: Annotation<string | null>(),
  embedding: Annotation<number[] | null>(),
  embeddingModel: Annotation<string | null>(),
  filters: Annotation<JobFilters>(),
  matches: Annotation<SurfacedMatch[]>(),
});

/** Defensive shaping so the UI can always rely on arrays (the model may omit keys). */
function normalizeCandidate(c: ExtractedCandidate | null): ExtractedCandidate | null {
  if (!c) return c;
  const experience = Array.isArray(c.experience)
    ? c.experience
        .filter((e) => e && (e.title || e.company || e.summary))
        .slice(0, 8)
        .map((e) => ({
          title: e.title ?? null,
          company: e.company ?? null,
          period: e.period ?? null,
          summary: e.summary ?? null,
        }))
    : [];
  return {
    ...c,
    skills: Array.isArray(c.skills) ? c.skills : [],
    roleFamilies: Array.isArray(c.roleFamilies) ? c.roleFamilies : [],
    targetTitles: Array.isArray(c.targetTitles) ? c.targetTitles : [],
    experience,
  };
}

function toFilters(candidate: ExtractedCandidate | null): JobFilters {
  // NOTE: deliberately NO `families` OR `seniority` — the index uses controlled
  // vocabularies for both that our free-text extracted values don't match, which
  // zeroes the search (verified live: a "mid" seniority filter returned 0 hits
  // where dropping it returned 25). Embedding similarity carries role + seniority
  // fit; only genuinely index-safe structured filters go through here.
  const f: JobFilters = { targetOnly: true };
  if (candidate?.workplace === "remote") f.remote = true;
  if (typeof candidate?.minComp === "number" && candidate.minComp > 0) f.compFloor = candidate.minComp;
  return f;
}

export function buildIntakeGraph(env: Env, hydrate = 25) {
  const graph = new StateGraph(IntakeState)
    .addNode("extract", async (s) => {
      try {
        const candidate = await openaiJson<ExtractedCandidate>(env, {
          system: EXTRACT_SYSTEM,
          user: s.resumeText.slice(0, 12_000),
          maxTokens: 1500, // room for the experience array
        });
        return { candidate: normalizeCandidate(candidate), filters: toFilters(candidate) };
      } catch {
        return { attempts: (s.attempts ?? 0) + 1 };
      }
    })
    .addNode("summarize", async (s) => {
      const summary = await summarizeResume(env, s.resumeText);
      return { embedInput: summary.embedInput };
    })
    .addNode("embed", async (s) => {
      const { embedding, model } = await embedRaw(env, s.embedInput ?? s.resumeText);
      return { embedding, embeddingModel: model };
    })
    .addNode("search", async (s) => {
      if (!s.embedding) return { matches: [] };
      // Full pipeline (hybrid retrieve → Voyage rerank → soft adjust). We have the
      // skills + precis + seniority in hand here, so feed them straight in; the
      // rerank query is the JD-style precis (what the index summaries look like).
      const matches = await matchProfile(env, {
        embedding: s.embedding,
        queryText: s.embedInput ?? s.resumeText,
        lexicalQuery: (s.candidate?.skills ?? []).join(", ") || null,
        filters: s.filters ?? { targetOnly: true },
        profileSeniority: s.candidate?.seniority ?? null,
        topK: hydrate,
      });
      return { matches };
    })
    .addEdge(START, "extract")
    .addConditionalEdges("extract", (s) =>
      s.candidate || (s.attempts ?? 0) >= MAX_EXTRACT_ATTEMPTS ? "summarize" : "extract",
    )
    .addEdge("summarize", "embed")
    .addEdge("embed", "search")
    .addEdge("search", END);
  return graph.compile();
}

export async function runIntake(env: Env, resumeText: string): Promise<IntakeResult> {
  const app = buildIntakeGraph(env);
  const out = await app.invoke({
    resumeText,
    candidate: null,
    attempts: 0,
    embedInput: null,
    embedding: null,
    embeddingModel: null,
    filters: { targetOnly: true },
    matches: [],
  });
  return {
    candidate: out.candidate,
    embedInput: out.embedInput,
    embedding: out.embedding,
    embeddingModel: out.embeddingModel,
    filters: out.filters,
    matches: out.matches,
  };
}
