"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ExternalLink, X } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { CommandBar } from "@/components/command-bar";
import { CompanyLogo } from "@/components/primitives";
import { api, ApiError } from "@/lib/api";
import type { JobHit } from "@/lib/types";
import { cn } from "@/lib/utils";

// Explore — GENERAL job discovery over the whole index (NOT the candidate
// match-review queue, which lives at /review). With no query it browses the
// NEWEST postings via discovery rails (f-155, prototype parity): Fresh /
// Remote-first / Top compensation, all sliced client-side from one
// /api/jobs/recent call. A query runs the hybrid (dense + lexical RRF) +
// Voyage rerank search (/api/search). Clicking any card opens a detail
// drawer with the real posting description — no synthetic JD.

export default function ExplorePage() {
  return (
    <Suspense
      fallback={<div className="px-8 py-10 text-sm text-muted-foreground">Loading…</div>}
    >
      <ExploreInner />
    </Suspense>
  );
}

/** "$160k–$190k" from the structured comp fields (or the raw comp text). */
function fmtComp(j: JobHit): string | null {
  if (j.compText) return j.compText;
  const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  const cur = j.compCurrency === "EUR" ? "€" : j.compCurrency === "GBP" ? "£" : "$";
  if (j.compMin != null && j.compMax != null) return `${cur}${k(j.compMin)}–${cur}${k(j.compMax)}`;
  if (j.compMax != null) return `up to ${cur}${k(j.compMax)}`;
  if (j.compMin != null) return `from ${cur}${k(j.compMin)}`;
  return null;
}

function relDays(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (Number.isNaN(d) || d < 0) return null;
  return d === 0 ? "today" : d === 1 ? "1d ago" : `${d}d ago`;
}

function ExploreInner() {
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get("q")?.trim() ?? "";

  const [hits, setHits] = useState<JobHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<JobHit | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHits(null);
    try {
      setHits(q ? await api.searchJobs(q) : await api.recentJobs(60));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    void run();
  }, [run]);

  // Discovery rails (browse mode) — sliced from the newest-first listing.
  const rails = useMemo(() => {
    if (q || !hits) return null;
    const remote = hits.filter((j) => (j.workplace ?? "").toLowerCase().includes("remote"));
    const paid = hits
      .filter((j) => j.compMax != null)
      .sort((a, b) => (b.compMax ?? 0) - (a.compMax ?? 0));
    return [
      { id: "fresh", label: "Fresh this week", jobs: hits.slice(0, 12) },
      { id: "remote", label: "Remote-first", jobs: remote.slice(0, 12) },
      { id: "comp", label: "Top compensation", jobs: paid.slice(0, 12) },
    ].filter((r) => r.jobs.length > 0);
  }, [q, hits]);

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <CommandBar onSubmit={(query) => router.push(`/explore?q=${encodeURIComponent(query)}`)} />

      <div className="mt-6 space-y-3">
        <p className="text-sm text-muted-foreground">
          {loading
            ? q
              ? "Searching ~169k jobs…"
              : "Loading the newest jobs…"
            : hits
              ? q
                ? `${hits.length} results for “${q}”`
                : null
              : null}
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}

        {!loading && !error && hits?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {q ? "No matching jobs found. Try broader terms." : "No jobs available right now."}
          </p>
        )}

        {/* search mode — ranked grid */}
        {q && hits && hits.length > 0 && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {hits.map((j) => (
              <JobCard key={`${j.jobId}:${j.companyId}`} job={j} onOpen={() => setOpen(j)} />
            ))}
          </div>
        )}

        {/* browse mode — discovery rails */}
        {rails?.map((rail) => (
          <section key={rail.id} className="pt-2">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="label">{rail.label}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {rail.jobs.length}
              </span>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {rail.jobs.map((j) => (
                <JobCard
                  key={`${rail.id}:${j.jobId}:${j.companyId}`}
                  job={j}
                  compact
                  onOpen={() => setOpen(j)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {open && <JobDrawer job={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function JobCard({
  job,
  compact = false,
  onOpen,
}: {
  job: JobHit;
  compact?: boolean;
  onOpen: () => void;
}) {
  const comp = fmtComp(job);
  const posted = relDays(job.postedAt);
  return (
    <button
      onClick={onOpen}
      className={cn(
        "flex flex-col items-start gap-1.5 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-input hover:shadow-sm",
        compact ? "w-72 shrink-0" : "",
      )}
    >
      <div className="flex w-full items-start gap-2.5">
        <CompanyLogo company={job.company} size={28} />
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-foreground">{job.title}</div>
          <div className="truncate text-sm text-muted-foreground">
            {job.company}
            {job.location ? ` · ${job.location}` : ""}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {job.workplace && <Chip tone="neutral">{job.workplace}</Chip>}
        {job.source && <Chip tone="neutral">{job.source}</Chip>}
        {comp && <span className="text-xs font-medium text-foreground tabular-nums">{comp}</span>}
        {posted && <span className="text-xs text-muted-foreground">{posted}</span>}
      </div>
      {!compact && job.description && (
        <p className="line-clamp-2 text-[13px] text-muted-foreground">{job.description}</p>
      )}
    </button>
  );
}

function JobDrawer({ job, onClose }: { job: JobHit; onClose: () => void }) {
  const comp = fmtComp(job);
  const posted = relDays(job.postedAt);
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="flex-1 bg-foreground/20" onClick={onClose} />
      <aside className="flex w-full max-w-lg flex-col overflow-hidden border-l border-border bg-background">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <CompanyLogo company={job.company} size={36} />
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">{job.title}</h2>
              <div className="truncate text-sm text-muted-foreground">
                {job.company}
                {job.location ? ` · ${job.location}` : ""}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-5 py-3">
          {job.workplace && <Chip tone="neutral">{job.workplace}</Chip>}
          {job.employmentType && <Chip tone="neutral">{job.employmentType}</Chip>}
          {job.source && <Chip tone="neutral">{job.source}</Chip>}
          {comp && <span className="text-sm font-medium tabular-nums">{comp}</span>}
          {posted && <span className="text-xs text-muted-foreground">posted {posted}</span>}
          {job.url && (
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              View original posting <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {job.description ? (
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
              {job.description}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No description available for this posting — open the original posting for the full
              text.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
