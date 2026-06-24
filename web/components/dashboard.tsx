"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardAction } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar } from "@/components/ui/avatar";
import { Chip, statusTone } from "@/components/ui/chip";
import { cn } from "@/lib/utils";
import type {
  FunnelRow,
  OperatorStat,
  TrendPoint,
  ActivityEvent,
  ApplicationRow,
} from "@/lib/types";

// Dashboard widgets, adapted from the design into the present look — square
// corners, neutral palette, shadcn primitives. The mockup's dot-matrix charts
// are re-rendered as plain square SVG bars / sparklines in muted tones.

function EmptyHint({ label }: { label: string }) {
  return <div className="py-6 text-center text-sm text-muted-foreground">{label}</div>;
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function Sparkline({ data, width = 96, height = 28 }: { data: number[]; width?: number; height?: number }) {
  if (data.length === 0) return <div style={{ height }} />;
  const max = Math.max(...data, 1);
  const step = data.length > 1 ? width / (data.length - 1) : width;
  const pts = data
    .map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * height).toFixed(1)}`)
    .join(" ");
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="text-muted-foreground/70"
      preserveAspectRatio="none"
      aria-hidden
    >
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}

function MiniBars({ data, height = 140 }: { data: number[]; height?: number }) {
  const max = Math.max(...data, 1);
  return (
    <div className="flex items-end gap-[3px]" style={{ height }}>
      {data.map((v, i) => (
        <div
          key={i}
          className="flex-1 bg-foreground/80"
          style={{ height: `${Math.max(2, (v / max) * height)}px` }}
          title={String(v)}
        />
      ))}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  spark,
}: {
  label: string;
  value: string | number;
  sub: string;
  spark: number[];
}) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-2">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
        <div className="flex items-end justify-between gap-2">
          <span className="text-2xl font-semibold tabular-nums">{value}</span>
          <Sparkline data={spark} />
        </div>
        <span className="text-xs text-muted-foreground">{sub}</span>
      </CardContent>
    </Card>
  );
}

const SERIES = [
  { id: "applications", label: "Applications" },
  { id: "responses", label: "Responses" },
  { id: "placements", label: "Placements" },
] as const;
type SeriesId = (typeof SERIES)[number]["id"];

export function ThroughputCard({ trends }: { trends: TrendPoint[] }) {
  const [sel, setSel] = useState<SeriesId>("applications");
  const data = trends.map((t) => t[sel]);
  const total = data.reduce((a, b) => a + b, 0);
  const peak = Math.max(...data, 0);
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Pipeline throughput</CardTitle>
        <CardAction>
          <Tabs value={sel} onValueChange={(v) => setSel(v as SeriesId)}>
            <TabsList variant="line">
              {SERIES.map((s) => (
                <TabsTrigger key={s.id} value={s.id}>
                  {s.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums">{total}</span>
          <span className="text-xs text-muted-foreground">last 30 days</span>
        </div>
        {data.length > 0 ? <MiniBars data={data} /> : <EmptyHint label="No throughput data yet." />}
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>30 days ago</span>
          <span>peak {peak}/day</span>
          <span>today</span>
        </div>
      </CardContent>
    </Card>
  );
}

export function FunnelCard({ rows }: { rows: FunnelRow[] }) {
  const top = rows[0]?.value || 1;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Conversion funnel</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        {rows.length === 0 && <EmptyHint label="No funnel data yet." />}
        {rows.map((r, i) => {
          const frac = top ? r.value / top : 0;
          const pct = i === 0 ? 100 : Math.round((r.value / (rows[0]?.value || 1)) * 100);
          return (
            <div key={r.label} className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-xs text-muted-foreground">{r.label}</span>
              <div className="h-2.5 flex-1 bg-muted">
                <div
                  className={cn("h-full", i >= rows.length - 1 ? "bg-success" : "bg-foreground/80")}
                  style={{ width: `${Math.max(2, frac * 100)}%` }}
                />
              </div>
              <span className="w-16 shrink-0 text-right text-sm tabular-nums">
                {r.value.toLocaleString()}
              </span>
              <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                {pct}%
              </span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function activityTag(action: string) {
  const head = action.split(".")[0] ?? action;
  switch (head) {
    case "match":
      return { tag: "MATCH", tone: "info" as const };
    case "client":
      return { tag: "CLIENT", tone: "success" as const };
    case "profile":
      return { tag: "PROFILE", tone: "neutral" as const };
    case "member":
      return { tag: "MEMBER", tone: "warning" as const };
    default:
      return { tag: head.toUpperCase(), tone: "neutral" as const };
  }
}

function describeActivity(e: ActivityEvent): string {
  const m = e.metadata ?? {};
  switch (e.action) {
    case "client.create":
      return `Added candidate ${String(m.fullName ?? "")}`.trim();
    case "profile.create":
      return `Created track ${String(m.label ?? "")}`.trim();
    case "profile.embed":
      return "Embedded a résumé";
    case "match.action":
      return `Match ${String(m.action ?? "updated")}`;
    case "member.invite":
      return `Invited a member ${m.role ? `(${String(m.role)})` : ""}`.trim();
    default:
      return e.action.replace(/[._]/g, " ");
  }
}

export function ActivityCard({ events }: { events: ActivityEvent[] }) {
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Activity stream</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {events.length === 0 && <EmptyHint label="No activity yet." />}
        {events.map((e) => {
          const { tag, tone } = activityTag(e.action);
          return (
            <div key={e.id} className="flex items-center gap-3 py-1 text-sm">
              <span className="w-20 shrink-0 text-xs text-muted-foreground tabular-nums">
                {relTime(e.createdAt)}
              </span>
              <Chip tone={tone}>{tag}</Chip>
              <span className="truncate text-muted-foreground">
                {describeActivity(e)}
                {e.actorName && <span className="text-foreground"> · {e.actorName}</span>}
              </span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function LeaderboardCard({ rows }: { rows: OperatorStat[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Operators</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {rows.length === 0 && <EmptyHint label="No operators yet." />}
        {rows.map((o, i) => (
          <div key={o.userId} className="flex items-center gap-3 py-1.5">
            <span
              className={cn(
                "w-6 text-sm tabular-nums",
                i === 0 ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <Avatar name={o.name || o.email || "?"} size={26} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{o.name || o.email || "Unknown"}</div>
              <div className="text-xs text-muted-foreground">{o.candidateCount} candidates</div>
            </div>
            <div className="text-right">
              <div className="text-sm font-medium tabular-nums">{o.placementsMtd}</div>
              <div className="text-xs text-muted-foreground">placed</div>
            </div>
            <div className="text-right">
              <div className="text-sm font-medium tabular-nums">{o.responseRate}%</div>
              <div className="text-xs text-muted-foreground">resp</div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function ApplicationsTable({ rows }: { rows: ApplicationRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top live applications</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Candidate</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  No live applications yet.
                </TableCell>
              </TableRow>
            )}
            {rows.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  <span className="flex items-center gap-2 font-medium">
                    <Avatar name={a.clientName} size={24} />
                    {a.clientName}
                  </span>
                </TableCell>
                {/* Role + Company are hydrated from the index in a later phase. */}
                <TableCell className="text-muted-foreground">—</TableCell>
                <TableCell className="text-muted-foreground">—</TableCell>
                <TableCell>
                  <Chip tone={statusTone(a.status)}>{a.status.replace(/_/g, " ")}</Chip>
                </TableCell>
                <TableCell className="text-muted-foreground">{relTime(a.updatedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
