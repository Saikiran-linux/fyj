/**
 * Match-enrichment graph (f-141, Phase C). For one surfaced job, reason over the
 * candidate vs the job posting and produce the rationale + skill breakdown +
 * guardrails the operator sees on a match card. Claude Haiku (cheap) per the
 * hybrid choice. Invoked per-match with bounded concurrency by the background
 * runner in src/api.ts.
 */
import { StateGraph, START, END, Annotation } from "@langchain/langgraph/web";
import type { JobDetail } from "../index-client";
import { anthropicJson, HAIKU } from "./llm";

export interface EnrichResult {
  rationale: string;
  matchedSkills: string[];
  missingSkills: string[];
  guardrails: string[];
}

const ENRICH_SYSTEM = `You are a senior technical recruiter evaluating whether a CANDIDATE fits a specific JOB. Be concise, concrete, and honest — never invent skills the candidate doesn't show. Reply with ONLY a JSON object:
{
  "rationale": string,        // 1-2 sentences on why this is/ isn't a strong fit
  "matchedSkills": string[],  // candidate skills the job explicitly wants (max 8)
  "missingSkills": string[],  // job requirements the candidate appears to lack (max 6)
  "guardrails": string[]      // risks/mismatches to flag: seniority gap, location, comp, visa, domain (max 4; [] if none)
}`;

const EnrichState = Annotation.Root({
  candidateSummary: Annotation<string>(),
  jobText: Annotation<string>(),
  result: Annotation<EnrichResult | null>(),
});

export function buildEnrichGraph(env: Env) {
  const graph = new StateGraph(EnrichState)
    .addNode("evaluate", async (s) => {
      // The candidate profile is identical across all ~25 jobs in a match-run,
      // so mark system+candidate as a cached prefix and vary only the job after
      // it. NOTE: this only actually caches when system+candidate exceeds Haiku's
      // 4096-token minimum (short résumés won't hit it — harmless no-op if so),
      // and the run's bounded fan-out means later calls only read the cache once
      // the first has begun streaming.
      const result = await anthropicJson<EnrichResult>(env, {
        system: ENRICH_SYSTEM,
        user: [
          { text: `CANDIDATE PROFILE:\n${s.candidateSummary}`, cache: true },
          `JOB POSTING:\n${s.jobText}`,
        ],
        model: HAIKU,
        maxTokens: 700,
      });
      return { result };
    })
    .addEdge(START, "evaluate")
    .addEdge("evaluate", END);
  return graph.compile();
}

function jobText(job: JobDetail): string {
  return [
    job.title && `Title: ${job.title}`,
    job.company && `Company: ${job.company}`,
    job.location && `Location: ${job.location}`,
    job.description && `\n${job.description}`,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 8_000);
}

export async function enrichOne(
  env: Env,
  candidateSummary: string,
  job: JobDetail,
): Promise<EnrichResult> {
  const app = buildEnrichGraph(env);
  const out = await app.invoke({ candidateSummary, jobText: jobText(job), result: null });
  if (!out.result) throw new Error("enrich produced no result");
  return out.result;
}
