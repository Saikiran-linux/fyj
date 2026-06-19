"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
                    Couldn’t load — {error}
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
                    No clients yet.
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
    </>
  );
}
