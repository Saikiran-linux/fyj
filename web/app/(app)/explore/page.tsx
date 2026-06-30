"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { CommandBar } from "@/components/command-bar";
import { api, ApiError } from "@/lib/api";
import type { JobHit } from "@/lib/types";

// Explore — GENERAL job discovery over the whole index (NOT the candidate
// match-review queue, which lives at /review). With no query it browses the
// NEWEST postings (/api/jobs/recent); a query runs the hybrid (dense + lexical
// RRF) + Voyage rerank search (/api/search). No candidate-fit framing here — this
// is browsing jobs, not scoring them against a person.

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
    setLoading(true);
    setError(null);
    setHits(null);
    try {
      setHits(q ? await api.searchJobs(q) : await api.recentJobs(40));
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
          Search ~169k live jobs in plain language — or browse the newest postings below.
        </p>
      </div>

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
                : `${hits.length} newest postings`
              : null}
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}

        {!loading && !error && hits?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {q ? "No matching jobs found. Try broader terms." : "No jobs available right now."}
          </p>
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
    <Card className="flex-col items-start gap-1 px-4 py-3">
      {job.url ? (
        <a
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[15px] font-semibold text-foreground hover:text-primary hover:underline"
        >
          {job.title}
        </a>
      ) : (
        <span className="text-[15px] font-semibold text-foreground">{job.title}</span>
      )}
      <div className="text-sm text-muted-foreground">
        {job.company}
        {job.location ? ` · ${job.location}` : ""}
      </div>
      {job.description && (
        <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">{job.description}</p>
      )}
    </Card>
  );
}
