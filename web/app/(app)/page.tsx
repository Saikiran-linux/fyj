"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { CommandBar } from "@/components/command-bar";
import { ActionCard } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { Table, THead, TRow, TCell, EmptyRow } from "@/components/ui/table";
import { Avatar } from "@/components/ui/avatar";
import { Chip, statusTone } from "@/components/ui/chip";
import { useSession } from "@/lib/auth-client";
import { api } from "@/lib/api";
import type { Client } from "@/lib/types";

const ACTIONS = [
  { emoji: "🔎", tint: "#EFF4FF", title: "Find jobs", description: "Search the index for a client", href: "/jobs" },
  { emoji: "👤", tint: "#DCFCE7", title: "Add client", description: "Onboard a new job-seeker", href: "/clients?new=1" },
  { emoji: "📣", tint: "#FEF3C7", title: "New campaign", description: "Start continuous matching", href: "/campaigns" },
  { emoji: "🧩", tint: "#FCE7F3", title: "From template", description: "Reuse a targeting profile", href: "/clients" },
];

export default function DashboardPage() {
  const router = useRouter();
  const { data } = useSession();
  const firstName = (data?.user?.name || data?.user?.email || "there").split(/[\s@]/)[0];

  const [tab, setTab] = useState("All");
  const [clients, setClients] = useState<Client[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listClients()
      .then(setClients)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <>
      <Topbar />
      <div className="mx-auto max-w-5xl px-8 pb-16">
        <h1 className="mb-5 mt-2 text-[28px] font-bold tracking-tight text-text">
          Hey {firstName}, ready to get started?
        </h1>

        <CommandBar onSubmit={(q) => router.push(`/jobs?q=${encodeURIComponent(q)}`)} />

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ACTIONS.map((a) => (
            <ActionCard key={a.title} {...a} onClick={() => router.push(a.href)} />
          ))}
        </div>

        <div className="mt-10">
          <div className="mb-3">
            <Tabs tabs={["All", "Recents", "Favorites"]} active={tab} onChange={setTab} />
          </div>

          <Table>
            <THead cols={["Name", "Status", "Email", "Portal", "Created"]} />
            <tbody>
              {error && <EmptyRow colSpan={5} label={`Couldn’t load clients — ${error}`} />}
              {!error && clients === null && <EmptyRow colSpan={5} label="Loading…" />}
              {!error && clients?.length === 0 && (
                <EmptyRow colSpan={5} label="No clients yet. Add your first one." />
              )}
              {clients?.map((c) => (
                <TRow key={c.id}>
                  <TCell>
                    <button
                      onClick={() => router.push(`/clients/${c.id}`)}
                      className="flex items-center gap-2.5 font-medium text-text hover:text-primary"
                    >
                      <Avatar name={c.fullName} />
                      {c.fullName}
                    </button>
                  </TCell>
                  <TCell>
                    <Chip tone={statusTone(c.status)}>{c.status}</Chip>
                  </TCell>
                  <TCell muted>{c.email ?? "—"}</TCell>
                  <TCell muted>{c.portalEnabled ? "Enabled" : "Off"}</TCell>
                  <TCell muted>{new Date(c.createdAt).toLocaleDateString()}</TCell>
                </TRow>
              ))}
            </tbody>
          </Table>
        </div>
      </div>
    </>
  );
}
