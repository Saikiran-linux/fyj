"use client";

/**
 * Write — the org résumé library (f-156, ported from prototype dash-write.jsx).
 * Library: create (blank / from candidate), open, duplicate, delete résumé
 * documents (`resume_documents` via /api/resumes). Editor: the shared block
 * canvas (components/resume-editor) with debounced autosave, a rendered
 * preview, and print-to-PDF through the same markdown renderer the tailored
 * drawer uses — so a doc previews and prints exactly like a tailored résumé.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Copy, FileText, Plus, Trash2 } from "lucide-react";
import { BrailleSpinner } from "@/components/primitives";
import { ResumeBlockCanvas } from "@/components/resume-editor";
import { api } from "@/lib/api";
import { resumeHtmlDocument } from "@/lib/resume-render";
import {
  blankDoc,
  docFromCandidate,
  docToMarkdown,
  normalizeDocBody,
} from "@/lib/resume-doc";
import type {
  CandidateExtraction,
  Client,
  ResumeDocBody,
  ResumeDocument,
  ResumeDocumentListRow,
} from "@/lib/types";
import { cn } from "@/lib/utils";

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 45) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24;
  if (d < 7) return `${Math.floor(d)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ---------------- library card ---------------------------------------- */

function DocCard({
  d,
  onOpen,
  onDuplicate,
  onDelete,
}: {
  d: ResumeDocumentListRow;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="group cursor-pointer overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-md"
      onClick={onOpen}
    >
      {/* mini page preview */}
      <div className="relative border-b border-border bg-background px-5 pb-4 pt-5">
        {d.sourceMatchId && (
          <span className="label absolute right-2 top-2 rounded bg-secondary px-1.5 py-0.5 text-[9px]">
            tailored
          </span>
        )}
        <div className="truncate text-center font-heading text-[13px] font-bold">
          {d.clientName ?? d.title}
        </div>
        <div className="mx-auto mb-2 mt-1 h-px w-3/4 bg-border" />
        {["100%", "88%", "94%", "76%", "82%"].map((w, i) => (
          <div
            key={i}
            className="mb-1 h-1 rounded-full bg-secondary"
            style={{ width: w, opacity: 1 - i * 0.13 }}
          />
        ))}
      </div>
      <div className="px-4 py-3">
        <div className="truncate text-sm font-medium">{d.title}</div>
        <div className="truncate text-xs text-muted-foreground">
          {d.clientName ? `${d.clientName} · v${d.version}` : `Org draft · v${d.version}`}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">{timeAgo(d.updatedAt)}</span>
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Duplicate"
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate();
              }}
            >
              <Copy className="size-3.5" />
            </button>
            <button
              className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
              title="Delete"
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`Delete “${d.title}”?`)) onDelete();
              }}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- editor view ------------------------------------------ */

function DocEditor({
  doc,
  onBack,
  onDeleted,
}: {
  doc: ResumeDocument;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const [body, setBody] = useState<ResumeDocBody>(() => normalizeDocBody(doc.bodyJson));
  const [title, setTitle] = useState(doc.title);
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string>(doc.updatedAt);
  const [error, setError] = useState<string | null>(null);
  const first = useRef(true);

  // Debounced autosave — title + body in one PATCH.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSaving(true);
    const t = setTimeout(() => {
      api
        .updateResumeDoc(doc.id, { title: title.trim() || "Untitled résumé", bodyJson: body })
        .then((row) => {
          setSavedAt(row.updatedAt);
          setError(null);
        })
        .catch((e: Error) => setError(e.message))
        .finally(() => setSaving(false));
    }, 800);
    return () => clearTimeout(t);
  }, [doc.id, title, body]);

  const markdown = useMemo(() => docToMarkdown(body), [body]);

  function downloadPdf() {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(resumeHtmlDocument(markdown, { title, autoPrint: true }));
    w.document.close();
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-6">
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm font-medium hover:bg-muted"
        >
          <ChevronLeft className="size-4" /> Library
        </button>
        <input
          value={title}
          spellCheck={false}
          onChange={(e) => setTitle(e.target.value)}
          className="h-9 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 font-heading text-lg font-semibold outline-none focus:border-border"
          aria-label="Résumé title"
        />
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {saving ? (
            <>
              <BrailleSpinner size={11} /> Saving…
            </>
          ) : error ? (
            <span className="text-destructive">Save failed — {error}</span>
          ) : (
            `Saved · ${timeAgo(savedAt)}`
          )}
        </span>
        <div className="flex rounded-md border border-border p-0.5">
          {(["edit", "preview"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                view === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v}
            </button>
          ))}
        </div>
        <button
          onClick={downloadPdf}
          className="rounded-lg border border-border px-2.5 py-1.5 text-sm font-medium hover:bg-muted"
        >
          Download PDF
        </button>
        <button
          onClick={() => {
            if (window.confirm(`Delete “${title}”?`))
              void api.deleteResumeDoc(doc.id).then(onDeleted);
          }}
          className="grid size-8 place-items-center rounded-lg border border-border text-muted-foreground hover:text-destructive"
          title="Delete résumé"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      {view === "preview" ? (
        <iframe
          title="Résumé preview"
          srcDoc={resumeHtmlDocument(markdown, { title })}
          className="h-[75vh] w-full rounded-xl border border-border bg-white"
        />
      ) : (
        <div className="rounded-xl border border-border bg-card px-10 py-8">
          <ResumeBlockCanvas
            blocks={body.blocks}
            onBlocksChange={(next) =>
              setBody((b) => ({ ...b, blocks: typeof next === "function" ? next(b.blocks) : next }))
            }
            meta={body.meta}
            onMetaChange={(meta) => setBody((b) => ({ ...b, meta }))}
          />
        </div>
      )}
    </div>
  );
}

/* ---------------- page -------------------------------------------------- */

export default function WritePage() {
  const [docs, setDocs] = useState<ResumeDocumentListRow[] | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [openDoc, setOpenDoc] = useState<ResumeDocument | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .listResumeDocs()
      .then(setDocs)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => load(), [load]);
  useEffect(() => {
    api.listClients().then(setClients).catch(() => {});
  }, []);

  async function createBlank() {
    setCreating(true);
    try {
      const row = await api.createResumeDoc({ title: "Untitled résumé", bodyJson: blankDoc() });
      setOpenDoc(row);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function createFromCandidate(clientId: string) {
    const c = clients.find((x) => x.id === clientId);
    if (!c) return;
    setCreating(true);
    try {
      // Seed from the candidate's primary track extraction when there is one.
      let candidate: CandidateExtraction | null = null;
      try {
        const profiles = await api.listProfiles(clientId);
        const parsed = profiles[0]?.parsedProfile as { candidate?: CandidateExtraction } | null;
        candidate = parsed?.candidate ?? null;
      } catch {
        /* seed from the client row alone */
      }
      const row = await api.createResumeDoc({
        title: `${c.fullName.split(" ")[0]} — Résumé`,
        clientId,
        bodyJson: docFromCandidate(c.fullName, c.headline, candidate),
      });
      setOpenDoc(row);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function duplicateDoc(id: string) {
    try {
      const src = await api.getResumeDoc(id);
      const row = await api.createResumeDoc({
        title: `${src.title} (copy)`,
        clientId: src.clientId,
        bodyJson: normalizeDocBody(src.bodyJson),
      });
      setOpenDoc(row);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function deleteDoc(id: string) {
    try {
      await api.deleteResumeDoc(id);
      setDocs((ds) => (ds ? ds.filter((d) => d.id !== id) : ds));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (openDoc)
    return (
      <DocEditor
        doc={openDoc}
        onBack={() => {
          setOpenDoc(null);
          load();
        }}
        onDeleted={() => {
          setOpenDoc(null);
          load();
        }}
      />
    );

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="mb-6 flex items-center justify-end gap-4">
        <div className="flex items-center gap-2">
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) void createFromCandidate(e.target.value);
            }}
            disabled={creating}
            className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground"
            aria-label="New résumé from candidate"
          >
            <option value="">From candidate…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}
              </option>
            ))}
          </select>
          <button
            onClick={() => void createBlank()}
            disabled={creating}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-40"
          >
            <Plus className="size-4" /> New résumé
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {error}
        </div>
      )}

      <div className="label mb-3 text-[11px]">
        Your résumés · {docs ? docs.length : <BrailleSpinner size={11} />}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        <button
          onClick={() => void createBlank()}
          disabled={creating}
          className="flex min-h-44 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-40"
        >
          <span className="grid size-10 place-items-center rounded-full border border-border">
            {creating ? <BrailleSpinner /> : <Plus className="size-5" />}
          </span>
          <b className="text-sm font-medium">Blank résumé</b>
          <span className="text-xs">Start from an empty document</span>
        </button>
        {docs?.map((d) => (
          <DocCard
            key={d.id}
            d={d}
            onOpen={() => void api.getResumeDoc(d.id).then(setOpenDoc).catch((e: Error) => setError(e.message))}
            onDuplicate={() => void duplicateDoc(d.id)}
            onDelete={() => void deleteDoc(d.id)}
          />
        ))}
      </div>

      {docs && docs.length === 0 && (
        <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <FileText className="size-4" /> No saved résumés yet — create one, or open a match in the
          tailor workspace and save a version to the library.
        </div>
      )}

    </div>
  );
}
