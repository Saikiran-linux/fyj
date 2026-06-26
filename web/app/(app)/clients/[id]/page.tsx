"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { Chip, statusTone } from "@/components/ui/chip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Pencil, Plus, Trash2, X, Upload } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { CandidateHeatmap } from "@/components/candidate-heatmap";
import { CandidateAgenda, type AgendaItem } from "@/components/candidate-agenda";
import { EditCandidateDialog } from "@/components/edit-candidate-dialog";
import type {
  Client,
  ClientProfile,
  Match,
  ApplicationRow,
  ConsentStatus,
  StaffRole,
  CandidateExtraction,
  ExperienceEntry,
} from "@/lib/types";

function consentTone(consent: ConsentStatus) {
  return consent === "active" ? "success" : consent === "pending" ? "warning" : "danger";
}
function fitTone(score: number | null) {
  if (score == null) return "neutral" as const;
  return score >= 80 ? "success" : score >= 60 ? "warning" : "neutral";
}
function fmtDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

export default function CandidateProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [role, setRole] = useState<StaffRole | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [client, setClient] = useState<Client | null>(null);
  const [profiles, setProfiles] = useState<ClientProfile[] | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [apps, setApps] = useState<ApplicationRow[] | null>(null);
  const [tab, setTab] = useState("overview");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [matching, setMatching] = useState(false);
  const [resumeMatchId, setResumeMatchId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [matchesError, setMatchesError] = useState<string | null>(null);

  const loadProfiles = () => api.listProfiles(id).then(setProfiles);
  // Distinguish "still loading" from "load failed" — a swallowed error left the
  // Matches tab stuck on "Loading…" forever, which reads as "no matches".
  const reloadMatches = () =>
    api
      .listMatches({ candidateId: id })
      .then((m) => {
        setMatches(m);
        setMatchesError(null);
      })
      .catch((e: Error) => setMatchesError(e.message));

  async function findMatches(profileId?: string) {
    const target = profileId
      ? (profiles ?? []).find((p) => p.id === profileId)
      : (profiles ?? []).find((p) => p.embeddedAt);
    if (!target?.embeddedAt) {
      setError("Upload a résumé to a campaign first — matching needs an embedded profile.");
      return;
    }
    setMatching(true);
    setError(null);
    try {
      await api.runMatch(target.id);
      await reloadMatches();
      setTab("matches");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMatching(false);
    }
  }

  useEffect(() => {
    api.getClient(id).then(setClient).catch((e: Error) => setError(e.message));
    loadProfiles().catch(() => {});
    api
      .listMatches({ candidateId: id })
      .then((m) => {
        setMatches(m);
        setMatchesError(null);
      })
      .catch((e: Error) => setMatchesError(e.message));
    api.listClientApplications(id).then(setApps).catch(() => {});
    api
      .me()
      .then((r) => setRole(r.principal.principal === "staff" ? r.principal.role : null))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function removeClient() {
    if (!client) return;
    const ok = window.confirm(
      `Permanently delete "${client.fullName}"?\n\nThis removes the candidate and ALL of their campaigns, matches, placements, and résumés. This cannot be undone.`,
    );
    if (!ok) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteClient(id);
      router.push("/clients");
    } catch (e) {
      setError((e as Error).message);
      setDeleting(false);
    }
  }

  async function toggleStatus() {
    if (!client) return;
    setBusy(true);
    try {
      const next = client.status === "paused" ? "active" : "paused";
      setClient(await api.updateClient(id, { status: next }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function actMatch(m: Match, kind: "approve" | "decline") {
    try {
      if (kind === "approve") {
        await api.approveMatch(m.id);
        setResumeMatchId(m.id); // open the tailored-résumé drawer (tailoring runs in bg)
      } else {
        await api.declineMatch(m.id);
      }
      setMatches((cur) => (cur ? cur.filter((x) => x.id !== m.id) : cur));
      api.listClientApplications(id).then(setApps).catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const activeApps = (apps ?? []).filter((a) => !["rejected", "placed"].includes(a.status));
  const interviews = (apps ?? []).filter((a) => a.status === "interview").length;
  const offers = (apps ?? []).filter((a) => a.status === "offer").length;
  const respondedStages = ["responded", "interview", "offer", "placed"];
  const appliedCount = (apps ?? []).length;
  const respondedCount = (apps ?? []).filter((a) => respondedStages.includes(a.status)).length;
  const responseRate = appliedCount ? Math.round((respondedCount / appliedCount) * 100) : 0;
  const location = (matches ?? []).find((m) => m.location)?.location ?? null;
  const skills = Array.from(
    new Set((matches ?? []).flatMap((m) => m.matchedSkills ?? [])),
  ).slice(0, 10);
  const activity = [
    ...(apps ?? []).map((a) => ({
      ts: a.updatedAt,
      text: `${a.status.replace(/_/g, " ")} — ${a.jobTitle ?? "role"}${a.companyName ? ` @ ${a.companyName}` : ""}`,
    })),
    ...(matches ?? []).map((m) => ({
      ts: m.surfacedAt,
      text: `Match surfaced — ${m.jobTitle ?? "role"}${m.company ? ` @ ${m.company}` : ""}${m.fitScore != null ? ` (fit ${m.fitScore})` : ""}`,
    })),
  ]
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, 20);

  // Heatmap = every dated pipeline signal for this candidate; agenda = the
  // candidate's applications/placements as a time-ordered timeline.
  const heatmapDates = [
    ...(matches ?? []).map((m) => m.surfacedAt),
    ...(apps ?? []).flatMap((a) => [a.appliedAt, a.updatedAt]),
  ].filter((d): d is string => Boolean(d));
  const agendaItems: AgendaItem[] = (apps ?? []).map((a) => ({
    id: a.id,
    date: a.appliedAt ?? a.updatedAt,
    title: a.jobTitle ?? "Role",
    company: a.companyName,
    stage: a.status,
  }));

  // The Overview's Experience/Skills sections read & save to the candidate's
  // primary résumé profile (the embedded one, else the most recent).
  const primaryProfile =
    (profiles ?? []).find((p) => p.embeddedAt) ?? (profiles ?? [])[0] ?? null;
  const canEditProfile = role !== "viewer";
  const onProfileSaved = (updated: ClientProfile) =>
    setProfiles((cur) => (cur ? cur.map((p) => (p.id === updated.id ? updated : p)) : [updated]));

  return (
    <>
      <Topbar title="Candidates" />
      <div className="mx-auto max-w-5xl px-8 pb-16">
        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

        {/* hero: cover band + overlapping avatar */}
        <div className="mb-4 h-28 bg-gradient-to-r from-primary/80 to-primary/40" />
        <div className="-mt-14 mb-6 flex flex-wrap items-end justify-between gap-4 px-1">
          <div className="flex items-end gap-4">
            <div className="rounded-full border-4 border-card bg-card">
              <Avatar name={client?.fullName ?? "?"} size={96} />
            </div>
            <div className="pb-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">
                  {client?.fullName ?? "Candidate"}
                </h1>
                {client && <Chip tone={statusTone(client.status)}>{client.status}</Chip>}
                {client && (
                  <Chip tone={consentTone(client.consentStatus)}>consent: {client.consentStatus}</Chip>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {client?.headline ?? client?.email ?? "—"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 pb-1">
            {client && (
              <Button variant="outline" onClick={() => setEditing(true)} aria-label="Edit profile">
                <Pencil className="mr-1.5 size-3.5" /> Edit profile
              </Button>
            )}
            {client && (
              <Button variant="outline" disabled={busy} onClick={toggleStatus}>
                {client.status === "paused" ? "Resume" : "Pause"}
              </Button>
            )}
            <Button onClick={() => void findMatches()} disabled={matching}>
              {matching ? "Finding…" : "Find matches"}
            </Button>
            {role === "admin" && (
              <Button
                variant="outline"
                disabled={deleting}
                onClick={() => void removeClient()}
                className="border-destructive/40 text-destructive hover:bg-destructive/10"
              >
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            )}
          </div>
        </div>

        {/* meta row */}
        <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 px-1 text-xs text-muted-foreground">
          <span>📍 {location ?? "Location not set"}</span>
          <span>
            🎯 {profiles?.length ?? 0} active campaign{(profiles?.length ?? 0) === 1 ? "" : "s"}
          </span>
          {client && <span>🗓 Added {fmtDate(client.createdAt)}</span>}
        </div>

        {/* skill tags */}
        {skills.length > 0 && (
          <div className="mb-5 flex flex-wrap gap-1.5 px-1">
            {skills.map((s) => (
              <span
                key={s}
                className="border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
              >
                {s}
              </span>
            ))}
          </div>
        )}

        {/* stat row */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="New matches" value={matches?.length ?? 0} />
          <Stat label="In flight" value={activeApps.length} />
          <Stat label="Response rate" value={`${responseRate}%`} />
          <Stat label="Interviews" value={interviews} />
          <Stat label="Offers" value={offers} />
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList variant="line">
            {["overview", "matches", "tracks", "applications", "activity"].map((t) => (
              <TabsTrigger key={t} value={t} className="capitalize">
                {t}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Overview */}
          <TabsContent value="overview" className="pt-4">
            <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <CandidateHeatmap dates={heatmapDates} />
              <CandidateAgenda items={agendaItems} />
            </div>
            <div className="flex flex-col gap-4">
              <ExperienceSection
                profile={primaryProfile}
                canEdit={canEditProfile}
                onSaved={onProfileSaved}
                onUploadClick={() => setTab("tracks")}
              />
              <SkillsSection
                profile={primaryProfile}
                canEdit={canEditProfile}
                onSaved={onProfileSaved}
                onUploadClick={() => setTab("tracks")}
              />
              {client?.notes && (
                <Card className="px-5">
                  <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Notes
                  </div>
                  <p className="text-sm text-muted-foreground">{client.notes}</p>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* Matches */}
          <TabsContent value="matches" className="pt-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                AI-ranked jobs with rationale, matched skills & guardrails. Approve to tailor the résumé.
              </p>
              <Button size="sm" variant="outline" onClick={() => void findMatches()} disabled={matching}>
                {matching ? "Finding…" : "Find matches"}
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {matchesError ? (
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-destructive">Couldn’t load matches: {matchesError}</span>
                  <Button size="sm" variant="outline" onClick={() => void reloadMatches()}>
                    Retry
                  </Button>
                </div>
              ) : matches === null ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : null}
              {!matchesError && matches?.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No matches yet — upload a résumé to a campaign, then “Find matches”.
                </p>
              )}
              {matches?.map((m) => (
                <MatchRow key={m.id} m={m} onAct={actMatch} onResume={() => setResumeMatchId(m.id)} />
              ))}
            </div>
          </TabsContent>

          {/* Tracks / Campaigns */}
          <TabsContent value="tracks" className="pt-4">
            <TracksPanel
              clientId={id}
              profiles={profiles}
              reload={loadProfiles}
              reloadMatches={reloadMatches}
              onFindMatches={findMatches}
              matching={matching}
            />
          </TabsContent>

          {/* Applications */}
          <TabsContent value="applications" className="pt-4">
            <Card className="px-0 py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Role</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apps?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                        No applications yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {apps?.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>{a.jobTitle ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{a.companyName ?? "—"}</TableCell>
                      <TableCell>
                        <Chip tone={statusTone(a.status)}>{a.status.replace(/_/g, " ")}</Chip>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{fmtDate(a.updatedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* Activity */}
          <TabsContent value="activity" className="pt-4">
            <Card className="px-5">
              {activity.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
              <div className="flex flex-col gap-2">
                {activity.map((e, i) => (
                  <div key={i} className="flex items-baseline gap-3 text-sm">
                    <span className="w-20 shrink-0 text-xs text-muted-foreground tabular-nums">
                      {fmtDate(e.ts)}
                    </span>
                    <span className="text-muted-foreground">{e.text}</span>
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
      {resumeMatchId && (
        <TailoredResumeDrawer matchId={resumeMatchId} onClose={() => setResumeMatchId(null)} />
      )}
      {editing && client && (
        <EditCandidateDialog
          client={client}
          profiles={profiles}
          onClose={() => setEditing(false)}
          onSaved={(c) => setClient(c)}
        />
      )}
    </>
  );
}

function MatchRow({
  m,
  onAct,
  onResume,
}: {
  m: Match;
  onAct: (m: Match, kind: "approve" | "decline") => void | Promise<void>;
  onResume: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border bg-card">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-4 p-3 text-left"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs text-muted-foreground">{open ? "▾" : "▸"}</span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {m.jobTitle ?? "Role pending"}
              {m.company ? <span className="text-muted-foreground"> @ {m.company}</span> : null}
            </div>
            {m.location && <div className="truncate text-xs text-muted-foreground">{m.location}</div>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {m.confidence && <Chip tone="info">{m.confidence}</Chip>}
          <Chip tone={fitTone(m.fitScore)}>{m.fitScore ?? "—"} fit</Chip>
        </div>
      </button>

      {open && (
        <div className="border-t border-border px-4 py-3">
          {(m.guardrails ?? []).length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {m.guardrails!.map((g) => (
                <Chip key={g} tone="warning">
                  ⚑ {g}
                </Chip>
              ))}
            </div>
          )}
          {m.rationale && <p className="mb-3 text-sm text-muted-foreground">{m.rationale}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            {(m.matchedSkills ?? []).length > 0 && (
              <div>
                <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Matched skills
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {m.matchedSkills!.map((s) => (
                    <Chip key={s} tone="success">
                      {s}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
            {(m.missingSkills ?? []).length > 0 && (
              <div>
                <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Gaps
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {m.missingSkills!.map((s) => (
                    <Chip key={s} tone="neutral">
                      {s}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void onAct(m, "decline")}>
              Decline
            </Button>
            <Button size="sm" onClick={() => void onAct(m, "approve")}>
              Approve &amp; queue résumé
            </Button>
            <Button size="sm" variant="ghost" onClick={onResume}>
              Tailored résumé
            </Button>
            {m.url && (
              <a
                href={m.url}
                target="_blank"
                rel="noreferrer"
                className="ml-auto text-xs font-medium text-primary hover:underline"
              >
                View job posting →
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Tailored-résumé drawer (f-141). After Approve, the tailoring graph runs in the
 * background; this polls until the Markdown is ready, lets the operator edit +
 * Save, and exports a PDF via the browser's print-to-PDF (no extra deps).
 */
function mdToHtml(md: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");
  for (const ln of lines) {
    const h = /^(#{1,4})\s+(.*)$/.exec(ln);
    const li = /^[-*]\s+(.*)$/.exec(ln);
    if (li) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inline(li[1] ?? "")}</li>`);
      continue;
    }
    if (inList) { out.push("</ul>"); inList = false; }
    if (h) {
      const level = (h[1] ?? "#").length;
      out.push(`<h${level}>${inline(h[2] ?? "")}</h${level}>`);
    } else if (ln.trim() === "") out.push("");
    else out.push(`<p>${inline(ln)}</p>`);
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

function TailoredResumeDrawer({ matchId, onClose }: { matchId: string; onClose: () => void }) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [status, setStatus] = useState<"pending" | "ready" | "timeout" | "blocked">("pending");
  const [reason, setReason] = useState<"no_resume" | "no_ai" | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [retry, setRetry] = useState(0);

  // On open: show an existing résumé if one was already generated; otherwise make
  // sure tailoring is actually RUNNING (the drawer can be opened via "Tailored
  // résumé" without ever approving, in which case nothing kicked it — that silent
  // no-op is what made the button look broken). Then poll. The tailor graph
  // (draft → critique → revise) can take a minute+, so we budget ~3 min at 3s
  // before backing off to a re-checkable "taking longer" state.
  useEffect(() => {
    const MAX_TRIES = 60;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const poll = async () => {
      try {
        const r = await api.getTailoredResume(matchId);
        if (cancelled) return;
        if (r.status === "ready" && r.markdown) {
          setMarkdown(r.markdown);
          setStatus("ready");
          return;
        }
      } catch {
        /* keep polling */
      }
      if (cancelled) return;
      if (++tries < MAX_TRIES) timer = setTimeout(poll, 3000);
      else setStatus("timeout");
    };

    const start = async () => {
      // Already generated? Show it immediately.
      try {
        const r = await api.getTailoredResume(matchId);
        if (cancelled) return;
        if (r.status === "ready" && r.markdown) {
          setMarkdown(r.markdown);
          setStatus("ready");
          return;
        }
      } catch {
        /* fall through */
      }
      if (cancelled) return;
      // Ensure tailoring is running; surface a precise reason if it can't.
      try {
        const k = await api.tailorMatch(matchId);
        if (cancelled) return;
        if (!k.tailoring) {
          setReason(k.reason ?? null);
          setStatus("blocked");
          return;
        }
      } catch {
        /* approve may have already kicked it — poll regardless */
      }
      if (cancelled) return;
      setStatus("pending");
      void poll();
    };

    void start();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [matchId, retry]);

  async function save() {
    if (markdown == null) return;
    setSaving(true);
    setSaved(false);
    try {
      await api.saveTailoredResume(matchId, markdown);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  function downloadPdf() {
    if (markdown == null) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Tailored résumé</title>
      <style>body{font-family:Georgia,serif;max-width:720px;margin:40px auto;padding:0 24px;line-height:1.5;color:#111}
      h1{font-size:24px;margin:0 0 4px} h2{font-size:16px;border-bottom:1px solid #ccc;padding-bottom:2px;margin:18px 0 8px}
      h3{font-size:14px;margin:12px 0 4px} ul{margin:4px 0 8px 18px} p{margin:4px 0}</style></head>
      <body>${mdToHtml(markdown)}<script>window.onload=function(){window.print()}</script></body></html>`);
    w.document.close();
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-2xl flex-col border-l border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <div className="font-heading text-sm font-semibold">Tailored résumé</div>
            <div className="text-xs text-muted-foreground">
              {status === "pending"
                ? "Tailoring in progress…"
                : status === "timeout"
                  ? "Still working — check again in a moment."
                  : status === "blocked"
                    ? "Can’t tailor yet."
                    : "Editable — Save changes, then export PDF."}
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {status === "pending" ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Drafting &amp; critiquing the résumé… this can take up to a minute or two.
            </div>
          ) : status === "blocked" ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
              {reason === "no_resume" ? (
                <p>
                  This candidate has no master résumé yet.
                  <br />
                  Upload a résumé to their campaign (Tracks tab), then reopen this to tailor it.
                </p>
              ) : reason === "no_ai" ? (
                <p>
                  AI résumé tailoring isn’t configured on the server.
                  <br />
                  Set the Anthropic API key on the Worker to enable it.
                </p>
              ) : (
                <p>Tailoring isn’t available for this match right now.</p>
              )}
            </div>
          ) : status === "timeout" ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
              <p>
                Still tailoring — the draft → critique → revise pass can run a little long.
                <br />
                It keeps working in the background; check again in a moment.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  // Re-kick tailoring (idempotent — does NOT change the match
                  // action) in case the first background pass failed, then poll.
                  setStatus("pending");
                  void api.tailorMatch(matchId).catch(() => {});
                  setRetry((r) => r + 1);
                }}
              >
                Regenerate &amp; check again
              </Button>
            </div>
          ) : (
            <textarea
              value={markdown ?? ""}
              onChange={(e) => {
                setMarkdown(e.target.value);
                setSaved(false);
              }}
              className="h-full min-h-[420px] w-full resize-none border border-border bg-background p-3 font-mono text-xs leading-relaxed outline-none"
            />
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-border px-5 py-3">
          <Button size="sm" disabled={status !== "ready" || saving} onClick={() => void save()}>
            {saving ? "Saving…" : saved ? "Saved ✓" : "Save"}
          </Button>
          <Button size="sm" variant="outline" disabled={status !== "ready"} onClick={downloadPdf}>
            Download PDF
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">Markdown</span>
        </div>
      </aside>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card size="sm" className="px-4">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </Card>
  );
}

// ── Overview résumé sections (f-146): editable Experience + Skills, populated
// from the candidate's primary résumé profile (parsed_profile.candidate). ──────
function readCandidate(profile: ClientProfile | null): CandidateExtraction | null {
  const c = (profile?.parsedProfile as { candidate?: CandidateExtraction } | null)?.candidate;
  return c ?? null;
}

const EMPTY_ENTRY: ExperienceEntry = { title: "", company: "", period: "", summary: "" };
const trimOrNull = (v: string | null) => {
  const t = (v ?? "").trim();
  return t ? t : null;
};

function SectionHeader({ title }: { title: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
        From résumé
      </div>
      <h3 className="mt-1 font-heading text-lg tracking-tight">{title}</h3>
    </div>
  );
}

function EmptyExtract({
  onUploadClick,
  kind,
}: {
  onUploadClick: () => void;
  kind: "experience" | "skills";
}) {
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-muted-foreground">
        No résumé yet — upload one and we’ll extract{" "}
        {kind === "experience" ? "work experience" : "skills"} automatically.
      </p>
      <Button variant="outline" size="sm" onClick={onUploadClick}>
        <Upload className="mr-1.5 size-3.5" /> Upload résumé
      </Button>
    </div>
  );
}

function ExperienceSection({
  profile,
  canEdit,
  onSaved,
  onUploadClick,
}: {
  profile: ClientProfile | null;
  canEdit: boolean;
  onSaved: (p: ClientProfile) => void;
  onUploadClick: () => void;
}) {
  const experience = readCandidate(profile)?.experience ?? [];
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<ExperienceEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function startEdit() {
    setRows(experience.length ? experience.map((e) => ({ ...e })) : [{ ...EMPTY_ENTRY }]);
    setErr(null);
    setEditing(true);
  }
  function patchRow(i: number, key: keyof ExperienceEntry, value: string) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  }
  async function save() {
    if (!profile) return;
    setSaving(true);
    setErr(null);
    try {
      const cleaned = rows
        .map((r) => ({
          title: trimOrNull(r.title),
          company: trimOrNull(r.company),
          period: trimOrNull(r.period),
          summary: trimOrNull(r.summary),
        }))
        .filter((r) => r.title || r.company || r.summary);
      const updated = await api.updateProfileExtraction(profile.id, { experience: cleaned });
      onSaved(updated);
      setEditing(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!profile) {
    return (
      <div className="rounded-xl border border-border/60 bg-background/40 p-5">
        <div className="mb-3">
          <SectionHeader title="Experience" />
        </div>
        <EmptyExtract onUploadClick={onUploadClick} kind="experience" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/60 bg-background/40 p-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <SectionHeader title="Experience" />
        {canEdit && !editing && (
          <Button variant="outline" size="sm" onClick={startEdit}>
            <Pencil className="mr-1.5 size-3.5" /> {experience.length ? "Edit" : "Add"}
          </Button>
        )}
      </div>

      {err && <p className="mb-2 text-sm text-destructive">{err}</p>}

      {!editing ? (
        experience.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No experience on file yet.{" "}
            {profile.embeddedAt
              ? "Use Add to enter it manually."
              : "Upload a résumé to extract it automatically."}
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {experience.map((e, i) => (
              <li key={i} className="border-l-2 border-border pl-3">
                <div className="text-sm font-medium text-foreground">
                  {e.title || "Role"}
                  {e.company ? <span className="text-muted-foreground"> · {e.company}</span> : null}
                </div>
                {e.period && <div className="text-xs tabular-nums text-muted-foreground">{e.period}</div>}
                {e.summary && <p className="mt-1 text-sm text-muted-foreground">{e.summary}</p>}
              </li>
            ))}
          </ol>
        )
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r, i) => (
            <div key={i} className="rounded-lg border border-border/60 bg-card/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Role {i + 1}</span>
                <button
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Remove role"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Input
                  placeholder="Title"
                  value={r.title ?? ""}
                  onChange={(e) => patchRow(i, "title", e.target.value)}
                />
                <Input
                  placeholder="Company"
                  value={r.company ?? ""}
                  onChange={(e) => patchRow(i, "company", e.target.value)}
                />
              </div>
              <Input
                className="mt-2"
                placeholder="Period (e.g. 2021 – Present)"
                value={r.period ?? ""}
                onChange={(e) => patchRow(i, "period", e.target.value)}
              />
              <Textarea
                className="mt-2"
                rows={2}
                placeholder="What they did + a concrete impact"
                value={r.summary ?? ""}
                onChange={(e) => patchRow(i, "summary", e.target.value)}
              />
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRows((rs) => [...rs, { ...EMPTY_ENTRY }])}
            >
              <Plus className="mr-1.5 size-3.5" /> Add role
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" disabled={saving} onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" disabled={saving} onClick={() => void save()}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SkillsSection({
  profile,
  canEdit,
  onSaved,
  onUploadClick,
}: {
  profile: ClientProfile | null;
  canEdit: boolean;
  onSaved: (p: ClientProfile) => void;
  onUploadClick: () => void;
}) {
  const skills = readCandidate(profile)?.skills ?? [];
  const [editing, setEditing] = useState(false);
  const [chips, setChips] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function startEdit() {
    setChips([...skills]);
    setDraft("");
    setErr(null);
    setEditing(true);
  }
  function addDraft() {
    const parts = draft.split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    setChips((cs) => Array.from(new Set([...cs, ...parts])));
    setDraft("");
  }
  async function save() {
    if (!profile) return;
    setSaving(true);
    setErr(null);
    try {
      const extra = draft.split(",").map((s) => s.trim()).filter(Boolean);
      const merged = Array.from(new Set([...chips, ...extra]));
      const updated = await api.updateProfileExtraction(profile.id, { skills: merged });
      onSaved(updated);
      setEditing(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!profile) {
    return (
      <div className="rounded-xl border border-border/60 bg-background/40 p-5">
        <div className="mb-3">
          <SectionHeader title="Skills" />
        </div>
        <EmptyExtract onUploadClick={onUploadClick} kind="skills" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/60 bg-background/40 p-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <SectionHeader title="Skills" />
        {canEdit && !editing && (
          <Button variant="outline" size="sm" onClick={startEdit}>
            <Pencil className="mr-1.5 size-3.5" /> {skills.length ? "Edit" : "Add"}
          </Button>
        )}
      </div>

      {err && <p className="mb-2 text-sm text-destructive">{err}</p>}

      {!editing ? (
        skills.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No skills on file yet.{" "}
            {profile.embeddedAt
              ? "Use Add to enter them."
              : "Upload a résumé to extract them automatically."}
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {skills.map((s) => (
              <Chip key={s} tone="neutral">
                {s}
              </Chip>
            ))}
          </div>
        )
      ) : (
        <div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {chips.length === 0 && (
              <span className="text-sm text-muted-foreground">No skills — add some below.</span>
            )}
            {chips.map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-1 border border-border bg-muted/40 px-2 py-0.5 text-xs"
              >
                {s}
                <button
                  onClick={() => setChips((cs) => cs.filter((x) => x !== s))}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${s}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addDraft();
                }
              }}
              placeholder="Type a skill, press Enter"
              className="flex-1"
            />
            <Button variant="outline" size="sm" onClick={addDraft}>
              Add
            </Button>
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function TracksPanel({
  clientId,
  profiles,
  reload,
  reloadMatches,
  onFindMatches,
  matching,
}: {
  clientId: string;
  profiles: ClientProfile[] | null;
  reload: () => Promise<unknown>;
  reloadMatches: () => Promise<unknown>;
  onFindMatches: (profileId: string) => Promise<void> | void;
  matching: boolean;
}) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setBusy(true);
    try {
      await api.createProfile(clientId, { label: label.trim() });
      setLabel("");
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="px-5">
        <div className="mb-1 text-sm font-medium">New campaign</div>
        <p className="mb-3 text-xs text-muted-foreground">
          A campaign = a résumé + targeting criteria. Upload a résumé and the AI extracts the
          candidate, sets the criteria, and surfaces matches automatically.
        </p>
        <form onSubmit={add} className="flex items-end gap-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Senior Backend · Remote"
            className="flex-1"
          />
          <Button type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add campaign"}
          </Button>
        </form>
      </Card>

      {profiles === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {profiles?.length === 0 && (
        <p className="text-sm text-muted-foreground">No campaigns yet — add one to start sourcing.</p>
      )}
      {profiles?.map((p) => (
        <CampaignCard
          key={p.id}
          clientId={clientId}
          profile={p}
          reload={reload}
          reloadMatches={reloadMatches}
          onFindMatches={onFindMatches}
          matching={matching}
        />
      ))}
    </div>
  );
}

function CampaignCard({
  clientId,
  profile,
  reload,
  reloadMatches,
  onFindMatches,
  matching,
}: {
  clientId: string;
  profile: ClientProfile;
  reload: () => Promise<unknown>;
  reloadMatches: () => Promise<unknown>;
  onFindMatches: (profileId: string) => Promise<void> | void;
  matching: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const candidate = (profile.parsedProfile as { candidate?: Record<string, unknown> } | null)
    ?.candidate as
    | {
        skills?: string[];
        seniority?: string;
        minComp?: number;
        workplace?: string;
        targetTitles?: string[];
        location?: string;
      }
    | undefined;

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      const res = await api.uploadResume(clientId, profile.id, file);
      setNote(`Résumé processed — ${res.surfaced} matches surfaced.`);
      await reload();
      await reloadMatches();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleAutopilot() {
    setBusy(true);
    try {
      await api.updateProfile(profile.id, { autopilot: !profile.autopilot });
      await reload();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{profile.label}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {candidate?.seniority ? `${candidate.seniority} · ` : ""}
            {candidate?.workplace ?? ""}
            {candidate?.minComp ? ` · ≥ $${Math.round(candidate.minComp / 1000)}k` : ""}
            {candidate?.location ? ` · ${candidate.location}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={toggleAutopilot} disabled={busy} className="disabled:opacity-50">
            <Chip tone={profile.autopilot ? "success" : "neutral"}>
              autopilot {profile.autopilot ? "on" : "off"}
            </Chip>
          </button>
          <Chip tone={profile.embeddedAt ? "success" : "warning"}>
            {busy ? "working…" : profile.embeddedAt ? "embedded" : "needs résumé"}
          </Chip>
        </div>
      </div>

      {(candidate?.targetTitles?.length || candidate?.skills?.length) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(candidate?.targetTitles ?? []).slice(0, 4).map((t) => (
            <Chip key={t} tone="info">
              {t}
            </Chip>
          ))}
          {(candidate?.skills ?? []).slice(0, 8).map((s) => (
            <span
              key={s}
              className="border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
            >
              {s}
            </span>
          ))}
        </div>
      )}

      {note && <div className="mt-3 text-xs text-emerald-600">{note}</div>}
      {err && <div className="mt-3 text-xs text-destructive">{err}</div>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.txt,.md,application/pdf"
          className="hidden"
          onChange={onPick}
        />
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          {profile.embeddedAt ? "Replace résumé" : "Upload résumé"}
        </Button>
        <Button
          size="sm"
          disabled={!profile.embeddedAt || matching}
          onClick={() => void onFindMatches(profile.id)}
        >
          {matching ? "Finding…" : "Find matches"}
        </Button>
      </div>
    </Card>
  );
}
