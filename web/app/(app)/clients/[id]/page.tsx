"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Chip, statusTone } from "@/components/ui/chip";
import { api } from "@/lib/api";
import type { Client, ClientProfile } from "@/lib/types";

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [client, setClient] = useState<Client | null>(null);
  const [profiles, setProfiles] = useState<ClientProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const loadProfiles = () => api.listProfiles(id).then(setProfiles);

  useEffect(() => {
    api.getClient(id).then(setClient).catch((e: Error) => setError(e.message));
    loadProfiles().catch((e: Error) => setError(e.message));
  }, [id]);

  async function addProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setBusy(true);
    try {
      await api.createProfile(id, { label: label.trim() });
      setLabel("");
      await loadProfiles();
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
        {error && <p className="mb-4 text-sm text-danger">{error}</p>}

        <PageHeader
          title={client?.fullName ?? "Client"}
          subtitle={client?.email ?? undefined}
          action={client && <Chip tone={statusTone(client.status)}>{client.status}</Chip>}
        />

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <div className="flex items-center gap-3">
              <Avatar name={client?.fullName ?? "?"} size={40} />
              <div>
                <div className="font-medium text-text">{client?.fullName ?? "—"}</div>
                <div className="text-xs text-text-muted">
                  Portal {client?.portalEnabled ? "enabled" : "off"}
                </div>
              </div>
            </div>
            {client?.notes && <p className="mt-4 text-sm text-text-muted">{client.notes}</p>}
          </Card>

          <Card className="lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-text">Targeting profiles</h2>
            </div>

            <form onSubmit={addProfile} className="mb-4 flex items-end gap-2">
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Senior Backend — remote EU"
                className="h-9 flex-1 rounded-sm border border-border bg-bg-subtle px-3 text-sm outline-none focus:border-primary/40 focus:bg-white"
              />
              <Button type="submit" disabled={busy}>
                {busy ? "Adding…" : "Add profile"}
              </Button>
            </form>

            <div className="divide-y divide-border">
              {profiles === null && <p className="py-3 text-sm text-text-faint">Loading…</p>}
              {profiles?.length === 0 && (
                <p className="py-3 text-sm text-text-faint">
                  No profiles yet — add one to start a campaign.
                </p>
              )}
              {profiles?.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-3">
                  <span className="text-sm font-medium text-text">{p.label}</span>
                  <Chip tone={p.embeddedAt ? "success" : "warning"}>
                    {p.embeddedAt ? "embedded" : "needs embed"}
                  </Chip>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
