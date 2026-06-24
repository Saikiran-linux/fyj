"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, ExternalLink } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Chip } from "@/components/ui/chip";
import { CommandBar } from "@/components/command-bar";
import { api } from "@/lib/api";
import type { Match, MatchConfidence } from "@/lib/types";
import { cn } from "@/lib/utils";

// Explore — the match-review queue (f-139 P2). Ranked matches across the
// operator's book; approve queues a placement, decline dismisses. Present look.

const FILTERS: { id: "all" | MatchConfidence; label: string }[] = [
  { id: "all", label: "All" },
  { id: "high", label: "High" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
];

function FitChip({ score }: { score: number | null }) {
  if (score == null) return <Chip tone="neutral">— fit</Chip>;
  const tone = score >= 80 ? "success" : score >= 60 ? "warning" : "neutral";
  return <Chip tone={tone}>{score} fit</Chip>;
}

function ConfidenceChip({ confidence }: { confidence: MatchConfidence | null }) {
  if (!confidence) return null;
  const tone = confidence === "high" ? "info" : confidence === "medium" ? "warning" : "neutral";
  return <Chip tone={tone}>{confidence}</Chip>;
}

function SkillChips({ skills, tone }: { skills: string[] | null; tone: "success" | "neutral" }) {
  if (!skills || skills.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {skills.map((s) => (
        <Chip key={s} tone={tone}>
          {s}
        </Chip>
      ))}
    </div>
  );
}

function MatchCard({
  m,
  busy,
  onApprove,
  onDecline,
  onView,
}: {
  m: Match;
  busy: boolean;
  onApprove: () => void;
  onDecline: () => void;
  onView: () => void;
}) {
  const blocked = (m.guardrails?.length ?? 0) > 0;
  return (
    <div className="border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <button onClick={onView} className="flex min-w-0 items-start gap-3 text-left">
          <Avatar name={m.clientName} size={32} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{m.clientName}</div>
            <div className="truncate text-sm text-muted-foreground">
              {m.jobTitle ?? "Role pending"}
              {m.company ? <span className="text-foreground"> @ {m.company}</span> : null}
            </div>
            {m.location && <div className="text-xs text-muted-foreground">{m.location}</div>}
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <FitChip score={m.fitScore} />
          <ConfidenceChip confidence={m.confidence} />
        </div>
      </div>

      {m.rationale && <p className="mt-3 text-sm text-muted-foreground">{m.rationale}</p>}

      {((m.matchedSkills?.length ?? 0) > 0 || (m.missingSkills?.length ?? 0) > 0) && (
        <div className="mt-3 flex flex-col gap-1.5">
          <SkillChips skills={m.matchedSkills} tone="success" />
          <SkillChips skills={m.missingSkills} tone="neutral" />
        </div>
      )}

      {blocked && (
        <div className="mt-3 flex flex-wrap gap-1">
          {m.guardrails!.map((g) => (
            <Chip key={g} tone="warning">
              ⚠ {g}
            </Chip>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={onApprove}
          disabled={busy || blocked}
          title={blocked ? "A guardrail blocks this match" : "Approve & queue résumé"}
          className="flex items-center gap-1.5 bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-40"
        >
          <Check className="size-4" /> Approve
        </button>
        <button
          onClick={onDecline}
          disabled={busy}
          className="flex items-center gap-1.5 border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-40"
        >
          <X className="size-4" /> Decline
        </button>
        <button
          onClick={onView}
          className="ml-auto text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          View
        </button>
      </div>
    </div>
  );
}

function Drawer({
  m,
  busy,
  onClose,
  onApprove,
  onDecline,
}: {
  m: Match;
  busy: boolean;
  onClose: () => void;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const blocked = (m.guardrails?.length ?? 0) > 0;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="flex-1 bg-foreground/20" onClick={onClose} />
      <aside className="flex w-full max-w-md flex-col overflow-y-auto border-l border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <Avatar name={m.clientName} size={32} />
            <div>
              <div className="text-sm font-medium">{m.clientName}</div>
              <div className="text-xs text-muted-foreground">{m.jobTitle ?? "Role pending"}</div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 text-muted-foreground hover:text-foreground">
            <X className="size-5" />
          </button>
        </div>

        <div className="flex flex-col gap-5 px-5 py-5">
          <div className="flex items-center gap-2">
            <FitChip score={m.fitScore} />
            <ConfidenceChip confidence={m.confidence} />
            {m.company && <span className="text-sm text-muted-foreground">@ {m.company}</span>}
          </div>

          {m.url && (
            <a
              href={m.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-fit items-center gap-1.5 text-sm text-info hover:underline"
            >
              View job posting <ExternalLink className="size-3.5" />
            </a>
          )}

          <section>
            <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Why this match
            </h3>
            <p className="text-sm text-muted-foreground">
              {m.rationale ?? "Rationale is generated by the evaluation pass and isn't available yet."}
            </p>
          </section>

          {m.matchedSkills?.length ? (
            <section>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Matched skills
              </h3>
              <SkillChips skills={m.matchedSkills} tone="success" />
            </section>
          ) : null}

          {m.missingSkills?.length ? (
            <section>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Gaps
              </h3>
              <SkillChips skills={m.missingSkills} tone="neutral" />
            </section>
          ) : null}

          {blocked && (
            <section>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Guardrails
              </h3>
              <div className="flex flex-wrap gap-1">
                {m.guardrails!.map((g) => (
                  <Chip key={g} tone="warning">
                    ⚠ {g}
                  </Chip>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="mt-auto flex items-center gap-2 border-t border-border px-5 py-4">
          <button
            onClick={onApprove}
            disabled={busy || blocked}
            className="flex items-center gap-1.5 bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-40"
          >
            <Check className="size-4" /> Approve &amp; queue
          </button>
          <button
            onClick={onDecline}
            disabled={busy}
            className="flex items-center gap-1.5 border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-40"
          >
            <X className="size-4" /> Decline
          </button>
        </div>
      </aside>
    </div>
  );
}

export default function ExplorePage() {
  const router = useRouter();
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [filter, setFilter] = useState<"all" | MatchConfidence>("all");
  const [selected, setSelected] = useState<Match | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setMatches(null);
    setError(null);
    api
      .listMatches(filter === "all" ? undefined : { confidence: filter })
      .then(setMatches)
      .catch((e: Error) => setError(e.message));
  }, [filter]);

  useEffect(() => load(), [load]);

  const act = useCallback(
    async (m: Match, kind: "approve" | "decline") => {
      setBusy((b) => new Set(b).add(m.id));
      try {
        if (kind === "approve") await api.approveMatch(m.id);
        else await api.declineMatch(m.id);
        setMatches((cur) => (cur ? cur.filter((x) => x.id !== m.id) : cur));
        setSelected((s) => (s?.id === m.id ? null : s));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy((b) => {
          const n = new Set(b);
          n.delete(m.id);
          return n;
        });
      }
    },
    [],
  );

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-[28px] font-bold tracking-tight text-foreground">Explore</h1>
          <p className="text-sm text-muted-foreground">
            {matches ? `${matches.length} matches to review` : "Loading matches…"}
          </p>
        </div>
        <div className="flex items-center gap-1 border border-border p-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "px-3 py-1 text-sm font-medium transition-colors",
                filter === f.id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-5">
        <CommandBar onSubmit={(q) => router.push(`/jobs?q=${encodeURIComponent(q)}`)} />
      </div>

      {error && (
        <div className="mb-4 border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Couldn&rsquo;t load matches — {error}
        </div>
      )}

      {matches && matches.length === 0 && !error && (
        <div className="border border-border bg-card px-6 py-16 text-center text-sm text-muted-foreground">
          No matches to review. They appear here once a candidate&rsquo;s campaign surfaces jobs.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {matches?.map((m) => (
          <MatchCard
            key={m.id}
            m={m}
            busy={busy.has(m.id)}
            onApprove={() => void act(m, "approve")}
            onDecline={() => void act(m, "decline")}
            onView={() => setSelected(m)}
          />
        ))}
      </div>

      {selected && (
        <Drawer
          m={selected}
          busy={busy.has(selected.id)}
          onClose={() => setSelected(null)}
          onApprove={() => void act(selected, "approve")}
          onDecline={() => void act(selected, "decline")}
        />
      )}
    </div>
  );
}
