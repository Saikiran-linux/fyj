/**
 * Résumé-tailoring graph (f-141, Phase D). The user's draft → critique → revise
 * loop, as a cyclic LangGraph:
 *
 *   START → draft → critique → (issues & iter<MAX ? revise → critique : END)
 *
 * draft/revise use Claude Sonnet (quality); critique uses a separate evaluator
 * (Haiku) that scores the draft against the JD and returns concrete issues. The
 * output is Markdown the operator can edit in-app, then export to PDF client-side.
 */
import { StateGraph, START, END, Annotation } from "@langchain/langgraph/web";
import type { JobDetail } from "../index-client";
import { anthropicText, anthropicJson, HAIKU, SONNET } from "./llm";

const MAX_ITERATIONS = 2;

interface Critique {
  pass: boolean;
  issues: string[];
}

const DRAFT_SYSTEM = `You are an expert résumé writer. Rewrite the candidate's master résumé as a tailored résumé for ONE specific job. Rules:
- Output GitHub-flavored Markdown only (no commentary, no code fences).
- Reorder/emphasize real experience and skills to match the job; surface relevant keywords for ATS.
- NEVER fabricate experience, employers, dates, or skills the master résumé doesn't support.
- Keep it concise and senior-recruiter-ready: header, summary, skills, experience (bulleted, impact-first), education.`;

const CRITIQUE_SYSTEM = `You are a strict résumé reviewer. Compare a TAILORED résumé against the target JOB and the candidate's MASTER résumé. Reply with ONLY JSON:
{ "pass": boolean, "issues": string[] }
Fail (pass=false) if: it fabricates anything not in the master, misses obvious job-critical keywords the candidate genuinely has, is poorly structured, or is too long. issues = up to 5 concrete, actionable fixes ([] when pass=true).`;

const REVISE_SYSTEM = `You are an expert résumé writer revising a tailored résumé to fix specific reviewer issues. Output the full improved résumé as GitHub-flavored Markdown only. NEVER fabricate anything not supported by the master résumé.`;

const TailorState = Annotation.Root({
  master: Annotation<string>(),
  jobText: Annotation<string>(),
  candidateSummary: Annotation<string>(),
  draft: Annotation<string>(),
  critique: Annotation<Critique | null>(),
  iterations: Annotation<number>(),
});

export function buildTailorGraph(env: Env) {
  // Node names must not collide with state-channel names (LangGraph rejects a
  // node called "draft"/"critique" when those are also state attributes), so the
  // nodes are named write/review/revise while the channels stay draft/critique.
  const graph = new StateGraph(TailorState)
    .addNode("write", async (s) => {
      const draft = await anthropicText(env, {
        system: DRAFT_SYSTEM,
        user: `TARGET JOB:\n${s.jobText}\n\nCANDIDATE SUMMARY:\n${s.candidateSummary}\n\nMASTER RÉSUMÉ:\n${s.master}`,
        model: SONNET,
        maxTokens: 4096,
        temperature: 0.2,
      });
      return { draft };
    })
    .addNode("review", async (s) => {
      const critique = await anthropicJson<Critique>(env, {
        system: CRITIQUE_SYSTEM,
        user: `JOB:\n${s.jobText}\n\nMASTER RÉSUMÉ:\n${s.master}\n\nTAILORED RÉSUMÉ:\n${s.draft}`,
        model: HAIKU,
        maxTokens: 700,
      });
      return { critique };
    })
    .addNode("revise", async (s) => {
      const draft = await anthropicText(env, {
        system: REVISE_SYSTEM,
        user: `TARGET JOB:\n${s.jobText}\n\nMASTER RÉSUMÉ:\n${s.master}\n\nCURRENT DRAFT:\n${s.draft}\n\nREVIEWER ISSUES TO FIX:\n- ${(s.critique?.issues ?? []).join("\n- ")}`,
        model: SONNET,
        maxTokens: 4096,
        temperature: 0.2,
      });
      return { draft, iterations: (s.iterations ?? 0) + 1 };
    })
    .addEdge(START, "write")
    .addEdge("write", "review")
    .addConditionalEdges("review", (s) =>
      s.critique && !s.critique.pass && (s.iterations ?? 0) < MAX_ITERATIONS ? "revise" : END,
    )
    .addEdge("revise", "review");
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

export interface TailorResult {
  markdown: string;
  iterations: number;
  model: string;
}

export async function tailorResume(
  env: Env,
  master: string,
  job: JobDetail,
  candidateSummary: string,
): Promise<TailorResult> {
  const app = buildTailorGraph(env);
  const out = await app.invoke({
    master: master.slice(0, 16_000),
    jobText: jobText(job),
    candidateSummary,
    draft: "",
    critique: null,
    iterations: 0,
  });
  return { markdown: out.draft, iterations: out.iterations ?? 0, model: SONNET };
}
