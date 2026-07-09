/**
 * Résumé-tailoring PROMPT LAB (dev tool). A parameterised, non-graph re-run of the
 * production tailor pipeline so an operator can A/B prompts and model combinations
 * from the UI:
 *
 *   planner (optional) → generator → verifier → (issues & iter<MAX ? revise → verifier)
 *
 * Every stage's system prompt AND model are caller-supplied (defaults come from the
 * real production prompts in tailor.ts, so the lab starts from the shipped baseline).
 * Each model call is dispatched by id to Anthropic or OpenAI (runChat), and we
 * return EVERY intermediate artifact + per-call latency + token usage so the UI can
 * show the full trace and estimate cost. This never touches the DB — inputs are
 * pasted text — so it's safe to run without provisioned tenant data.
 *
 * NOTE: unlike production tailoring (which runs on the queue, f-147), the lab runs
 * synchronously inside the request and returns the whole trace at once. Keep the
 * iteration cap small so a run stays within the request budget.
 */
import { runChat, extractJson, emptyUsage, addUsage, HAIKU, SONNET, type LlmUsage } from "./llm";
import {
  WRITER_SYSTEM,
  CRITIQUE_SYSTEM,
  lengthBand,
  lengthBudgetBlock,
  countWords,
} from "./tailor";

// ── Model catalogue offered in the UI ──────────────────────────────────
// Prices are USD per 1M tokens and APPROXIMATE — they drive the lab's cost
// ESTIMATE only, nothing billing-critical. Update here if list prices change;
// the UI reads them straight from this list. Free-text model ids are allowed
// too (the UI has a datalist, not a closed select) — unknown ids just skip the
// cost estimate.
export interface LabModel {
  id: string;
  label: string;
  provider: "anthropic" | "openai";
  inPricePerM: number;
  outPricePerM: number;
}

export const LAB_MODELS: LabModel[] = [
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", provider: "anthropic", inPricePerM: 15, outPricePerM: 75 },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", provider: "anthropic", inPricePerM: 3, outPricePerM: 15 },
  { id: SONNET, label: "Claude Sonnet 4.6 (prod writer)", provider: "anthropic", inPricePerM: 3, outPricePerM: 15 },
  { id: HAIKU, label: "Claude Haiku 4.5 (prod critic)", provider: "anthropic", inPricePerM: 1, outPricePerM: 5 },
  { id: "claude-fable-5", label: "Claude Fable 5", provider: "anthropic", inPricePerM: 1, outPricePerM: 5 },
  { id: "gpt-5.5", label: "GPT-5.5", provider: "openai", inPricePerM: 5, outPricePerM: 30 },
  { id: "gpt-5.5-pro", label: "GPT-5.5 Pro", provider: "openai", inPricePerM: 30, outPricePerM: 180 },
  { id: "gpt-5.4", label: "GPT-5.4", provider: "openai", inPricePerM: 2.5, outPricePerM: 15 },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini", provider: "openai", inPricePerM: 0.75, outPricePerM: 4.5 },
  { id: "gpt-5.4-nano", label: "GPT-5.4 nano", provider: "openai", inPricePerM: 0.2, outPricePerM: 1.25 },
  { id: "gpt-5", label: "GPT-5", provider: "openai", inPricePerM: 1.25, outPricePerM: 10 },
  { id: "gpt-5-mini", label: "GPT-5 mini", provider: "openai", inPricePerM: 0.25, outPricePerM: 2 },
  { id: "gpt-5-nano", label: "GPT-5 nano", provider: "openai", inPricePerM: 0.05, outPricePerM: 0.4 },
  { id: "gpt-4o", label: "GPT-4o", provider: "openai", inPricePerM: 2.5, outPricePerM: 10 },
  { id: "gpt-4o-mini", label: "GPT-4o mini", provider: "openai", inPricePerM: 0.15, outPricePerM: 0.6 },
];

// ── Default planner prompt (production has no planner stage; this is the lab's
// starting point for one). The generator/verifier defaults ARE the shipped
// prompts, imported above. ──────────────────────────────────────────────
export const DEFAULT_PLANNER_SYSTEM = `You are a résumé-tailoring strategist. Given a candidate's MASTER résumé and a target JOB, produce a concise, concrete PLAN that a writer will follow to tailor the résumé — you do NOT write the résumé yourself.

Output plain text with these labelled sections (no preamble, no markdown headers):
JD MUST-HAVES: the 5-8 skills/tools/responsibilities the JD most wants.
MATCHED STRENGTHS: which of those the master genuinely supports, and in which role.
GAPS: JD must-haves the master does NOT support — the writer must NOT fabricate these.
BULLET REWRITES: 3-6 specific moves — name the role and which bullet to rewrite/swap so a JD skill becomes the centre of an accomplishment (action verb + JD tool + outcome).
SKILLS TO BOLD: JD terms (and clear synonyms) present in the résumé that must be bolded.
EMPHASIS / PRUNE: what to lead with and what to demote for THIS job.

Be specific to this candidate and JD. Never invent employers, titles, dates, or metrics.`;

// ── Request / result shapes (mirrored in web/lib/types.ts) ──────────────
export interface LabStageConfig {
  model: string;
  system: string;
}

export interface LabRequest {
  master: string;
  jobText: string;
  candidateSummary: string;
  maxIterations: number;
  /** Output token cap for the generator/revise calls (résumé writer). */
  maxOutputTokens: number;
  /** null = skip the planner stage entirely. */
  planner: LabStageConfig | null;
  generator: LabStageConfig;
  verifier: LabStageConfig;
}

export type LabStageName = "planner" | "generator" | "verifier" | "revise";

export interface LabStep {
  stage: LabStageName;
  iteration: number;
  model: string;
  ms: number;
  output: string;
  usage: LlmUsage;
  /** verifier only */
  pass?: boolean;
  issues?: string[];
  /** set when this stage threw (the run stops after) */
  error?: string;
}

export interface LabResult {
  steps: LabStep[];
  final: string;
  iterations: number;
  totalMs: number;
  usage: LlmUsage;
  /** top-level error if the run aborted mid-stage */
  error?: string;
}

interface Critique {
  pass: boolean;
  issues: string[];
}

const MAX_ALLOWED_ITERATIONS = 3;

function plannerUser(req: LabRequest): string {
  return [
    `CANDIDATE SUMMARY:\n${req.candidateSummary || "(none provided)"}`,
    `MASTER RÉSUMÉ:\n${req.master}`,
    `TARGET JOB:\n${req.jobText}`,
    `TASK:\nProduce the tailoring plan for this candidate and job.`,
  ].join("\n\n");
}

function generatorUser(req: LabRequest, plan: string | null, task: string): string {
  return [
    `CANDIDATE SUMMARY:\n${req.candidateSummary || "(none provided)"}`,
    `MASTER RÉSUMÉ:\n${req.master}`,
    `TARGET JOB:\n${req.jobText}`,
    lengthBudgetBlock(req.master),
    plan ? `TAILORING PLAN (follow this):\n${plan}` : "",
    `TASK:\n${task}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function verifierUser(req: LabRequest, draft: string): string {
  return [
    `TARGET JOB:\n${req.jobText}`,
    `MASTER RÉSUMÉ:\n${req.master}`,
    `TAILORED RÉSUMÉ TO REVIEW:\n${draft}`,
  ].join("\n\n");
}

/**
 * Run the lab pipeline, collecting every step. Resilient by design: a stage that
 * throws is recorded as a step with `error` and the run returns what it has so far
 * (with the best available résumé as `final`) — a testbed should surface failures,
 * not 500.
 */
export async function runTailorLab(env: Env, req: LabRequest): Promise<LabResult> {
  const steps: LabStep[] = [];
  let usage = emptyUsage();
  const t0 = Date.now();
  const maxIterations = Math.max(0, Math.min(MAX_ALLOWED_ITERATIONS, req.maxIterations | 0));
  // Output cap for the writer. Default 8000 (a 4096 default truncated long
  // résumés mid-document); clamp to a sane ceiling. NOTE: for reasoning models
  // (GPT-5/o-series) this budget also covers hidden reasoning tokens, so a long
  // résumé on those may need a higher value.
  const maxOut = Math.max(1000, Math.min(32000, req.maxOutputTokens || 8000));

  const record = (s: LabStep) => {
    steps.push(s);
    usage = addUsage(usage, s.usage);
  };
  const bestDraft = () =>
    [...steps].reverse().find((s) => (s.stage === "generator" || s.stage === "revise") && !s.error)?.output ?? "";

  try {
    // Stage 1 — planner (optional).
    let plan: string | null = null;
    if (req.planner) {
      const t = Date.now();
      const { text, usage: u } = await runChat(env, {
        system: req.planner.system,
        user: plannerUser(req),
        model: req.planner.model,
        maxTokens: 1200,
        temperature: 0,
      });
      plan = text;
      record({ stage: "planner", iteration: 0, model: req.planner.model, ms: Date.now() - t, output: text, usage: u });
    }

    // Stage 2 — generator (initial draft).
    let draft: string;
    {
      const t = Date.now();
      const { text, usage: u } = await runChat(env, {
        system: req.generator.system,
        user: generatorUser(req, plan, "Write the initial tailored résumé now."),
        model: req.generator.model,
        maxTokens: maxOut,
        temperature: 0.2,
      });
      draft = text;
      record({ stage: "generator", iteration: 0, model: req.generator.model, ms: Date.now() - t, output: text, usage: u });
    }

    // Stage 3 — verify → revise loop.
    const { lo, hi } = lengthBand(req.master);
    let iterations = 0;
    for (;;) {
      const t = Date.now();
      const { text, usage: u } = await runChat(env, {
        system: req.verifier.system,
        user: verifierUser(req, draft),
        model: req.verifier.model,
        maxTokens: 900,
        temperature: 0,
        json: true,
      });
      // Tolerate a non-JSON critique — treat an unparseable reply as a pass so the
      // run doesn't wedge on a chatty verifier (the raw text is still shown).
      let critique: Critique;
      try {
        critique = extractJson<Critique>(text);
      } catch {
        critique = { pass: true, issues: [] };
      }
      // Local length gate (no LLM cost), same ±10% band the writer targets — forces
      // a revise on an out-of-range draft even if the verifier missed it.
      const words = countWords(draft);
      let pass = critique.pass !== false;
      let issues = Array.isArray(critique.issues) ? critique.issues : [];
      if (words < lo || words > hi) {
        pass = false;
        const fix =
          words < lo
            ? `${lo - words} words too short — restore cut bullets (rephrased toward the JD), don't just pad.`
            : `${words - hi} words too long — tighten phrasing or drop the weakest off-target bullets.`;
        issues = [`LENGTH OUT OF RANGE: ${words} words, target ${lo}–${hi}. ${fix}`, ...issues].slice(0, 5);
      }
      record({
        stage: "verifier",
        iteration: iterations,
        model: req.verifier.model,
        ms: Date.now() - t,
        output: text,
        usage: u,
        pass,
        issues,
      });

      if (pass || iterations >= maxIterations) break;

      // Revise with the verifier's issues (+ plan, if any).
      iterations++;
      const tr = Date.now();
      const { text: revised, usage: ur } = await runChat(env, {
        system: req.generator.system,
        user: generatorUser(
          req,
          plan,
          `Revise the current draft to fix these reviewer issues, then output the full improved résumé:\n- ${issues.join("\n- ")}\n\nCURRENT DRAFT:\n${draft}`,
        ),
        model: req.generator.model,
        maxTokens: maxOut,
        temperature: 0.2,
      });
      draft = revised;
      record({ stage: "revise", iteration: iterations, model: req.generator.model, ms: Date.now() - tr, output: revised, usage: ur });
    }

    return { steps, final: draft, iterations, totalMs: Date.now() - t0, usage };
  } catch (e) {
    const error = (e as Error).message;
    // Record the failure against the stage that would have run next, for context.
    return { steps, final: bestDraft(), iterations: 0, totalMs: Date.now() - t0, usage, error };
  }
}

// ── Defaults + a runnable sample so the UI works with zero live infra ───
export function labDefaults() {
  return {
    plannerEnabled: false,
    planner: { model: HAIKU, system: DEFAULT_PLANNER_SYSTEM },
    generator: { model: SONNET, system: WRITER_SYSTEM },
    verifier: { model: HAIKU, system: CRITIQUE_SYSTEM },
    maxIterations: 2,
    maxOutputTokens: 8000,
  };
}

export const LAB_SAMPLE = {
  candidateSummary:
    "Backend-leaning full-stack engineer, ~6 years, Python/TypeScript. Built payment and data-pipeline services at two startups; comfortable owning services end-to-end on AWS.",
  master: `# Alex Rivera
San Francisco, CA | (555) 012-3456 | [alex@example.com](mailto:alex@example.com) | [LinkedIn](https://linkedin.com/in/alexrivera)

## SUMMARY
Full-stack engineer with 6 years building and operating backend services. Ship revenue-critical systems end-to-end and mentor junior engineers.

## SKILLS
**Languages:** Python, TypeScript, Go, SQL
**Backend:** FastAPI, Node.js, PostgreSQL, Redis, REST
**Cloud/Infra:** AWS (ECS, Lambda, RDS), Docker, Terraform, GitHub Actions

## PROFESSIONAL EXPERIENCE
### Senior Software Engineer | PayGrid	Jan 2022 – Present
- Led rebuild of the payments ledger service in Python/FastAPI, cutting reconciliation errors 40%.
- Designed an event-driven refund pipeline on AWS Lambda + SQS handling 2M events/day.
- Mentored 3 engineers and introduced trunk-based CI with GitHub Actions.

### Software Engineer | DataLoop	Jun 2019 – Dec 2021
- Built ingestion APIs in Node.js/TypeScript feeding a 3TB analytics warehouse.
- Cut p95 query latency 55% by adding Redis caching and Postgres partitioning.
- Owned on-call for the ingestion tier; drove incident count down quarter over quarter.

## EDUCATION
### B.S. Computer Science	2015 – 2019
University of California, Davis`,
  jobText: `Senior Backend Engineer — Payments Platform
We're hiring a Senior Backend Engineer to own services on our payments platform. You'll design high-throughput, event-driven systems and partner with product to ship reliably.

Requirements:
- 5+ years building backend services in Python (FastAPI a plus) or Go
- Strong PostgreSQL and event-driven architecture (SQS/Kafka) experience
- Hands-on AWS (Lambda, ECS, RDS) and infrastructure-as-code (Terraform)
- Track record owning payment or financial systems with strong reliability
Nice to have: Kafka, observability (Datadog), mentoring experience.`,
};
