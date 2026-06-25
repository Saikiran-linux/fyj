"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
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
import { api } from "@/lib/api";
import type { Client, ClientProfile, Match, ApplicationRow, ConsentStatus } from "@/lib/types";

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
  const [client, setClient] = useState<Client | null>(null);
  const [profiles, setProfiles] = useState<ClientProfile[] | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [apps, setApps] = useState<ApplicationRow[] | null>(null);
  const [tab, setTab] = useState("overview");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadProfiles = () => api.listProfiles(id).then(setProfiles);

  useEffect(() => {
    api.getClient(id).then(setClient).catch((e: Error) => setError(e.message));
    loadProfiles().catch(() => {});
    api.listMatches({ candidateId: id }).then(setMatches).catch(() => {});
    api.listClientApplications(id).then(setApps).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
      if (kind === "approve") await api.approveMatch(m.id);
      else await api.declineMatch(m.id);
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
              <Button variant="outline" disabled={busy} onClick={toggleStatus}>
                {client.status === "paused" ? "Resume" : "Pause"}
              </Button>
            )}
            <Button onClick={() => setTab("matches")}>Find matches</Button>
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
            <Card className="px-5">
              <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
                <Field label="Email" value={client?.email ?? "—"} />
                <Field label="Phone" value={client?.phone ?? "—"} />
                <Field label="Status" value={client?.status ?? "—"} />
                <Field label="Consent" value={client?.consentStatus ?? "—"} />
                <Field label="Portal" value={client?.portalEnabled ? "Enabled" : "Off"} />
                <Field label="Added" value={client ? fmtDate(client.createdAt) : "—"} />
              </dl>
              {client?.notes && <p className="mt-4 text-sm text-muted-foreground">{client.notes}</p>}
            </Card>
          </TabsContent>

          {/* Matches */}
          <TabsContent value="matches" className="pt-4">
            <div className="flex flex-col gap-2">
              {matches === null && <p className="text-sm text-muted-foreground">Loading…</p>}
              {matches?.length === 0 && (
                <p className="text-sm text-muted-foreground">No open matches for this candidate.</p>
              )}
              {matches?.map((m) => (
                <MatchRow key={m.id} m={m} onAct={actMatch} />
              ))}
            </div>
          </TabsContent>

          {/* Tracks */}
          <TabsContent value="tracks" className="pt-4">
            <TracksPanel clientId={id} profiles={profiles} reload={loadProfiles} />
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
    </>
  );
}

function MatchRow({
  m,
  onAct,
}: {
  m: Match;
  onAct: (m: Match, kind: "approve" | "decline") => void | Promise<void>;
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

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card size="sm" className="px-4">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm capitalize text-foreground">{value}</dd>
    </div>
  );
}

function TracksPanel({
  clientId,
  profiles,
  reload,
}: {
  clientId: string;
  profiles: ClientProfile[] | null;
  reload: () => Promise<unknown>;
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
    <Card className="px-5">
      <form onSubmit={add} className="mb-4 flex items-end gap-2">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Senior Backend · Remote EU"
          className="flex-1"
        />
        <Button type="submit" disabled={busy}>
          {busy ? "Adding…" : "Add track"}
        </Button>
      </form>
      <div className="divide-y divide-border">
        {profiles === null && <p className="py-3 text-sm text-muted-foreground">Loading…</p>}
        {profiles?.length === 0 && (
          <p className="py-3 text-sm text-muted-foreground">No tracks yet — add one to start matching.</p>
        )}
        {profiles?.map((p) => (
          <TrackRow key={p.id} clientId={clientId} profile={p} reload={reload} />
        ))}
      </div>
    </Card>
  );
}

function TrackRow({
  clientId,
  profile,
  reload,
}: {
  clientId: string;
  profile: ClientProfile;
  reload: () => Promise<unknown>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      await api.uploadResume(clientId, profile.id, file);
      await reload();
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
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">{profile.label}</div>
        {err && <div className="mt-0.5 text-xs text-destructive">{err}</div>}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={toggleAutopilot}
          disabled={busy}
          title="Autopilot auto-flows high-confidence matches"
          className="disabled:opacity-50"
        >
          <Chip tone={profile.autopilot ? "success" : "neutral"}>
            autopilot {profile.autopilot ? "on" : "off"}
          </Chip>
        </button>
        {profile.embeddedAt && (
          <Link
            href={`/jobs?profile=${profile.id}`}
            className="text-xs font-medium text-primary hover:underline"
          >
            View jobs →
          </Link>
        )}
        <Chip tone={profile.embeddedAt ? "success" : "warning"}>
          {busy ? "working…" : profile.embeddedAt ? "embedded" : "needs embed"}
        </Chip>
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
      </div>
    </div>
  );
}
