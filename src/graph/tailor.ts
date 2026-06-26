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
import { anthropicText, anthropicJson, HAIKU, SONNET, type Seg } from "./llm";

const MAX_ITERATIONS = 2;

interface Critique {
  pass: boolean;
  issues: string[];
}

// One writer system prompt shared by draft + revise (both Sonnet). Keeping it
// identical — and putting the candidate/master/job context first as a single
// cached prefix — lets the revise call read the cache the draft call wrote
// (cache is per-model + prefix-match, so the Sonnet draft warms it for revise).
const WRITER_SYSTEM = `You are an expert résumé writer. You write and revise a tailored résumé for ONE specific job from the candidate's master résumé. Rules:
- Output GitHub-flavored Markdown only (no commentary, no code fences).
- Reorder/emphasize real experience and skills to match the job; surface relevant keywords for ATS.
- NEVER fabricate experience, employers, dates, or skills the master résumé doesn't support.
- Keep it concise and senior-recruiter-ready: header, summary, skills, experience (bulleted, impact-first), education.
- Follow the TASK at the end of the message.`;

const CRITIQUE_SYSTEM = `You are a strict résumé reviewer. Compare a TAILORED résumé against the target JOB and the candidate's MASTER résumé. Reply with ONLY JSON:
{ "pass": boolean, "issues": string[] }
Fail (pass=false) if: it fabricates anything not in the master, misses obvious job-critical keywords the candidate genuinely has, is poorly structured, or is too long. issues = up to 5 concrete, actionable fixes ([] when pass=true).`;

const TailorState = Annotation.Root({
  master: Annotation<string>(),
  jobText: Annotation<string>(),
  candidateSummary: Annotation<string>(),
  draft: Annotation<string>(),
  critique: Annotation<Critique | null>(),
  iterations: Annotation<number>(),
});

// Shared, byte-stable prefix for the writer (draft + revise): candidate + master
// + job, with the cache breakpoint on the last stable block. The per-call TASK
// (which varies) is appended AFTER the breakpoint so it never invalidates the cache.
function writerUser(s: typeof TailorState.State, task: string): Seg[] {
  return [
    `CANDIDATE SUMMARY:\n${s.candidateSummary}`,
    `MASTER RÉSUMÉ:\n${s.master}`,
    { text: `TARGET JOB:\n${s.jobText}`, cache: true },
    `TASK:\n${task}`,
  ];
}

export function buildTailorGraph(env: Env) {
  // Node names must not collide with state-channel names (LangGraph rejects a
  // node called "draft"/"critique" when those are also state attributes), so the
  // nodes are named write/review/revise while the channels stay draft/critique.
  const graph = new StateGraph(TailorState)
    .addNode("write", async (s) => {
      const draft = await anthropicText(env, {
        system: WRITER_SYSTEM,
        user: writerUser(s, "Write the initial tailored résumé now."),
        model: SONNET,
        maxTokens: 4096,
        temperature: 0.2,
      });
      return { draft };
    })
    .addNode("review", async (s) => {
      // Stable prefix for critique = job + master (cache breakpoint); the draft
      // under review varies between iterations, so it goes last, un-cached.
      const critique = await anthropicJson<Critique>(env, {
        system: CRITIQUE_SYSTEM,
        user: [
          `TARGET JOB:\n${s.jobText}`,
          { text: `MASTER RÉSUMÉ:\n${s.master}`, cache: true },
          `TAILORED RÉSUMÉ TO REVIEW:\n${s.draft}`,
        ],
        model: HAIKU,
        maxTokens: 700,
      });
      return { critique };
    })
    .addNode("revise", async (s) => {
      const draft = await anthropicText(env, {
        system: WRITER_SYSTEM,
        user: writerUser(
          s,
          `Revise the current draft to fix these reviewer issues, then output the full improved résumé:\n- ${(s.critique?.issues ?? []).join("\n- ")}\n\nCURRENT DRAFT:\n${s.draft}`,
        ),
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
