"use client";

import { useEffect, useState } from "react";
import {
  KpiCard,
  ThroughputCard,
  FunnelCard,
  ActivityCard,
  LeaderboardCard,
  ApplicationsTable,
} from "@/components/dashboard";
import { useSession } from "@/lib/auth-client";
import { api } from "@/lib/api";
import type {
  DashboardKpis,
  FunnelRow,
  OperatorStat,
  TrendPoint,
  ActivityEvent,
  ApplicationRow,
} from "@/lib/types";

export default function DashboardPage() {
  const { data } = useSession();
  const firstName = (data?.user?.name || data?.user?.email || "there").split(/[\s@]/)[0];

  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [funnel, setFunnel] = useState<FunnelRow[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [leaderboard, setLeaderboard] = useState<OperatorStat[]>([]);
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.dashboardKpis(),
      api.dashboardTrends(),
      api.dashboardFunnel(),
      api.dashboardActivity(),
      api.dashboardLeaderboard(),
      api.listApplications(),
    ])
      .then(([k, t, f, a, l, ap]) => {
        if (!alive) return;
        setKpis(k);
        setTrends(t);
        setFunnel(f);
        setActivity(a);
        setLeaderboard(l);
        setApplications(ap);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  // % change: second half of the 30-day window vs the first half. Null when
  // there's no prior-period signal — the KpiCard then hides the delta chip.
  const deltaOf = (series: number[]): number | null => {
    if (series.length < 8) return null;
    const half = Math.floor(series.length / 2);
    const prev = series.slice(0, half).reduce((a, b) => a + b, 0);
    const cur = series.slice(half).reduce((a, b) => a + b, 0);
    if (prev === 0) return null;
    return Math.round(((cur - prev) / prev) * 100);
  };
  const placementsSeries = trends.map((t) => t.placements);
  const responsesSeries = trends.map((t) => t.responses);
  const applicationsSeries = trends.map((t) => t.applications);

  const kpiCards = [
    {
      label: "Placements",
      sub: "month to date",
      value: kpis?.placementsMtd ?? 0,
      spark: placementsSeries,
      delta: deltaOf(placementsSeries),
    },
    {
      label: "Response rate",
      sub: "30-day rolling",
      value: `${kpis?.responseRate ?? 0}%`,
      spark: responsesSeries,
      delta: deltaOf(responsesSeries),
    },
    {
      label: "Live applications",
      sub: "in flight now",
      value: kpis?.liveApplications ?? 0,
      spark: applicationsSeries,
      delta: deltaOf(applicationsSeries),
    },
    {
      label: "Awaiting review",
      sub: "matches queued",
      value: kpis?.awaitingReview ?? 0,
      spark: [] as number[],
      delta: null,
    },
  ];

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <h1 className="mb-5 font-heading text-[28px] font-bold tracking-tight text-foreground">
        Hey {firstName}, here&rsquo;s your book today
      </h1>

      {error && (
        <div className="mt-6 border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Couldn&rsquo;t load the dashboard — {error}
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map((k) => (
          <KpiCard key={k.label} {...k} />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ThroughputCard trends={trends} />
        <FunnelCard rows={funnel} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ActivityCard events={activity} />
        <LeaderboardCard rows={leaderboard} />
      </div>

      <div className="mt-4">
        <ApplicationsTable rows={applications} />
      </div>
    </div>
  );
}
