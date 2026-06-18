import { extractText, getDocumentProxy } from "unpdf";
import { unzipSync, strFromU8 } from "fflate";

/**
 * Resume parsing (f-134): bytes → plain text → a small structured `parsedProfile`.
 * Runs inside the Worker (no native deps): `unpdf` is a Workers-friendly pdf.js
 * build for PDFs; DOCX is just a zip, so `fflate` unzips it and we pull text out
 * of word/document.xml. Plain text/markdown is decoded as-is.
 *
 * This is best-effort extraction, NOT a full resume parser — its job is to feed
 * the embedder (src/embeddings.ts) and give the UI a few quick facts. The deep
 * A–G evaluation (f-136) is where real structured parsing happens.
 */

export type ResumeKind = "pdf" | "docx" | "text";

export interface ParsedResume {
  text: string;
  kind: ResumeKind;
  profile: ParsedProfile;
}

export interface ParsedProfile {
  email: string | null;
  phone: string | null;
  links: string[];
  // First non-empty line is, by overwhelming convention, the candidate's name.
  nameGuess: string | null;
  charCount: number;
}

export function detectKind(filename: string, contentType: string | null): ResumeKind {
  const name = filename.toLowerCase();
  if (name.endsWith(".pdf") || contentType === "application/pdf") return "pdf";
  if (
    name.endsWith(".docx") ||
    contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  return "text";
}

export async function parseResume(
  bytes: Uint8Array,
  filename: string,
  contentType: string | null,
): Promise<ParsedResume> {
  const kind = detectKind(filename, contentType);
  let text: string;
  if (kind === "pdf") text = await extractPdf(bytes);
  else if (kind === "docx") text = extractDocx(bytes);
  else text = strFromU8(bytes);

  text = normalize(text);
  return { text, kind, profile: extractProfile(text) };
}

async function extractPdf(bytes: Uint8Array): Promise<string> {
  // unpdf wants a fresh copy of the buffer; getDocumentProxy detaches it.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

function extractDocx(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const doc = files["word/document.xml"];
  if (!doc) return "";
  const xml = strFromU8(doc);
  // Paragraph + line breaks → newlines, then drop every other tag. Crude but
  // gives clean, embeddable text without a full OOXML parser.
  return xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:br\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractProfile(text: string): ParsedProfile {
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
  const phone =
    text.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0]?.replace(/\s{2,}/g, " ").trim() ?? null;
  const links = Array.from(
    new Set(
      (text.match(/https?:\/\/[^\s)>\]]+/gi) ?? []).map((u) => u.replace(/[.,;]+$/, "")),
    ),
  ).slice(0, 10);
  const firstLine = text.split("\n").map((l) => l.trim()).find(Boolean) ?? null;
  const nameGuess =
    firstLine && firstLine.length <= 60 && !firstLine.includes("@") ? firstLine : null;
  return { email, phone, links, nameGuess, charCount: text.length };
}
