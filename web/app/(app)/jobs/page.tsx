"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { CommandBar } from "@/components/command-bar";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api";
import type { JobHit } from "@/lib/types";

export default function JobsPage() {
  return (
    <>
      <Topbar title="Jobs" />
      <Suspense fallback={<div className="px-8 py-10 text-sm text-text-faint">Loading…</div>}>
        <JobsInner />
      </Suspense>
    </>
  );
}

function JobsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const profileId = params.get("profile");
  const q = params.get("q");

  const [hits, setHits] = useState<JobHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHits(null);
    try {
      if (profileId) setHits(await api.profileJobs(profileId));
      else if (q) setHits(await api.searchJobs(q));
      else setHits([]);
    } catch (e) {
      const msg =
        e instanceof ApiError && e.status === 409
          ? "This profile has no resume embedding yet — upload a resume first."
          : (e as Error).message;
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [profileId, q]);

  useEffect(() => {
    void run();
  }, [run]);

  const heading = profileId
    ? "Matches for this profile"
    : q
      ? `Results for “${q}”`
      : "Search the index";

  return (
    <div className="mx-auto max-w-5xl px-8 pb-16">
      <h1 className="mb-4 mt-2 text-2xl font-bold tracking-tight text-text">{heading}</h1>

      <CommandBar onSubmit={(query) => router.push(`/jobs?q=${encodeURIComponent(query)}`)} />

      <div className="mt-6 space-y-3">
        {loading && <p className="text-sm text-text-faint">Searching ~169k jobs…</p>}
        {error && <p className="text-sm text-danger">{error}</p>}
        {!loading && !error && hits?.length === 0 && (
          <p className="text-sm text-text-faint">
            {profileId || q
              ? "No matching jobs found."
              : "Search jobs above, or open a client profile and pick “View jobs”."}
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
    <Card className="flex items-start justify-between gap-4 p-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-text-faint">#{job.rank}</span>
          {job.url ? (
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-[15px] font-semibold text-text hover:text-primary hover:underline"
            >
              {job.title}
            </a>
          ) : (
            <span className="truncate text-[15px] font-semibold text-text">{job.title}</span>
          )}
        </div>
        <div className="mt-0.5 text-sm text-text-muted">
          {job.company}
          {job.location ? ` · ${job.location}` : ""}
        </div>
        {job.description && (
          <p className="mt-2 line-clamp-2 text-[13px] text-text-muted">{job.description}</p>
        )}
      </div>
      <Chip tone="info">{(job.score * 100).toFixed(0)}% match</Chip>
    </Card>
  );
}
