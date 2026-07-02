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
import type { LangsmithTracing } from "../observability";
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
//
// Ported/adapted from the fyj_scanner tailor generator (src/tailor/generator.mjs):
// the same recruiter/ATS-optimised rules PLUS the strict markdown/template
// conventions that web/lib/resume-render.ts depends on to reproduce a classic
// Word/Cambria résumé (centered name + contact rule, ruled section headers,
// right-aligned dates). The renderer is dumb by design, so the CONVENTIONS in
// rule 6 are load-bearing — break them and the preview/PDF falls back to plain.
const WRITER_SYSTEM = `You tailor a candidate's master résumé to ONE specific job description.

RULES (in order of importance):
1. Preserve the factual SCAFFOLD of the master résumé exactly: company names,
   employment dates, job titles, degrees, schools, and existing quantified
   metrics. NEVER change an employer, fabricate a job/certification, invent a
   company, or alter dates or numbers the master claims. This scaffold is what a
   recruiter verifies, so it must stay true.
2. Reorder, rephrase, and re-emphasise to maximise alignment with the JD's
   required + preferred skills and the day-to-day responsibilities it describes.
3. OPTIMISE FOR THE RECRUITER / ATS PICK. The strongest signal is a JD SKILL
   DEMONSTRATED IN AN EXPERIENCE BULLET — a skill that only appears in the Skills
   list reads as weak. So for every key tool/technology/methodology the JD asks
   for AND the master genuinely supports:
     • Add it to the relevant Skills category if missing.
     • Give it a real EXPERIENCE BULLET — prefer rewriting an existing bullet so
       the JD skill becomes the centre of an accomplishment (action verb + JD
       tool + concrete outcome). If no bullet in the most relevant role can host
       it, REPLACE that role's least JD-relevant bullet (swap one-for-one; keep
       the role's bullet count the same).
4. PRUNE what doesn't serve THIS JD. Rewrite, demote, or drop the skills/bullets
   least relevant to the JD to make room for JD-relevant ones — but keep every
   Skills category alive (don't delete whole categories) and keep the shape.
5. Stay PLAUSIBLE. Anchor every JD skill to a real role and real work the master
   shows that role doing — never bolt a tool onto a role where it makes no sense,
   and never invent employers, titles, dates, degrees, or inflated metrics.
6. MARKDOWN + TEMPLATE CONVENTIONS (the renderer depends on these EXACTLY):
   • Output GitHub-flavored Markdown ONLY — no commentary, no code fences, no
     "Here is…" preamble. Start directly with the name heading.
   • Line 1: "# Full Name" (single # for the candidate's name).
   • Line 2: the contact line as plain text with " | " separators, e.g.
     Location | Phone | [email](mailto:you@x.com) | [LinkedIn](url) | [GitHub](url).
     Use markdown links [label](url) for anything clickable.
   • Section headers in ALL CAPS with ## — e.g. "## SUMMARY", "## SKILLS",
     "## PROFESSIONAL EXPERIENCE", "## EDUCATION".
   • Role headings split company and date with a TAB character so the renderer
     right-aligns the date:
       "### Job Title | Company<TAB>Month YYYY – Month YYYY"
     where <TAB> is a LITERAL tab character between company and date — not the
     text "<TAB>", not spaces, not a pipe. Education headings follow the same
     pattern, then a plain line for the school/location.
   • Skills lines use a bold "**Category:**" label followed by the entries.
   • No tables, images, horizontal rules, fancy unicode, or nested lists.
7. SCANNABILITY — bold the JD-relevant signal with **markdown bold** so a 6-second
   skim sees the match:
     • In SKILLS, be EXHAUSTIVE: bold EVERY skill/tool the JD names or is a clear
       synonym of, in every category (keep the "**Category:**" label bold as-is).
       A JD skill that is present but left unbolded is a defect.
     • In EXPERIENCE bullets bold ONLY the highest-signal phrases — the JD
       tool/skill and the quantified outcome (~2–3 short bold spans per bullet,
       NEVER a whole bullet). Never wrap a markdown link in bold.
8. LENGTH is MANDATORY. Match the master's word count within ±10% (the TASK gives
   you the target [lo, hi] band and the master's bullet/skill-category counts).
   Preserve the master's bullet COUNT per role and its Skills categories — hit
   the count by SWAPPING/REPHRASING, never by deleting bullets wholesale, padding
   with filler, or silently shrinking a multi-page résumé to one page. Do NOT
   print a word count or any verification note — the résumé markdown is the only
   thing in your reply.

Follow the TASK at the end of the message.`;

const CRITIQUE_SYSTEM = `You are a strict résumé reviewer. Compare a TAILORED résumé against the target JOB and the candidate's MASTER résumé. Reply with ONLY JSON:
{ "pass": boolean, "issues": string[] }
Fail (pass=false) if ANY of these hold:
- Fabrication: it invents an employer, title, date, degree, certification, or metric the master doesn't support.
- Weak ATS coverage: obvious job-critical skills the candidate genuinely has are missing, or sit in the Skills list without a supporting experience bullet.
- Missing bolding: JD skills present in the résumé are not bolded (Skills must bold every JD term/synonym; strong experience phrases should be bolded).
- Broken template conventions: no single-# name line, no contact line, section headers not ALL-CAPS "##", or role/education headings that don't split company and date with a TAB.
- Length off: word count is outside ±10% of the master, or a role lost most of its bullets / the Skills section collapsed.
- Poorly structured or generic for this JD.
issues = up to 5 concrete, actionable fixes (name the section or bullet); [] when pass=true.`;

const TailorState = Annotation.Root({
  master: Annotation<string>(),
  jobText: Annotation<string>(),
  candidateSummary: Annotation<string>(),
  draft: Annotation<string>(),
  critique: Annotation<Critique | null>(),
  iterations: Annotation<number>(),
});

const countWords = (text: string) => (text.match(/\S+/g) || []).length;

/**
 * Length budget derived from the master résumé (ported from the scanner's
 * generator/evaluator). ±10% word band, rounded to the nearest 10, plus the
 * bullet + skill-category counts so the writer can preserve the master's shape
 * rather than silently collapsing it to a one-pager (the most common failure).
 */
function lengthBand(master: string) {
  const sourceWords = countWords(master);
  const lo = Math.max(50, Math.round((sourceWords * 0.9) / 10) * 10);
  const hi = Math.round((sourceWords * 1.1) / 10) * 10;
  const bulletCount = (master.match(/^[\t ]*[-*]\s+/gm) || []).length;
  const skillCategoryCount = (master.match(/^\*\*[^*]+:\*\*/gm) || []).length;
  return { sourceWords, lo, hi, bulletCount, skillCategoryCount };
}

function lengthBudgetBlock(master: string): string {
  const { sourceWords, lo, hi, bulletCount, skillCategoryCount } = lengthBand(master);
  return [
    `LENGTH BUDGET — master is ${sourceWords} words, ${bulletCount} bullets, ${skillCategoryCount} skill categories.`,
    `Produce ${lo}–${hi} words (±10% of the master). Keep ~${bulletCount} bullets total and ${skillCategoryCount} skill categories.`,
    `Drafts under ${lo} or over ${hi} words are rejected — hit the count by swapping/rephrasing, not by deleting bullets or padding.`,
  ].join("\n");
}

// Shared, byte-stable prefix for the writer (draft + revise): candidate + master
// + job, with the cache breakpoint on the last stable block. The per-call TASK
// (which varies) is appended AFTER the breakpoint so it never invalidates the cache.
function writerUser(s: typeof TailorState.State, task: string): Seg[] {
  return [
    `CANDIDATE SUMMARY:\n${s.candidateSummary}`,
    `MASTER RÉSUMÉ:\n${s.master}`,
    { text: `TARGET JOB:\n${s.jobText}`, cache: true },
    `${lengthBudgetBlock(s.master)}\n\nTASK:\n${task}`,
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
      // Local length gate (no LLM cost) — the same ±10% band the writer targets.
      // Computed here so an out-of-range draft is always forced to revise even
      // if the critic missed it (the scanner's evaluator does the same cap).
      const { lo, hi } = lengthBand(s.master);
      const words = countWords(s.draft);
      if (words < lo || words > hi) {
        const fix =
          words < lo
            ? `${lo - words} words too short — restore cut bullets (rephrased toward the JD), don't just pad adjectives.`
            : `${words - hi} words too long — tighten phrasing or drop the weakest off-target bullets.`;
        return {
          critique: {
            pass: false,
            issues: [`LENGTH OUT OF RANGE: ${words} words, target ${lo}–${hi}. ${fix}`, ...(critique.issues ?? [])].slice(0, 5),
          },
        };
      }
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
  // Optional LangSmith handle (src/observability.ts) — traces the graph's
  // write/review/revise nodes. Null (no key configured) = untraced, as before.
  tracing?: LangsmithTracing | null,
): Promise<TailorResult> {
  const app = buildTailorGraph(env);
  const out = await app.invoke(
    {
      master: master.slice(0, 16_000),
      jobText: jobText(job),
      candidateSummary,
      draft: "",
      critique: null,
      iterations: 0,
    },
    tracing
      ? { callbacks: tracing.callbacks, metadata: tracing.metadata, runName: "tailor-resume" }
      : undefined,
  );
  return { markdown: out.draft, iterations: out.iterations ?? 0, model: SONNET };
}
