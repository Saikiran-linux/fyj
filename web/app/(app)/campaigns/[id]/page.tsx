"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
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
        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

        <div className="border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                {["#", "Job", "Score", "Status", "Actions"].map((c) => (
                  <TableHead key={c}>{c}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {matches === null && !error && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {matches?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    No matches yet — the matcher runs hourly.
                  </TableCell>
                </TableRow>
              )}
              {matches?.map((m) => (
                <TableRow key={m.id} className="group">
                  <TableCell className="text-muted-foreground">{m.rank ?? "—"}</TableCell>
                  <TableCell>
                    <span className="font-mono text-xs text-muted-foreground">
                      {m.jobId.slice(0, 8)}…
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <span className="tabular-nums">{m.score?.toFixed(3) ?? "—"}</span>
                  </TableCell>
                  <TableCell>
                    <Chip tone={statusTone(m.action)}>{m.action}</Chip>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1.5 opacity-60 transition-opacity group-hover:opacity-100">
                      {QUICK.map((a) => (
                        <Button
                          key={a}
                          variant="ghost"
                          size="sm"
                          className="text-xs"
                          onClick={() => act(m.id, a)}
                        >
                          {a}
                        </Button>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </>
  );
}
