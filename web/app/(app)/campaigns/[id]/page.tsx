"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Table, THead, TRow, TCell, EmptyRow } from "@/components/ui/table";
import { Chip, statusTone } from "@/components/ui/chip";
import { api } from "@/lib/api";
import type { CampaignMatch, MatchActionValue } from "@/lib/types";

const QUICK: MatchActionValue[] = ["saved", "shortlisted", "dismissed"];

export default function CampaignMatchesPage() {
  const { id } = useParams<{ id: string }>();
  const [matches, setMatches] = useState<CampaignMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.listCampaignMatches(id).then(setMatches);

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, [id]);

  async function act(matchId: string, action: MatchActionValue) {
    // optimistic
    setMatches((m) => m?.map((x) => (x.id === matchId ? { ...x, action } : x)) ?? m);
    try {
      await api.setMatchAction(matchId, action);
    } catch (err) {
      setError((err as Error).message);
      await load();
    }
  }

  return (
    <>
      <Topbar title="Campaigns" />
      <div className="mx-auto max-w-5xl px-8 pb-16">
        <PageHeader title="Campaign matches" subtitle="Curate what the matcher surfaced." />
        {error && <p className="mb-4 text-sm text-danger">{error}</p>}

        <Table>
          <THead cols={["#", "Job", "Score", "Status", "Actions"]} />
          <tbody>
            {matches === null && !error && <EmptyRow colSpan={5} label="Loading…" />}
            {matches?.length === 0 && (
              <EmptyRow colSpan={5} label="No matches yet — the matcher runs hourly." />
            )}
            {matches?.map((m) => (
              <TRow key={m.id}>
                <TCell muted>{m.rank ?? "—"}</TCell>
                <TCell>
                  <span className="font-mono text-xs text-text-muted">
                    {m.jobId.slice(0, 8)}…
                  </span>
                </TCell>
                <TCell muted>
                  <span className="tabular-nums">{m.score?.toFixed(3) ?? "—"}</span>
                </TCell>
                <TCell>
                  <Chip tone={statusTone(m.action)}>{m.action}</Chip>
                </TCell>
                <TCell>
                  <div className="flex gap-1.5 opacity-60 transition-opacity group-hover:opacity-100">
                    {QUICK.map((a) => (
                      <Button key={a} variant="ghost" className="h-7 px-2 text-xs" onClick={() => act(m.id, a)}>
                        {a}
                      </Button>
                    ))}
                  </div>
                </TCell>
              </TRow>
            ))}
          </tbody>
        </Table>
      </div>
    </>
  );
}
