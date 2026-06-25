"use client";

import { useMemo } from "react";

/**
 * Candidate activity heatmap — a GitHub-style year grid of the candidate's
 * pipeline activity (matches surfaced + application stage changes). Visual
 * language adapted from devl.dev's year-heatmap showcase, but data-driven from
 * our own per-candidate timestamps instead of the GitHub contributions API.
 */

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const WEEKDAY_LABELS = ["Mon", "Wed", "Fri"];
const WEEKS = 53;

type Day = { date: string; count: number; level: 0 | 1 | 2 | 3 | 4 };

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function levelColor(level: Day["level"]): string {
  switch (level) {
    case 0: return "rgba(127, 127, 127, 0.08)";
    case 1: return "rgba(20, 184, 166, 0.28)";
    case 2: return "rgba(20, 184, 166, 0.5)";
    case 3: return "rgba(20, 184, 166, 0.75)";
    case 4: return "rgba(20, 184, 166, 0.96)";
  }
}

function levelFor(count: number, max: number): Day["level"] {
  if (count <= 0) return 0;
  if (max <= 1) return 4;
  const r = count / max;
  if (r <= 0.25) return 1;
  if (r <= 0.5) return 2;
  if (r <= 0.75) return 3;
  return 4;
}

/** Build 53 week-columns (Sun→Sat) ending on the week containing today. */
function buildGrid(dates: string[]): { weeks: Day[][]; total: number; max: number } {
  const counts = new Map<string, number>();
  for (const ts of dates) {
    if (!ts) continue;
    const key = ts.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const max = counts.size ? Math.max(...counts.values()) : 0;

  // Start: the Sunday (WEEKS-1) weeks before this week's Sunday.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - start.getDay() - (WEEKS - 1) * 7);

  const weeks: Day[][] = [];
  let total = 0;
  const cursor = new Date(start);
  for (let w = 0; w < WEEKS; w++) {
    const week: Day[] = [];
    for (let d = 0; d < 7; d++) {
      const key = isoDay(cursor);
      const count = key <= isoDay(today) ? (counts.get(key) ?? 0) : 0;
      total += count;
      week.push({ date: key, count, level: levelFor(count, max) });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return { weeks, total, max };
}

function deriveStats(weeks: Day[][]) {
  const flat = weeks.flat();
  const today = isoDay(new Date());
  const past = flat.filter((d) => d.date <= today);
  const activeDays = past.filter((d) => d.count > 0).length;

  let longest = 0;
  let run = 0;
  for (const d of past) {
    if (d.count > 0) { run += 1; longest = Math.max(longest, run); }
    else run = 0;
  }
  let current = 0;
  for (let i = past.length - 1; i >= 0; i--) {
    const d = past[i];
    if (!d) break;
    if (d.count > 0) current += 1;
    else if (i === past.length - 1) continue; // today empty doesn't break it
    else break;
  }
  return { activeDays, longestStreak: longest, currentStreak: current };
}

function monthLabels(weeks: Day[][]) {
  const out: { label: string; weekIndex: number }[] = [];
  let last = -1;
  weeks.forEach((week, wi) => {
    const first = week[0];
    if (!first) return;
    const m = new Date(first.date).getMonth();
    const label = MONTHS_SHORT[m];
    if (m !== last && label) { out.push({ label, weekIndex: wi }); last = m; }
  });
  return out;
}

function fmtLong(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
}

export function CandidateHeatmap({ dates }: { dates: string[] }) {
  const { weeks, total } = useMemo(() => buildGrid(dates), [dates]);
  const stats = useMemo(() => deriveStats(weeks), [weeks]);
  const months = useMemo(() => monthLabels(weeks), [weeks]);

  return (
    <div className="rounded-xl border border-border/60 bg-background/40 p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
        Activity · last 12 months
      </div>
      <h3 className="mt-1 font-heading text-lg tracking-tight">
        {total.toLocaleString()} event{total === 1 ? "" : "s"}
        <span className="ml-2 font-sans text-xs text-muted-foreground">
          · active {stats.activeDays} day{stats.activeDays === 1 ? "" : "s"} · longest{" "}
          <span className="text-foreground">{stats.longestStreak}d</span> · current{" "}
          <span className="text-foreground">{stats.currentStreak}d</span>
        </span>
      </h3>

      <div className="mt-4 overflow-x-auto">
        <div className="grid grid-cols-[28px_1fr] gap-2">
          <div className="flex flex-col gap-[3px] pt-5">
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <span key={d} className="flex h-3 items-center font-mono text-[9px] text-muted-foreground">
                {d % 2 === 1 && d <= 5 ? WEEKDAY_LABELS[(d - 1) / 2] : ""}
              </span>
            ))}
          </div>
          <div>
            <div className="relative h-4">
              {months.map((m) => (
                <span
                  key={`${m.label}-${m.weekIndex}`}
                  className="absolute font-mono text-[10px] text-muted-foreground"
                  style={{ left: `${(m.weekIndex / weeks.length) * 100}%` }}
                >
                  {m.label}
                </span>
              ))}
            </div>
            <div className="mt-1 flex gap-[3px]">
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-[3px]">
                  {week.map((c) => (
                    <span
                      key={c.date}
                      title={`${c.count} event${c.count === 1 ? "" : "s"} · ${fmtLong(c.date)}`}
                      className="size-3 rounded-sm"
                      style={{ backgroundColor: levelColor(c.level) }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          <span>Less</span>
          <div className="flex gap-[3px]">
            {([0, 1, 2, 3, 4] as const).map((lvl) => (
              <span key={lvl} className="size-3 rounded-sm" style={{ backgroundColor: levelColor(lvl) }} />
            ))}
          </div>
          <span>More</span>
        </div>
      </div>
    </div>
  );
}
