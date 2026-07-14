/**
 * Résumé block-document model (f-156) — the editable representation behind the
 * /write library and the /tailor workspace, ported from the prototype's
 * PlateKit (dash-tailor.jsx / dash-write.jsx) and adapted to this app's real
 * persistence: blocks round-trip to the SAME markdown conventions the tailor
 * graph emits and lib/resume-render.ts renders (`# Name`, contact paragraph,
 * `## SECTION`, `### Role | Company<TAB>Date`, `- bullet`), so a document can
 * be seeded from a tailored résumé, edited as blocks, and saved back as
 * markdown for preview / PDF / reports.full_markdown without a second format.
 *
 * Everything here is pure string/array work — no DOM — so it's safe to import
 * from server-rendered modules even though it's only ever CALLED client-side.
 */

import type {
  CandidateExtraction,
  ResumeBlock,
  ResumeDocBody,
  ResumeDocMeta,
} from "./types";

let uidCounter = 0;
export function uid(prefix = "b"): string {
  // Counter + random suffix: unique within a session, and never generated
  // during render (only in effects/handlers), so hydration stays stable.
  uidCounter += 1;
  return `${prefix}_${uidCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/* ---------------- inline HTML ↔ markdown ------------------------------ */

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const decodeEntities = (s: string): string =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

/** contentEditable innerHTML → plain text (tags stripped, entities decoded). */
export function htmlToText(html: string): string {
  return decodeEntities((html || "").replace(/<[^>]*>/g, ""))
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** contentEditable innerHTML → markdown inline (bold/italic/code/link kept). */
export function htmlToMdInline(html: string): string {
  let s = html || "";
  s = s.replace(/<br\s*\/?>/gi, " ");
  // Two passes so simple nesting (<strong><em>…</em></strong>) resolves.
  for (let i = 0; i < 2; i++) {
    s = s.replace(/<(strong|b)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi, "**$2**");
    s = s.replace(/<(em|i)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi, "*$2*");
    s = s.replace(/<code(?:\s[^>]*)?>([\s\S]*?)<\/code>/gi, "`$1`");
    s = s.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");
  }
  s = s.replace(/<[^>]*>/g, "");
  return decodeEntities(s).replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

/** markdown inline → safe innerHTML for a contentEditable block. */
export function mdInlineToHtml(md: string): string {
  let s = escapeHtml(md || "");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  return s;
}

/** Plain text → safe innerHTML (used when accepting AI output into a block). */
export function textToHtml(text: string): string {
  return mdInlineToHtml(text);
}

/* ---------------- document seeds -------------------------------------- */

export function blankMeta(): ResumeDocMeta {
  return { name: "Your Name", contact: "City, ST · you@email.com · linkedin.com/in/you" };
}

export function blankDoc(): ResumeDocBody {
  return {
    meta: blankMeta(),
    blocks: [
      { id: uid(), type: "section", html: "Summary" },
      { id: uid(), type: "p", html: "" },
      { id: uid(), type: "section", html: "Experience" },
      { id: uid(), type: "job", data: { title: "Job title", company: "Company", when: "20XX — Present" } },
      { id: uid(), type: "bullet", html: "" },
      { id: uid(), type: "section", html: "Skills" },
      { id: uid(), type: "skills", data: { items: [] } },
      { id: uid(), type: "section", html: "Education" },
      { id: uid(), type: "job", data: { title: "Degree", company: "School", when: "20XX — 20XX" } },
    ],
  };
}

/** Seed a document from a candidate's résumé extraction (parsedProfile.candidate). */
export function docFromCandidate(
  fullName: string,
  headline: string | null,
  candidate: CandidateExtraction | null,
): ResumeDocBody {
  const blocks: ResumeBlock[] = [];
  blocks.push({ id: uid(), type: "section", html: "Summary" });
  blocks.push({ id: uid(), type: "p", html: escapeHtml(headline ?? "") });
  const exp = candidate?.experience ?? [];
  if (exp.length) {
    blocks.push({ id: uid(), type: "section", html: "Experience" });
    for (const e of exp) {
      blocks.push({
        id: uid(),
        type: "job",
        data: { title: e.title ?? "Role", company: e.company ?? "", when: e.period ?? "" },
      });
      if (e.summary) blocks.push({ id: uid(), type: "bullet", html: escapeHtml(e.summary) });
    }
  }
  blocks.push({ id: uid(), type: "section", html: "Skills" });
  blocks.push({ id: uid(), type: "skills", data: { items: (candidate?.skills ?? []).slice(0, 24) } });
  return {
    meta: {
      name: fullName,
      contact: [candidate?.location, headline].filter(Boolean).join(" · ") || "—",
    },
    blocks,
  };
}

/* ---------------- markdown round-trip --------------------------------- */

const DATE_HINT = /\b(?:19|20)\d{2}\b|present/i;

/** Blocks + meta → the markdown dialect lib/resume-render.ts renders. */
export function docToMarkdown(body: ResumeDocBody): string {
  const out: string[] = [];
  out.push(`# ${body.meta.name}`.trim());
  if (body.meta.contact.trim()) out.push(body.meta.contact.trim());
  for (const b of body.blocks) {
    switch (b.type) {
      case "section": {
        const t = htmlToMdInline(b.html);
        if (t) out.push("", `## ${t}`);
        break;
      }
      case "h": {
        const t = htmlToMdInline(b.html);
        if (t) out.push("", `### ${t}`);
        break;
      }
      case "job": {
        const left = [b.data.title.trim(), b.data.company.trim()].filter(Boolean).join(" | ");
        out.push("", `### ${left}${b.data.when.trim() ? `\t${b.data.when.trim()}` : ""}`);
        break;
      }
      case "bullet": {
        const t = htmlToMdInline(b.html);
        if (t) out.push(`- ${t}`);
        break;
      }
      case "p": {
        const t = htmlToMdInline(b.html);
        if (t) out.push("", t);
        break;
      }
      case "divider":
        out.push("", "---");
        break;
      case "skills": {
        if (b.data.items.length) out.push("", b.data.items.join(" · "));
        break;
      }
    }
  }
  // Collapse runs of blank lines the switch above can produce.
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .trimEnd();
}

/** Does a paragraph read as a separator-joined skills list (not prose)? */
function looksLikeSkillList(text: string): string[] | null {
  const parts = text
    .split(/\s*[·•|]\s*|,\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 3 && parts.every((p) => p.length <= 40 && !/[.!?]$/.test(p))) return parts;
  return null;
}

/**
 * Markdown (the tailor graph's dialect) → editor document. Loses nothing the
 * renderer would show: unknown constructs fall back to paragraph blocks.
 */
export function docFromMarkdown(md: string): ResumeDocBody {
  const lines = (md || "").replace(/\r\n/g, "\n").split("\n");
  const meta: ResumeDocMeta = { name: "", contact: "" };
  const blocks: ResumeBlock[] = [];
  let paraBuf: string[] = [];
  let sawName = false;
  let lastSection = "";

  const flushPara = () => {
    if (!paraBuf.length) return;
    const text = paraBuf.join(" ").trim();
    paraBuf = [];
    if (!text) return;
    // The paragraph right under `# Name` is the contact rule, not a block.
    if (sawName && !meta.contact && blocks.length === 0) {
      meta.contact = text;
      return;
    }
    if (/skills?/i.test(lastSection)) {
      const items = looksLikeSkillList(text);
      if (items) {
        blocks.push({ id: uid(), type: "skills", data: { items } });
        return;
      }
    }
    blocks.push({ id: uid(), type: "p", html: mdInlineToHtml(text) });
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^#\s+(.+)$/)) && !sawName) {
      flushPara();
      meta.name = m[1]!.trim();
      sawName = true;
      continue;
    }
    if ((m = line.match(/^##\s+(.+)$/))) {
      flushPara();
      lastSection = m[1]!.trim();
      blocks.push({ id: uid(), type: "section", html: mdInlineToHtml(lastSection) });
      continue;
    }
    if ((m = line.match(/^###\s+(.+)$/))) {
      flushPara();
      const text = m[1]!;
      const split = text.match(/^(.+?)(?:\t+| {2,})([^\t]+)$/);
      if (split && DATE_HINT.test(split[2]!)) {
        const [title, ...rest] = split[1]!.split(" | ");
        blocks.push({
          id: uid(),
          type: "job",
          data: { title: (title ?? "").trim(), company: rest.join(" | ").trim(), when: split[2]!.trim() },
        });
      } else {
        blocks.push({ id: uid(), type: "h", html: mdInlineToHtml(text.trim()) });
      }
      continue;
    }
    if (/^---+$/.test(line)) {
      flushPara();
      blocks.push({ id: uid(), type: "divider" });
      continue;
    }
    if ((m = line.match(/^[-*]\s+(.+)$/))) {
      flushPara();
      blocks.push({ id: uid(), type: "bullet", html: mdInlineToHtml(m[1]!) });
      continue;
    }
    paraBuf.push(line.trim());
  }
  flushPara();
  if (!meta.name) meta.name = "Résumé";
  return { meta, blocks };
}

/* ---------------- derived views --------------------------------------- */

/** All searchable text of a document (coverage checks). */
export function docText(body: ResumeDocBody): string {
  const parts: string[] = [body.meta.name, body.meta.contact];
  for (const b of body.blocks) {
    if (b.type === "section" || b.type === "h" || b.type === "p" || b.type === "bullet")
      parts.push(htmlToText(b.html));
    else if (b.type === "job") parts.push(`${b.data.title} ${b.data.company} ${b.data.when}`);
    else if (b.type === "skills") parts.push(b.data.items.join(" "));
  }
  return parts.join(" ").toLowerCase();
}

export interface CoverageRow {
  skill: string;
  fromBase: boolean; // true = matched skill, false = JD gap
  hit: boolean;
}

export interface Coverage {
  covered: number;
  total: number;
  pct: number;
  map: CoverageRow[];
}

/** Which JD requirements (matched + missing skills) appear in the document. */
export function docCoverage(
  matchedSkills: string[],
  missingSkills: string[],
  body: ResumeDocBody,
): Coverage {
  const hay = docText(body);
  const seen = new Set<string>();
  const map: CoverageRow[] = [];
  for (const [list, fromBase] of [
    [matchedSkills, true],
    [missingSkills, false],
  ] as const) {
    for (const skill of list) {
      const key = skill.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      map.push({ skill, fromBase, hit: hay.includes(key) });
    }
  }
  const covered = map.filter((r) => r.hit).length;
  return {
    covered,
    total: map.length,
    pct: map.length ? Math.round((covered / map.length) * 100) : 100,
    map,
  };
}

/** Add a skill to the document: skills block if present, else the Skills
 *  section's paragraph, else a new Skills section at the end. */
export function docAddSkill(body: ResumeDocBody, skill: string): ResumeDocBody {
  const s = skill.trim();
  if (!s) return body;
  const blocks = body.blocks.map((b) => ({ ...b }));
  const chips = blocks.find((b) => b.type === "skills");
  if (chips && chips.type === "skills") {
    if (!chips.data.items.some((x) => x.toLowerCase() === s.toLowerCase()))
      chips.data = { items: [...chips.data.items, s] };
    return { ...body, blocks };
  }
  const secIdx = blocks.findIndex(
    (b) => b.type === "section" && /skills?/i.test(htmlToText(b.html)),
  );
  if (secIdx >= 0) {
    const next = blocks[secIdx + 1];
    if (next && next.type === "p") {
      const text = htmlToText(next.html);
      if (!text.toLowerCase().includes(s.toLowerCase()))
        next.html = next.html ? `${next.html} · ${escapeHtml(s)}` : escapeHtml(s);
      return { ...body, blocks };
    }
    blocks.splice(secIdx + 1, 0, { id: uid(), type: "skills", data: { items: [s] } });
    return { ...body, blocks };
  }
  blocks.push({ id: uid(), type: "section", html: "Skills" });
  blocks.push({ id: uid(), type: "skills", data: { items: [s] } });
  return { ...body, blocks };
}

/* ---------------- word diff (LCS, from the prototype) ------------------ */

export interface DiffSeg {
  type: "eq" | "add" | "del";
  text: string;
}

export function wordDiff(a: string, b: string): DiffSeg[] {
  const A = (a || "").split(/(\s+)/);
  const B = (b || "").split(/(\s+)/);
  const n = A.length;
  const m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i]![j] = A[i] === B[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: DiffSeg[] = [];
  const push = (type: DiffSeg["type"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      push("eq", B[j]!);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      push("del", A[i]!);
      i++;
    } else {
      push("add", B[j]!);
      j++;
    }
  }
  while (i < n) push("del", A[i++]!);
  while (j < m) push("add", B[j++]!);
  return out;
}

export function changeCount(a: string, b: string): number {
  return wordDiff(a, b).reduce((acc, s) => acc + (s.type !== "eq" && s.text.trim() ? 1 : 0), 0);
}

/** Base text per block id — diff anchor captured when a document is loaded. */
export function baseMapOf(body: ResumeDocBody): Record<string, string> {
  const map: Record<string, string> = {};
  for (const b of body.blocks) {
    if (b.type === "p" || b.type === "bullet") map[b.id] = htmlToText(b.html);
  }
  return map;
}

/** Normalize a bodyJson from the API (may be {} on a legacy/empty row). */
export function normalizeDocBody(raw: Partial<ResumeDocBody> | null | undefined): ResumeDocBody {
  if (raw && Array.isArray(raw.blocks) && raw.meta) {
    return { meta: raw.meta, blocks: raw.blocks, versions: raw.versions ?? [] };
  }
  return blankDoc();
}
