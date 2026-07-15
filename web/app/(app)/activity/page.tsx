"use client";

/**
 * Activity — the operator's daily worklist (f-157, ported from prototype
 * dash-activity.jsx onto live pipeline state).
 *
 * Tasks are DERIVED server-side (GET /api/activity/worklist): new matches to
 * review, tailored résumés ready to send, employer replies, offers + drafts
 * to decide. Checking a task off persists to `activity_state` (survives
 * reloads and is shared across the org's operators); the action button
 * deep-links to the surface where the work actually happens — unlike the
 * prototype, acting and checking-off are separate (the prototype's action
 * buttons just flipped local state).
 *
 * Right rail: per-candidate daily application targets (submitted-today vs a
 * track-scaled target, computed server-side from placements.applied_at) and
 * today's calendar events. No Autopilot section — dropped from the plan (no
 * action-taking backend exists).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell, Check, Flag, Send, Sparkles } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Chip } from "@/components/ui/chip";
import { BrailleSpinner, CompanyLogo } from "@/components/primitives";
import { api } from "@/lib/api";
import type { CalendarEvent, Worklist, WorklistCategory, WorklistTask } from "@/lib/types";
import { cn } from "@/lib/utils";

const CATS: Record<
  WorklistCategory,
  { label: string; icon: React.ReactNode; tone: string; action: string; done: string; blurb: string }
> = {
  review: {
    label: "Needs your review",
    icon: <Sparkles className="size-4" />,
    tone: "text-primary bg-primary/10",
    action: "Review",
    done: "Reviewed",
    blurb: "matches surfaced by the matcher",
  },
  send: {
    label: "Ready to send",
    icon: <Send className="size-4" />,
    tone: "text-warning bg-warning/10",
    action: "Open",
    done: "Sent",
    blurb: "tailored résumés queued for your sign-off",
  },
  reply: {
    label: "Awaiting your reply",
    icon: <Bell className="size-4" />,
    tone: "text-info bg-info/10",
    action: "Open",
    done: "Replied",
    blurb: "employers responded — keep them warm",
  },
  decide: {
    label: "Review & decide",
    icon: <Flag className="size-4" />,
    tone: "text-success bg-success/10",
    action: "Open",
    done: "Cleared",
    blurb: "offers and drafts that need a call",
  },
};
const CAT_ORDER: WorklistCategory[] = ["review", "send", "reply", "decide"];

function firstName(n: string) {
  return n.split(" ")[0] ?? n;
}

/** Where acting on a task actually happens. */
function taskHref(t: WorklistTask): string {
  if (t.cat === "review") return "/review";
  if (t.cat === "send" && t.matchId) return `/tailor/${t.matchId}`;
  return `/clients/${t.clientId}`;
}

function TaskRow({
  t,
  busy,
  onToggle,
}: {
  t: WorklistTask;
  busy: boolean;
  onToggle: () => void;
}) {
  const cat = CATS[t.cat];
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0",
        t.done && "opacity-55",
      )}
    >
      <button
        onClick={onToggle}
        disabled={busy}
        title={t.done ? "Mark as not done" : "Mark done"}
        className={cn(
          "grid size-6 flex-none place-items-center rounded-md border transition-colors",
          t.done
            ? "border-success bg-success text-white"
            : "border-border text-transparent hover:border-success hover:text-success/60",
        )}
      >
        <Check className="size-3.5" strokeWidth={2.6} />
      </button>
      <Avatar name={t.clientName} size={30} />
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-sm font-medium", t.done && "line-through")}>
          {t.jobTitle ?? "Role pending"}
          {t.companyName && <span className="text-muted-foreground"> · {t.companyName}</span>}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          for {firstName(t.clientName)}
          {t.fitScore != null && <span className="tabular-nums"> · fit {t.fitScore}</span>}
        </div>
      </div>
      <div className="flex flex-none items-center gap-2">
        {t.guardrail && (
          <Chip tone="warning" title={t.guardrail}>
            ⚠ {t.guardrail.length > 24 ? `${t.guardrail.slice(0, 24)}…` : t.guardrail}
          </Chip>
        )}
        {t.badge && <Chip tone={t.badge === "offer" ? "success" : "neutral"}>{t.badge}</Chip>}
        {t.companyName && <CompanyLogo company={t.companyName} size={22} />}
        {t.done ? (
          <span className="flex items-center gap-1 text-xs font-medium text-success">
            <Check className="size-3.5" strokeWidth={2.6} /> {cat.done}
          </span>
        ) : (
          <Link
            href={taskHref(t)}
            className={cn(
              "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
              t.cat === "review" || t.cat === "send"
                ? "bg-primary text-primary-foreground hover:bg-primary/85"
                : "border border-border hover:bg-muted",
            )}
          >
            {cat.action}
          </Link>
        )}
      </div>
    </div>
  );
}

export default function ActivityPage() {
  const [data, setData] = useState<Worklist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"open" | "all" | "done">("open");
  const [candFilter, setCandFilter] = useState<string>("");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);

  const load = useCallback(() => {
    api
      .activityWorklist()
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => load(), [load]);

  useEffect(() => {
    const now = new Date();
    api
      .listCalendar({ year: now.getFullYear(), month: now.getMonth() })
      .then((evs) => {
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        setEvents(evs.filter((e) => e.date === today));
      })
      .catch(() => setEvents([]));
  }, []);

  const toggle = useCallback(async (t: WorklistTask) => {
    setBusy((b) => new Set(b).add(t.key));
    // optimistic flip
    setData((d) =>
      d ? { ...d, tasks: d.tasks.map((x) => (x.key === t.key ? { ...x, done: !t.done } : x)) } : d,
    );
    try {
      await api.setActivityDone(t.key, !t.done);
    } catch {
      // revert on failure
      setData((d) =>
        d ? { ...d, tasks: d.tasks.map((x) => (x.key === t.key ? { ...x, done: t.done } : x)) } : d,
      );
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(t.key);
        return n;
      });
    }
  }, []);

  const tasks = useMemo(() => data?.tasks ?? [], [data]);
  const total = tasks.length;
  const doneCount = tasks.filter((t) => t.done).length;
  const openCount = total - doneCount;

  const candidates = useMemo(() => {
    const byName = new Map<string, number>();
    for (const t of tasks)
      byName.set(t.clientName, (byName.get(t.clientName) ?? 0) + (t.done ? 0 : 1));
    return Array.from(byName.entries())
      .map(([name, open]) => ({ name, open }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);

  const now = new Date();
  const hr = now.getHours();
  const greet = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <div className="label text-[10px]">{dateLabel}</div>
          <div className="font-heading text-lg font-semibold">
            {greet} —{" "}
            {openCount ? `${openCount} task${openCount === 1 ? "" : "s"} open` : "all caught up"}
          </div>
        </div>
        <select
          value={candFilter}
          onChange={(e) => setCandFilter(e.target.value)}
          className="h-8 rounded-lg border border-border bg-card px-2 text-sm text-foreground"
          aria-label="Filter by candidate"
        >
          <option value="">All candidates ({openCount})</option>
          {candidates.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name} ({c.open})
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1 rounded-lg border border-border p-1">
          {(
            [
              ["open", `Open ${openCount}`],
              ["all", `All ${total}`],
              ["done", `Done ${doneCount}`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                filter === id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Couldn&rsquo;t load the worklist — {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        {/* ---- worklist ---- */}
        <div className="min-w-0">
          {!data && !error && (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <BrailleSpinner /> Deriving today&rsquo;s worklist…
            </div>
          )}

          {CAT_ORDER.map((catId) => {
            const cat = CATS[catId];
            let items = tasks.filter(
              (t) => t.cat === catId && (!candFilter || t.clientName === candFilter),
            );
            if (filter === "open") items = items.filter((t) => !t.done);
            else if (filter === "done") items = items.filter((t) => t.done);
            if (!items.length) return null;
            const openN = tasks.filter((t) => t.cat === catId && !t.done).length;
            return (
              <section key={catId} className="mb-5">
                <div className="mb-2 flex items-center gap-2">
                  <span className={cn("grid size-7 place-items-center rounded-lg", cat.tone)}>
                    {cat.icon}
                  </span>
                  <h3 className="text-sm font-semibold">{cat.label}</h3>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {openN ? `${openN} open` : "all done"}
                  </span>
                  <span className="truncate text-xs text-muted-foreground/70">· {cat.blurb}</span>
                </div>
                <div className="rounded-xl border border-border bg-card">
                  {items.map((t) => (
                    <TaskRow
                      key={t.key}
                      t={t}
                      busy={busy.has(t.key)}
                      onToggle={() => void toggle(t)}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          {data && filter === "open" && openCount === 0 && !candFilter && (
            <div className="rounded-xl border border-border bg-card px-10 py-14 text-center text-sm text-muted-foreground">
              <div className="mb-2 font-mono text-xl text-primary">⣿</div>
              All caught up — nothing pending. Switch to <b>All</b> to revisit today&rsquo;s queue.
            </div>
          )}
        </div>

        {/* ---- right rail ---- */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-card px-4 py-4">
            <div className="label mb-2.5 text-[10px]">Applications today · per candidate</div>
            {data ? (
              data.targets.length ? (
                <div className="flex flex-col gap-2">
                  {data.targets.map((c) => {
                    const hit = c.target > 0 && c.submittedToday >= c.target;
                    return (
                      <div key={c.clientId} className="flex items-center gap-2">
                        <Avatar name={c.clientName} size={22} />
                        <Link
                          href={`/clients/${c.clientId}`}
                          className="min-w-0 flex-1 truncate text-sm hover:underline"
                        >
                          {c.clientName}
                        </Link>
                        <span
                          className={cn(
                            "text-sm font-semibold tabular-nums",
                            hit ? "text-success" : "text-foreground",
                          )}
                        >
                          {c.submittedToday}
                          <i className="not-italic text-muted-foreground">/{c.target}</i>
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No active candidates with tracks yet.
                </p>
              )
            ) : (
              <BrailleSpinner />
            )}
          </div>

          <div className="rounded-xl border border-border bg-card px-4 py-4">
            <div className="mb-2.5 flex items-baseline justify-between">
              <h3 className="text-sm font-semibold">On your calendar</h3>
              <span className="label text-[10px]">{events ? `${events.length} today` : "…"}</span>
            </div>
            {events && events.length ? (
              <div className="flex flex-col gap-3">
                {events.map((e) => (
                  <div key={e.id} className="flex items-start gap-2.5">
                    <Chip
                      tone={
                        e.kind === "interview" ? "info" : e.kind === "offer" ? "success" : "neutral"
                      }
                    >
                      {e.kind}
                    </Chip>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{e.clientName}</div>
                      <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                        {e.companyName && <CompanyLogo company={e.companyName} size={14} />}
                        {e.jobTitle ?? e.status}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : events ? (
              <p className="font-mono text-xs text-muted-foreground">⠿ No events today.</p>
            ) : (
              <BrailleSpinner />
            )}
          </div>

          <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
            Tasks are derived from live pipeline state — approving a match or moving a stage
            clears its task automatically. Checkmarks are shared across your org.
          </p>
        </div>
      </div>
    </div>
  );
}
