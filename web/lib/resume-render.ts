/**
 * Dependency-free Markdown → styled HTML renderer for tailored résumés.
 *
 * Ported from fyj_scanner/src/render/html.mjs so the ops-console preview and the
 * print-to-PDF export both reproduce the SAME classic Word/Cambria résumé layout
 * (centered name + contact rule, ALL-CAPS ruled section headers, right-aligned
 * dates) straight from the markdown the tailor graph emits. Because preview and
 * PDF share this one renderer, what the operator reviews is exactly what prints.
 *
 * It supports only the subset the tailor generator is instructed to emit:
 *   # h1   ## h2   ### h3
 *   - bullet  ·  * bullet   (one level deep)
 *   **bold**  *italic*  `code`  [text](url)
 *   role headings that split company/date with a TAB (or 2+ spaces)
 * Anything fancier renders unstyled — by design.
 */

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Inline formatting — runs AFTER escapeHtml so inserted tags aren't escaped.
// Order matters: links first (so the url isn't chewed by * / _), then strong
// before em (else **foo** is eaten by *foo*).
const inline = (s: string): string =>
  s
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");

// Role headings often carry a right-aligned date: `### Role | Company\tJan 2024 – Present`.
// Split on the LAST tab or 2+ space gap; only treat it as a date split when the
// right side looks date-like, so an accidental double space in a title is safe.
const DATE_HINT = /\b(?:19|20)\d{2}\b|present/i;
function renderHeading(tag: "h1" | "h2" | "h3", text: string): string {
  const m = text.match(/^(.+?)(?:\t+| {2,})([^\t]+)$/);
  if (m && DATE_HINT.test(m[2]!)) {
    const left = inline(escapeHtml(m[1]!.trim()));
    const right = inline(escapeHtml(m[2]!.trim()));
    return `<${tag} class="role-row"><span>${left}</span><span class="date">${right}</span></${tag}>`;
  }
  return `<${tag}>${inline(escapeHtml(text))}</${tag}>`;
}

/** Render the résumé markdown to the inner HTML of the `.resume` page. */
export function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let listOpen = false;
  let paraBuf: string[] = [];

  const flushPara = () => {
    if (paraBuf.length) {
      out.push(`<p>${inline(escapeHtml(paraBuf.join(" ")))}</p>`);
      paraBuf = [];
    }
  };
  const closeList = () => {
    if (listOpen) {
      out.push("</ul>");
      listOpen = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      closeList();
      continue;
    }

    let m: RegExpMatchArray | null;
    if ((m = line.match(/^###\s+(.+)$/))) {
      flushPara();
      closeList();
      out.push(renderHeading("h3", m[1]!));
      continue;
    }
    if ((m = line.match(/^##\s+(.+)$/))) {
      flushPara();
      closeList();
      out.push(renderHeading("h2", m[1]!));
      continue;
    }
    if ((m = line.match(/^#\s+(.+)$/))) {
      flushPara();
      closeList();
      out.push(renderHeading("h1", m[1]!));
      continue;
    }
    if (/^---+$/.test(line)) {
      flushPara();
      closeList();
      out.push("<hr>");
      continue;
    }
    if ((m = line.match(/^[-*]\s+(.+)$/))) {
      flushPara();
      if (!listOpen) {
        out.push("<ul>");
        listOpen = true;
      }
      out.push(`<li>${inline(escapeHtml(m[1]!))}</li>`);
      continue;
    }
    paraBuf.push(line.trim());
  }
  flushPara();
  closeList();
  return out.join("\n");
}

// Print-tuned, ATS-safe, single-column CSS that mimics a classic Word/Cambria
// résumé. Kept as a string so the exact same styles apply in the preview iframe
// and the print-to-PDF window. `@page` sets the PDF margins so the export
// matches the on-screen layout.
const RESUME_CSS = `
    :root { --ink:#000; --rule:#000; --link:#0563C1; }
    *, *::before, *::after { box-sizing: border-box; }
    html { font-family: "Cambria", Georgia, "Times New Roman", serif; color: var(--ink); }
    body { margin: 0; background: #fff; }
    .stage { padding: 24px; max-width: 850px; margin: 0 auto; }
    .resume { padding: 0.2in 0.4in; font-size: 9.5pt; line-height: 1.1; color: var(--ink); }
    .resume h1 { font-size: 18pt; margin: 0 0 1px; font-weight: 700; text-align: center; }
    .resume h1 + p { text-align: center; font-size: 9.5pt; margin: 0 0 6px; padding-bottom: 3px; border-bottom: 1px solid var(--rule); }
    .resume h2 { font-size: 10.5pt; text-transform: uppercase; letter-spacing: 0.3px; border-bottom: 1px solid var(--rule); margin: 8px 0 2px; font-weight: 700; }
    .resume h3 { font-size: 10pt; margin: 4px 0 0; font-weight: 700; }
    .resume h3.role-row, .resume h2.role-row, .resume h1.role-row { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
    .resume .date { font-weight: 700; white-space: nowrap; }
    .resume p { margin: 0; }
    .resume ul { margin: 1px 0 4px; padding-left: 16px; list-style: disc; }
    .resume li { margin: 0; padding: 0; break-inside: avoid; page-break-inside: avoid; }
    .resume h2, .resume h3 { break-after: avoid; page-break-after: avoid; }
    .resume strong { font-weight: 700; }
    .resume em { font-style: italic; }
    .resume a { color: var(--link); text-decoration: underline; }
    .resume hr { border: 0; border-top: 1px solid var(--rule); margin: 8px 0; }
    .resume code { font-family: ui-monospace, Consolas, monospace; font-size: 0.9em; background: #f1f3f5; padding: 0 3px; border-radius: 2px; }
    @page { size: Letter; margin: 0.4in 0.5in; }
    @media print { .stage { padding: 0; max-width: none; margin: 0; } .resume { padding: 0; } }
`;

/**
 * Full standalone HTML document for a single résumé — used both as the preview
 * iframe `srcDoc` and as the print-to-PDF window content. `autoPrint` triggers
 * the browser print dialog on load (for the "Download PDF" action).
 */
export function resumeHtmlDocument(
  markdown: string,
  opts: { title?: string; autoPrint?: boolean } = {},
): string {
  const { title = "Résumé", autoPrint = false } = opts;
  const body = mdToHtml(markdown);
  const printScript = autoPrint
    ? "<script>window.onload=function(){setTimeout(function(){window.print()},150)}</script>"
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${RESUME_CSS}</style>
</head>
<body>
  <main class="stage"><article class="resume">${body}</article></main>
  ${printScript}
</body>
</html>`;
}
