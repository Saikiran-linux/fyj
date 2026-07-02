/**
 * Resume → JD-style precis, then assemble the SAME embed input the fyj index
 * builds for jobs — so the resume vector lands in the job-posting distribution
 * and pgvector cosine search is symmetric. This mirrors three things in the
 * sibling fyj_scanner repo:
 *   - src/summarize.mjs  — gpt-4o-mini extracts a fixed 14-field labeled precis.
 *   - src/embeddings.mjs buildJobText() — title + a `Key: value` signal block,
 *     then the summary, joined with blank lines, embedded verbatim.
 *   - scripts/embed-resume.mjs — the manual proof that a resume rendered in that
 *     exact shape matches jobs.embedding.
 *
 * We do it in ONE gpt-4o-mini call that emits a Title line plus the 14 fields,
 * then build `title \n\n signals \n\n summary` for embedRaw(). Why summarize at
 * all (vs. embedding the raw resume): jobs are embedded from their summary, not
 * their raw description — embedding raw resume prose would sit in a different
 * region of the space and rank worse.
 */

import { openaiChatUrl, aiGatewayHeaders } from "./observability";

export const SUMMARY_MODEL = "gpt-4o-mini";

// gpt-4o-mini context is huge; cap input for predictable cost/latency. Resumes
// are short, but multi-page PDFs with publication lists can run long.
const RESUME_INPUT_CAP = 12_000;
const MAX_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fixed prompt (kept in code, not env) so the same resume deterministically
// produces the same precis. Schema + field order are IDENTICAL to fyj_scanner's
// summarize.mjs SYSTEM_PROMPT, with one added leading `Title:` line (jobs carry
// the title as a column; resumes don't, so we ask for it). The framing describes
// the role the candidate FILLS — that lands the vector near the JD distribution
// rather than the résumé-prose distribution.
const SYSTEM_PROMPT = `You read a candidate's RESUME and produce a structured, search-friendly profile of the role they are best qualified to fill — phrased as a job posting would describe that role, so it can be matched against real postings.
Reply with EXACTLY these labeled lines, in this order, no preamble, no markdown, no blank lines:

Title: <the canonical role title this candidate is qualified for, as it would appear on a job posting>
Role: <one sentence on the candidate's actual day-to-day work>
Level: <intern / junior / mid / senior / staff / principal / lead / manager / director / vp; note IC vs manager track if clear>
Experience: <total years of experience, e.g. "5+ years"; "unknown" if not derivable>
Required skills: <8-15 comma-separated keywords — the candidate's strongest technologies, languages, frameworks, tools, methodologies>
Preferred skills: <comma-separated secondary or familiar skills; "unknown" if none>
Team: <engineering / design / product / data / sales / marketing / operations / finance / legal / etc., plus function focus>
Industry: <domains the candidate has worked in — e.g. fintech, healthcare, dev tools, AI/ML, e-commerce, security>
Company stage: <early-stage startup / scale-up / late-stage / public / enterprise / agency / any>
Location: <candidate's city or region if stated; "remote" if none given>
Remote policy: <remote / hybrid / onsite preference if stated; else "remote">
Compensation: <target comp if the resume states it; "unknown" otherwise>
Benefits: <"unknown" unless explicitly stated>
Visa: <work authorization if stated — e.g. "US work authorization", "needs H1B sponsorship"; "unknown" if absent>
Schedule: <full-time / part-time / contract; default "full-time">

Base every field ONLY on the resume. If a field cannot be determined, write "unknown" — never invent.`;

export interface ResumeSummary {
  /** Canonical role title (the `Title:` line). */
  title: string;
  /** The 14 labeled lines (Role:…Schedule:), verbatim from the model. */
  summary: string;
  /** title + signal block + summary — the exact text to embed (embedRaw). */
  embedInput: string;
}

/**
 * Summarize a resume into the JD-style precis and build its embed input.
 * Throws on hard failure (no key / exhausted retries / unusable output) so the
 * caller can surface it — the resume isn't embedded unless this succeeds.
 */
export async function summarizeResume(env: Env, resumeText: string): Promise<ResumeSummary> {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  const input = resumeText.length > RESUME_INPUT_CAP ? resumeText.slice(0, RESUME_INPUT_CAP) : resumeText;

  let lastErr = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      // Routes via Cloudflare AI Gateway when AI_GATEWAY_URL is set (logs/cost/cache).
      res = await fetch(openaiChatUrl(env), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.OPENAI_API_KEY}`,
          ...aiGatewayHeaders(env),
        },
        body: JSON.stringify({
          model: SUMMARY_MODEL,
          temperature: 0,
          max_tokens: 500,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: input },
          ],
        }),
      });
    } catch (e) {
      lastErr = `fetch ${(e as Error).message}`;
      await sleep(300 * attempt);
      continue;
    }

    if (res.ok) {
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error("summarize: model returned empty content");
      const cleaned = text.replace(/^```[a-z]*\n?|\n?```$/gi, "").trim();
      return assemble(cleaned);
    }

    const body = await res.text();
    // 429 / 5xx are transient — back off and retry; other 4xx are permanent.
    if (res.status === 429 || res.status >= 500) {
      lastErr = `${res.status}: ${body.slice(0, 120)}`;
      await sleep(400 * 2 ** (attempt - 1));
      continue;
    }
    throw new Error(`summarize ${res.status}: ${body.slice(0, 200)}`);
  }
  throw new Error(`summarize: exhausted ${MAX_ATTEMPTS} attempts (${lastErr})`);
}

// Split the model's labeled lines into Title + the 14-field summary, then build
// the signal block exactly the way jobs.buildJobText does (Seniority/Workplace/
// Employment type/Department/Location), sourced from the precis fields.
function assemble(text: string): ResumeSummary {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const fields = new Map<string, string>();
  for (const line of lines) {
    const m = line.match(/^([A-Za-z][A-Za-z ]*?):\s*(.*)$/);
    if (m && m[1] && m[2] !== undefined) fields.set(m[1].toLowerCase(), m[2].trim());
  }

  const title = fields.get("title") || "Candidate profile";
  // Summary = everything the model returned EXCEPT the Title line (jobs embed
  // title separately), preserved verbatim so the labeled structure is intact.
  const summary = lines.filter((l) => !/^title:/i.test(l)).join("\n");

  const signals: string[] = [];
  const seniority = firstWord(fields.get("level"));
  if (seniority) signals.push(`Seniority: ${seniority}`);
  const workplace = firstWord(fields.get("remote policy"));
  if (workplace) signals.push(`Workplace: ${workplace}`);
  const schedule = clean(fields.get("schedule"));
  if (schedule) signals.push(`Employment type: ${schedule}`);
  const team = clean(fields.get("team"));
  if (team) signals.push(`Department: ${team}`);
  const location = clean(fields.get("location"));
  if (location) signals.push(`Location: ${location}`);

  const parts = [title];
  if (signals.length) parts.push(signals.join("\n"));
  if (summary) parts.push(summary);
  return { title, summary, embedInput: parts.join("\n\n") };
}

function clean(v: string | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  return t && t.toLowerCase() !== "unknown" ? t : null;
}

function firstWord(v: string | undefined): string | null {
  const c = clean(v);
  if (!c) return null;
  // "senior (IC track)" → "senior"; "remote, US only" → "remote".
  return c.split(/[\s,(]/)[0] || null;
}
