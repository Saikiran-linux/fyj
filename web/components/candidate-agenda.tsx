"use client";

import { CalendarIcon, CoffeeIcon, MapPinIcon, VideoIcon } from "lucide-react";

/**
 * Candidate agenda — the candidate's pipeline as a time-ordered agenda. Visual
 * language adapted from devl.dev's agenda showcase (tone bar + time + meta),
 * driven by the candidate's applications/placements instead of mock calendar
 * data. Grouped by day, most recent first.
 */

export interface AgendaItem {
  id: string;
  date: string; // ISO timestamp
  title: string;
  company?: string | null;
  stage: string;
}

type Tone = "indigo" | "teal" | "amber" | "rose" | "violet" | "slate";

const TONE_BG: Record<Tone, string> = {
  indigo: "bg-indigo-500",
  teal: "bg-teal-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
  slate: "bg-slate-400",
};

function toneFor(stage: string): Tone {
  switch (stage) {
    case "interview": return "indigo";
    case "offer": return "amber";
    case "placed": return "teal";
    case "responded": return "violet";
    case "rejected": return "rose";
    default: return "slate";
  }
}

function IconFor({ stage }: { stage: string }) {
  const cls = "size-3.5 text-muted-foreground";
  if (stage === "interview") return <VideoIcon className={cls} />;
  if (stage === "offer") return <CoffeeIcon className={cls} />;
  if (stage === "placed") return <MapPinIcon className={cls} />;
  return <CalendarIcon className={cls} />;
}

function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function relativeLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const k = dayKey(iso);
  const t = today.toISOString().slice(0, 10);
  const y = new Date(today.getTime() - 86400000).toISOString().slice(0, 10);
  if (k === t) return "Today";
  if (k === y) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function CandidateAgenda({ items }: { items: AgendaItem[] }) {
  const sorted = [...items].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const groups: { label: string; key: string; items: AgendaItem[] }[] = [];
  for (const it of sorted) {
    const key = dayKey(it.date);
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { label: relativeLabel(it.date), key, items: [] }; groups.push(g); }
    g.items.push(it);
  }

  return (
    <div className="rounded-xl border border-border/60 bg-background/40 p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
        Agenda
      </div>
      <h3 className="mt-1 font-heading text-lg tracking-tight">Pipeline timeline</h3>

      {groups.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          Nothing scheduled yet — approve a match to start the pipeline.
        </p>
      )}

      {groups.map((g) => (
        <section key={g.key} className="mt-5">
          <div className="mb-2 flex items-end justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              {g.label}
            </span>
          </div>
          <ol className="flex flex-col gap-1.5">
            {g.items.map((s) => (
              <li
                key={s.id}
                className="flex items-stretch gap-3 rounded-lg border border-border/60 bg-background/60 px-3 py-2"
              >
                <span className={`w-1 shrink-0 rounded-full ${TONE_BG[toneFor(s.stage)]}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <IconFor stage={s.stage} />
                    <span className="truncate text-sm font-medium text-foreground">{s.title}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    {s.company && <span className="truncate">{s.company}</span>}
                    {s.company && <span>·</span>}
                    <span className="capitalize">{s.stage.replace(/_/g, " ")}</span>
                  </div>
                </div>
                <span className="shrink-0 self-center font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  {timeLabel(s.date)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
