"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { CompanyLogo } from "@/components/primitives";
import { api } from "@/lib/api";
import type { CalendarEvent, CalendarKind } from "@/lib/types";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function kindTone(kind: CalendarKind) {
  return kind === "interview"
    ? "info"
    : kind === "offer"
      ? "success"
      : kind === "call"
        ? "warning"
        : "neutral";
}

function EventChip({ e }: { e: CalendarEvent }) {
  return (
    <Chip tone={kindTone(e.kind)}>
      {e.kind} · {e.clientName.split(" ")[0]}
    </Chip>
  );
}

export default function CalendarPage() {
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [view, setView] = useState<"month" | "agenda">("month");
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEvents(null);
    setError(null);
    setSelectedDay(null);
    api
      .listCalendar({ year: cursor.year, month: cursor.month })
      .then(setEvents)
      .catch((e: Error) => setError(e.message));
  }, [cursor.year, cursor.month]);

  const byDay = useMemo(() => {
    const map: Record<number, CalendarEvent[]> = {};
    for (const e of events ?? []) {
      const day = Number(e.date.slice(8, 10));
      (map[day] ??= []).push(e);
    }
    return map;
  }, [events]);

  const monthName = new Date(cursor.year, cursor.month, 1).toLocaleString("default", {
    month: "long",
  });
  const firstWeekday = (new Date(cursor.year, cursor.month, 1).getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const isToday = (day: number) =>
    today.getFullYear() === cursor.year && today.getMonth() === cursor.month && today.getDate() === day;

  function shift(delta: number) {
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  const agenda = (events ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">
            {monthName} {cursor.year}
          </h1>
          <div className="flex items-center">
            <button onClick={() => shift(-1)} aria-label="Previous month" className="p-1.5 text-muted-foreground hover:text-foreground">
              <ChevronLeft className="size-4" />
            </button>
            <button onClick={() => shift(1)} aria-label="Next month" className="p-1.5 text-muted-foreground hover:text-foreground">
              <ChevronRight className="size-4" />
            </button>
          </div>
          <button
            onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })}
            className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Today
          </button>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border p-1">
          {(["month", "agenda"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium capitalize transition-colors",
                view === v
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Couldn&rsquo;t load the calendar — {error}
        </div>
      )}

      {view === "month" ? (
        <>
          <div className="grid grid-cols-7 overflow-hidden rounded-xl border-l border-t border-border">
            {WEEKDAYS.map((w) => (
              <div
                key={w}
                className="border-r border-b border-border bg-muted/40 px-2 py-1.5 text-xs font-medium text-muted-foreground"
              >
                {w}
              </div>
            ))}
            {cells.map((day, i) => (
              <div
                key={i}
                className={cn(
                  "min-h-24 border-r border-b border-border p-1.5 align-top",
                  day == null ? "bg-muted/20" : "cursor-pointer hover:bg-muted/30",
                  day != null && selectedDay === day && "bg-accent/40",
                )}
                onClick={() => day != null && setSelectedDay(day)}
              >
                {day != null && (
                  <>
                    <div
                      className={cn(
                        "mb-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs tabular-nums",
                        isToday(day) ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground",
                      )}
                    >
                      {day}
                    </div>
                    <div className="flex flex-col gap-1">
                      {(byDay[day] ?? []).slice(0, 3).map((e) => (
                        <EventChip key={e.id} e={e} />
                      ))}
                      {(byDay[day]?.length ?? 0) > 3 && (
                        <span className="text-[11px] text-muted-foreground">
                          +{byDay[day]!.length - 3} more
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          {selectedDay != null && (
            <div className="mt-4 rounded-xl border border-border bg-card p-4">
              <h3 className="mb-2 text-sm font-medium">
                {monthName} {selectedDay}, {cursor.year}
              </h3>
              {(byDay[selectedDay] ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No events — pick another day.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {(byDay[selectedDay] ?? []).map((e) => (
                    <EventRow key={e.id} e={e} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-2">
          {events === null && <p className="text-sm text-muted-foreground">Loading…</p>}
          {events?.length === 0 && (
            <div className="rounded-xl border border-border bg-card px-6 py-16 text-center text-sm text-muted-foreground">
              No scheduled events this month.
            </div>
          )}
          {agenda.map((e) => (
            <div key={e.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
              <span className="w-16 shrink-0 text-xs text-muted-foreground tabular-nums">
                {e.date.slice(5)}
              </span>
              <EventRow e={e} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EventRow({ e }: { e: CalendarEvent }) {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {e.companyName && <CompanyLogo company={e.companyName} size={22} />}
        <div className="truncate text-sm font-medium">
          {e.clientName}
          {e.jobTitle ? <span className="text-muted-foreground"> · {e.jobTitle}</span> : null}
          {e.companyName ? <span className="text-muted-foreground"> @ {e.companyName}</span> : null}
        </div>
      </div>
      <Chip tone={kindTone(e.kind)}>{e.kind}</Chip>
    </div>
  );
}
