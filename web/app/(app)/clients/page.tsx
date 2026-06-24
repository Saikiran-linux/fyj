"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar } from "@/components/ui/avatar";
import { Chip, statusTone } from "@/components/ui/chip";
import { api } from "@/lib/api";
import type { Client, ConsentStatus } from "@/lib/types";

function consentTone(consent: ConsentStatus) {
  return consent === "active" ? "success" : consent === "pending" ? "warning" : "danger";
}

export default function CandidatesPage() {
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
      <Topbar title="Candidates" />
      <div className="mx-auto max-w-6xl px-8 pb-16">
        <PageHeader
          title="Candidates"
          subtitle="The job-seekers you represent."
          action={<Button onClick={() => setCreating((v) => !v)}>+ Add candidate</Button>}
        />

        {creating && (
          <Card className="mb-5 px-5">
            <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="fullName">Full name</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-56"
                  placeholder="Jane Doe"
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email (optional)</Label>
                <Input
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-64"
                  placeholder="jane@example.com"
                />
              </div>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Create"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </form>
          </Card>
        )}

        {error && (
          <div className="mb-4 border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            Couldn&rsquo;t load candidates — {error}
          </div>
        )}
        {!error && clients === null && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!error && clients?.length === 0 && (
          <div className="border border-border bg-card px-6 py-16 text-center text-sm text-muted-foreground">
            No candidates yet. Add your first one.
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clients?.map((c) => (
            <button
              key={c.id}
              onClick={() => router.push(`/clients/${c.id}`)}
              className="flex flex-col gap-3 border border-border bg-card p-4 text-left transition-colors hover:bg-muted/40"
            >
              <div className="flex items-center gap-3">
                <Avatar name={c.fullName} size={36} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{c.fullName}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {c.headline ?? c.email ?? "—"}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip tone={statusTone(c.status)}>{c.status}</Chip>
                <Chip tone={consentTone(c.consentStatus)}>consent: {c.consentStatus}</Chip>
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
