"use client";

/**
 * Standalone tailor workspace (f-156) — /tailor/[matchId], ported from the
 * prototype's ResumeTailorWorkspace (dash-tailor.jsx, "Editor" direction) onto
 * live data:
 *
 *   · the document is the REAL tailored résumé (reports.full_markdown via
 *     GET /api/matches/:id/resume), parsed into editor blocks;
 *   · Save writes the markdown back with saveTailoredResume — the same store
 *     the drawer, documents tab and (later) send flow read;
 *   · JD coverage ring + requirement list come from the match's real
 *     matched/missing skills; "add" drops the skill into the document;
 *   · Save version snapshots into a linked `resume_documents` row
 *     (sourceMatchId = match) so history survives reloads and shows in /write;
 *   · Diff toggles word-level changes vs the résumé as it was when the page
 *     loaded (the generated version) — not the prototype's fake variants.
 *
 * Deliberate deviations from the prototype (recorded in progress.md): no
 * synthetic variants (one real tailored output + Regenerate), no Editorial/
 * Cockpit alternate layouts, no send flow (messaging lands with f-158).
 */

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ExternalLink, History, RefreshCw, SplitSquareHorizontal, Undo2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Chip } from "@/components/ui/chip";
import { BrailleSpinner, CompanyLogo, FitScore } from "@/components/primitives";
import { ResumeBlockCanvas } from "@/components/resume-editor";
import { api } from "@/lib/api";
import { resumeHtmlDocument } from "@/lib/resume-render";
import {
  baseMapOf,
  docAddSkill,
  docCoverage,
  docFromMarkdown,
  docToMarkdown,
} from "@/lib/resume-doc";
import type { Match, ResumeDocBody, ResumeDocVersion, ResumeDocument } from "@/lib/types";
import { cn } from "@/lib/utils";

const MAX_VERSIONS = 20;

function RingMeter({ pct, size = 68 }: { pct: number; size?: number }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const col = pct >= 85 ? "var(--success)" : pct >= 60 ? "var(--primary)" : "var(--warning)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={`Coverage ${pct}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--secondary)" strokeWidth="6" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={col}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct / 100)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset .4s" }}
      />
      <text
        x="50%"
        y="53%"
        textAnchor="middle"
        dominantBaseline="middle"
        className="tabular-nums"
        style={{ fill: col, fontSize: size * 0.26, fontWeight: 600 }}
      >
        {pct}
      </text>
    </svg>
  );
}

type LoadState = "loading" | "pending" | "ready" | "blocked" | "error";

export default function TailorWorkspacePage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = use(params);

  const [match, setMatch] = useState<Match | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [body, setBody] = useState<ResumeDocBody | null>(null);
  const [baseMap, setBaseMap] = useState<Record<string, string>>({});
  const [seedEpoch, setSeedEpoch] = useState(0);
  const [showDiff, setShowDiff] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [versionFlash, setVersionFlash] = useState(false);
  const [doc, setDoc] = useState<ResumeDocument | null>(null); // linked library row
  const [regenerating, setRegenerating] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---- load match + résumé (poll while tailoring runs) ---- */
  const loadResume = useCallback(
    async (kickIfMissing: boolean) => {
      try {
        const r = await api.getTailoredResume(matchId);
        if (r.status === "ready" && r.markdown) {
          const parsed = docFromMarkdown(r.markdown);
          setBody(parsed);
          setBaseMap(baseMapOf(parsed));
          setSeedEpoch((e) => e + 1);
          setState("ready");
          setRegenerating(false);
          return true;
        }
      } catch {
        /* poll on */
      }
      if (kickIfMissing) {
        try {
          const k = await api.tailorMatch(matchId);
          if (!k.tailoring) {
            setBlockedReason(k.reason ?? null);
            setState("blocked");
            return false;
          }
        } catch {
          /* approve may already have kicked it */
        }
      }
      setState("pending");
      return false;
    },
    [matchId],
  );

  useEffect(() => {
    let cancelled = false;
    api
      .getMatch(matchId)
      .then((m) => !cancelled && setMatch(m))
      .catch(() => !cancelled && setState("error"));
    api
      .listResumeDocs({ matchId })
      .then((rows) => {
        if (cancelled || !rows[0]) return;
        return api.getResumeDoc(rows[0].id).then((d) => !cancelled && setDoc(d));
      })
      .catch(() => {});

    let tries = 0;
    const poll = async () => {
      if (cancelled) return;
      const done = await loadResume(tries === 0);
      if (cancelled || done) return;
      if (++tries < 60) pollTimer.current = setTimeout(poll, 3000);
    };
    void poll();
    return () => {
      cancelled = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [matchId, loadResume]);

  /* ---- derived ---- */
  const cov = useMemo(
    () =>
      body && match
        ? docCoverage(match.matchedSkills ?? [], match.missingSkills ?? [], body)
        : null,
    [body, match],
  );
  const markdown = useMemo(() => (body ? docToMarkdown(body) : ""), [body]);
  const versions: ResumeDocVersion[] = doc?.bodyJson?.versions ?? [];

  /* ---- actions ---- */
  async function save() {
    if (!body) return;
    setSaving(true);
    try {
      await api.saveTailoredResume(matchId, markdown);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } finally {
      setSaving(false);
    }
  }

  async function saveVersion() {
    if (!body || !match) return;
    const version: ResumeDocVersion = {
      at: new Date().toISOString(),
      label: `Version ${versions.length + 1}`,
      markdown,
    };
    const nextBody: ResumeDocBody = {
      meta: body.meta,
      blocks: body.blocks,
      versions: [version, ...versions].slice(0, MAX_VERSIONS),
    };
    try {
      const row = doc
        ? await api.updateResumeDoc(doc.id, { bodyJson: nextBody })
        : await api.createResumeDoc({
            title: `${match.clientName} — ${match.jobTitle ?? "Role"}${match.company ? ` @ ${match.company}` : ""}`,
            clientId: match.clientId,
            sourceMatchId: matchId,
            bodyJson: nextBody,
          });
      setDoc(row);
      setVersionFlash(true);
      setTimeout(() => setVersionFlash(false), 1500);
    } catch {
      /* surfaced by the Save button state staying put */
    }
  }

  function restoreVersion(v: ResumeDocVersion) {
    const parsed = docFromMarkdown(v.markdown);
    setBody(parsed);
    setSeedEpoch((e) => e + 1);
  }

  function regenerate() {
    if (!window.confirm("Regenerate the tailored résumé with AI? Unsaved edits are replaced."))
      return;
    setRegenerating(true);
    setState("pending");
    void api
      .tailorMatch(matchId)
      .catch(() => {})
      .then(() => {
        let tries = 0;
        const poll = async () => {
          const done = await loadResume(false);
          if (!done && ++tries < 60) pollTimer.current = setTimeout(poll, 3000);
        };
        // The queue consumer overwrites the stored markdown; poll for the new one.
        pollTimer.current = setTimeout(poll, 4000);
      });
  }

  function downloadPdf() {
    if (!body) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(
      resumeHtmlDocument(markdown, { title: `${body.meta.name} — résumé`, autoPrint: true }),
    );
    w.document.close();
  }

  /* ---- render ---- */
  return (
    <div className="flex h-[calc(100vh-56px)] min-h-0 flex-col">
      {/* top bar */}
      <header className="flex flex-none items-center gap-3 border-b border-border bg-card px-5 py-2.5">
        <Link
          href={match ? `/clients/${match.clientId}` : "/review"}
          className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm font-medium hover:bg-muted"
        >
          <ChevronLeft className="size-4" /> Back
        </Link>
        {match ? (
          <div className="flex min-w-0 items-center gap-2.5">
            {match.company ? (
              <CompanyLogo company={match.company} size={30} />
            ) : (
              <Avatar name={match.clientName} size={30} />
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">
                {match.jobTitle ?? "Role pending"}
                {match.company && <span className="font-normal text-muted-foreground"> · {match.company}</span>}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                Tailoring {match.clientName}&rsquo;s résumé
              </div>
            </div>
            {match.fitScore != null && <FitScore score={match.fitScore} className="ml-1" />}
            {match.url && (
              <a
                href={match.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-info hover:underline"
              >
                Posting <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        ) : (
          <BrailleSpinner />
        )}
        <span className="flex-1" />
        <button
          onClick={() => setShowDiff((d) => !d)}
          disabled={state !== "ready"}
          title="Show what changed vs the generated résumé"
          className={cn(
            "flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-40",
            showDiff && "bg-accent text-accent-foreground",
          )}
        >
          <SplitSquareHorizontal className="size-4" /> Diff
        </button>
        <button
          onClick={() => void saveVersion()}
          disabled={state !== "ready"}
          className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-40"
        >
          <History className="size-4" /> {versionFlash ? "Version saved!" : "Save version"}
        </button>
        <button
          onClick={downloadPdf}
          disabled={state !== "ready"}
          className="rounded-lg border border-border px-2.5 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-40"
        >
          Download PDF
        </button>
        <button
          onClick={() => void save()}
          disabled={state !== "ready" || saving}
          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-40"
        >
          {saving ? "Saving…" : savedFlash ? "Saved ✓" : "Save"}
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* rail */}
        <aside className="w-72 flex-none overflow-y-auto border-r border-border bg-card/50 px-4 py-4">
          {cov && match ? (
            <>
              <div className="flex items-center gap-3">
                <RingMeter pct={cov.pct} />
                <div>
                  <div className="text-sm">
                    <b className="tabular-nums">{cov.covered}</b>
                    <span className="text-muted-foreground"> / {cov.total} JD reqs</span>
                  </div>
                  <div className="label mt-0.5 text-[10px]">covered in the résumé</div>
                </div>
              </div>

              <div className="label mb-1.5 mt-5 text-[10px]">Why this match</div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {match.rationale ?? "The evaluation pass hasn't produced a rationale yet."}
              </p>

              <div className="label mb-1.5 mt-5 text-[10px]">JD requirements</div>
              <div className="flex flex-col gap-1">
                {cov.map.length === 0 && (
                  <span className="text-xs text-muted-foreground">
                    No skill breakdown on this match yet.
                  </span>
                )}
                {cov.map.map((r) => (
                  <div key={r.skill} className="flex items-center gap-1.5 text-xs">
                    <span
                      className={cn(
                        "size-1.5 flex-none rounded-full",
                        r.hit ? "bg-success" : "bg-warning",
                      )}
                    />
                    <span className={cn("truncate", !r.hit && "text-muted-foreground")}>{r.skill}</span>
                    {!r.hit && (
                      <button
                        className="ml-auto text-[11px] font-medium text-primary hover:underline"
                        onClick={() =>
                          setBody((b) => {
                            if (!b) return b;
                            const nb = docAddSkill(b, r.skill);
                            setSeedEpoch((e) => e + 1);
                            return nb;
                          })
                        }
                      >
                        Add
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {(match.guardrails?.length ?? 0) > 0 && (
                <>
                  <div className="label mb-1.5 mt-5 text-[10px]">Guardrails</div>
                  <div className="flex flex-wrap gap-1">
                    {match.guardrails!.map((g) => (
                      <Chip key={g} tone="warning">
                        ⚠ {g}
                      </Chip>
                    ))}
                  </div>
                </>
              )}

              <div className="label mb-1.5 mt-5 text-[10px]">Generated output</div>
              <button
                onClick={regenerate}
                disabled={state !== "ready" || regenerating}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-40"
              >
                <RefreshCw className={cn("size-3.5", regenerating && "animate-spin")} /> Regenerate with AI
              </button>

              <div className="label mb-1.5 mt-5 text-[10px]">Version history</div>
              {versions.length ? (
                <div className="flex flex-col gap-1.5">
                  {versions.map((v) => (
                    <div
                      key={v.at}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium">{v.label}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {new Date(v.at).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </div>
                      <button
                        className="flex flex-none items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                        onClick={() => restoreVersion(v)}
                      >
                        <Undo2 className="size-3" /> Restore
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Snapshots appear here — hit <b>Save version</b> in the top bar. They also land in
                  the <Link href="/write" className="text-primary hover:underline">Write</Link>{" "}
                  library.
                </p>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <BrailleSpinner /> Loading match…
            </div>
          )}
        </aside>

        {/* editor canvas */}
        <main className="min-w-0 flex-1 overflow-y-auto bg-background px-8 py-6">
          {state === "ready" && body ? (
            <div className="mx-auto max-w-3xl rounded-xl border border-border bg-card px-10 py-8 shadow-sm">
              <ResumeBlockCanvas
                blocks={body.blocks}
                onBlocksChange={(next) =>
                  setBody((b) =>
                    b ? { ...b, blocks: typeof next === "function" ? next(b.blocks) : next } : b,
                  )
                }
                meta={body.meta}
                onMetaChange={(meta) => setBody((b) => (b ? { ...b, meta } : b))}
                seedEpoch={seedEpoch}
                showDiff={showDiff}
                baseMap={baseMap}
                aiContext={{
                  jobTitle: match?.jobTitle ?? undefined,
                  company: match?.company ?? undefined,
                  missingSkills: cov?.map.filter((r) => !r.hit).map((r) => r.skill),
                }}
              />
            </div>
          ) : state === "pending" ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <BrailleSpinner size={18} />
              {regenerating
                ? "Regenerating the tailored résumé…"
                : "Drafting & critiquing the résumé — this can take a minute or two."}
            </div>
          ) : state === "blocked" ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              {blockedReason === "no_resume" ? (
                <p>
                  This candidate has no master résumé yet.
                  <br />
                  Upload one to their campaign (Tracks tab), then reopen this workspace.
                </p>
              ) : blockedReason === "no_ai" ? (
                <p>AI tailoring isn&rsquo;t configured on the server (Anthropic key missing).</p>
              ) : (
                <p>Tailoring isn&rsquo;t available for this match right now.</p>
              )}
            </div>
          ) : state === "error" ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Couldn&rsquo;t load this match — it may have been removed, or you don&rsquo;t have
              access.
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <BrailleSpinner size={18} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
