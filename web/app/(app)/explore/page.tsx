"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { CommandBar } from "@/components/command-bar";
import { api, ApiError } from "@/lib/api";
import type { JobHit } from "@/lib/types";

// Explore — GENERAL natural-language job search over the whole index (not the
// candidate match-review queue, which now lives at /review). Type a query like
// "remote senior backend at a fintech startup with equity"; it embeds the query
// (src/api.ts /api/search → embedText → searchAndHydrate over ~169k jobs) and
// lists ranked postings. The query lives in ?q= so results are shareable/back-able.

export default function ExplorePage() {
  return (
    <Suspense
      fallback={<div className="px-8 py-10 text-sm text-muted-foreground">Loading…</div>}
    >
      <ExploreInner />
    </Suspense>
  );
}

function ExploreInner() {
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get("q")?.trim() ?? "";

  const [hits, setHits] = useState<JobHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    if (!q) {
      setHits(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    setHits(null);
    try {
      setHits(await api.searchJobs(q));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="mb-5">
        <h1 className="font-heading text-[28px] font-bold tracking-tight text-foreground">Explore</h1>
        <p className="text-sm text-muted-foreground">
          Search ~169k live jobs in plain language — role, stack, seniority, location, comp, perks.
        </p>
      </div>

      <CommandBar onSubmit={(query) => router.push(`/explore?q=${encodeURIComponent(query)}`)} />

      <div className="mt-6 space-y-3">
        {q && (
          <p className="text-sm text-muted-foreground">
            {loading ? "Searching ~169k jobs…" : hits ? `${hits.length} results for “${q}”` : null}
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {!q && !loading && (
          <div className="border border-border bg-card px-6 py-16 text-center text-sm text-muted-foreground">
            Try “remote senior backend engineer at a fintech startup with equity” or
            “product designer, B2B SaaS, hybrid NYC”.
          </div>
        )}

        {q && !loading && !error && hits?.length === 0 && (
          <p className="text-sm text-muted-foreground">No matching jobs found. Try broader terms.</p>
        )}

        {hits?.map((j) => (
          <JobCard key={`${j.jobId}:${j.companyId}`} job={j} />
        ))}
      </div>
    </div>
  );
}

function JobCard({ job }: { job: JobHit }) {
  return (
    <Card className="flex-row items-start justify-between gap-4 px-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-muted-foreground">#{job.rank}</span>
          {job.url ? (
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-[15px] font-semibold text-foreground hover:text-primary hover:underline"
            >
              {job.title}
            </a>
          ) : (
            <span className="truncate text-[15px] font-semibold text-foreground">{job.title}</span>
          )}
        </div>
        <div className="mt-0.5 text-sm text-muted-foreground">
          {job.company}
          {job.location ? ` · ${job.location}` : ""}
        </div>
        {job.description && (
          <p className="mt-2 line-clamp-2 text-[13px] text-muted-foreground">{job.description}</p>
        )}
      </div>
      <Chip tone="info">{(job.score * 100).toFixed(0)}% match</Chip>
    </Card>
  );
}
