"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { CommandBar } from "@/components/command-bar";
import { ActionCard } from "@/components/action-card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
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
        <h1 className="mb-5 mt-2 font-heading text-[28px] font-bold tracking-tight text-foreground">
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
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList variant="line">
                {["All", "Recents", "Favorites"].map((t) => (
                  <TabsTrigger key={t} value={t}>
                    {t}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          <div className="border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  {["Name", "Status", "Email", "Portal", "Created"].map((c) => (
                    <TableHead key={c}>{c}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {error && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      Couldn’t load clients — {error}
                    </TableCell>
                  </TableRow>
                )}
                {!error && clients === null && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                )}
                {!error && clients?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      No clients yet. Add your first one.
                    </TableCell>
                  </TableRow>
                )}
                {clients?.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <button
                        onClick={() => router.push(`/clients/${c.id}`)}
                        className="flex items-center gap-2.5 font-medium text-foreground hover:text-primary"
                      >
                        <Avatar name={c.fullName} />
                        {c.fullName}
                      </button>
                    </TableCell>
                    <TableCell>
                      <Chip tone={statusTone(c.status)}>{c.status}</Chip>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.email ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.portalEnabled ? "Enabled" : "Off"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(c.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </>
  );
}
