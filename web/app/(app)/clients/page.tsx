"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, THead, TRow, TCell, EmptyRow } from "@/components/ui/table";
import { Avatar } from "@/components/ui/avatar";
import { Chip, statusTone } from "@/components/ui/chip";
import { api } from "@/lib/api";
import type { Client } from "@/lib/types";

export default function ClientsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [clients, setClients] = useState<Client[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .listClients()
      .then(setClients)
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    void load();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) return;
    setBusy(true);
    try {
      await api.createClient({ fullName: fullName.trim(), email: email.trim() || undefined });
      setFullName("");
      setEmail("");
      setCreating(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Topbar title="Clients" />
      <div className="mx-auto max-w-5xl px-8 pb-16">
        <PageHeader
          title="Clients"
          subtitle="Job-seekers you represent."
          action={<Button onClick={() => setCreating((v) => !v)}>+ New client</Button>}
        />

        {creating && (
          <Card className="mb-5">
            <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-text-muted">Full name</span>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="h-9 w-56 rounded-sm border border-border bg-bg-subtle px-3 text-sm outline-none focus:border-primary/40 focus:bg-white"
                  placeholder="Jane Doe"
                  autoFocus
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-text-muted">Email (optional)</span>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-9 w-64 rounded-sm border border-border bg-bg-subtle px-3 text-sm outline-none focus:border-primary/40 focus:bg-white"
                  placeholder="jane@example.com"
                />
              </label>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Create"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </form>
          </Card>
        )}

        <Table>
          <THead cols={["Name", "Status", "Email", "Portal", "Created"]} />
          <tbody>
            {error && <EmptyRow colSpan={5} label={`Couldn’t load — ${error}`} />}
            {!error && clients === null && <EmptyRow colSpan={5} label="Loading…" />}
            {!error && clients?.length === 0 && <EmptyRow colSpan={5} label="No clients yet." />}
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
    </>
  );
}
