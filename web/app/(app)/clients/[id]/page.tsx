"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

        <PageHeader
          title={client?.fullName ?? "Client"}
          subtitle={client?.email ?? undefined}
          action={client && <Chip tone={statusTone(client.status)}>{client.status}</Chip>}
        />

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Card className="px-5 lg:col-span-1">
            <div className="flex items-center gap-3">
              <Avatar name={client?.fullName ?? "?"} size={40} />
              <div>
                <div className="font-medium text-foreground">{client?.fullName ?? "—"}</div>
                <div className="text-xs text-muted-foreground">
                  Portal {client?.portalEnabled ? "enabled" : "off"}
                </div>
              </div>
            </div>
            {client?.notes && <p className="mt-4 text-sm text-muted-foreground">{client.notes}</p>}
          </Card>

          <Card className="px-5 lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-heading text-[15px] font-semibold text-foreground">
                Targeting profiles
              </h2>
            </div>

            <form onSubmit={addProfile} className="mb-4 flex items-end gap-2">
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Senior Backend — remote EU"
                className="flex-1"
              />
              <Button type="submit" disabled={busy}>
                {busy ? "Adding…" : "Add profile"}
              </Button>
            </form>

            <div className="divide-y divide-border">
              {profiles === null && <p className="py-3 text-sm text-muted-foreground">Loading…</p>}
              {profiles?.length === 0 && (
                <p className="py-3 text-sm text-muted-foreground">
                  No profiles yet — add one to start a campaign.
                </p>
              )}
              {profiles?.map((p) => (
                <ProfileRow key={p.id} clientId={id} profile={p} onChange={loadProfiles} />
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

/**
 * One targeting profile: shows embed status and lets staff upload a resume
 * (PDF/DOCX/text). The upload route summarizes → embeds → flips the profile to
 * "embedded", after which the job matches link is live.
 */
function ProfileRow({
  clientId,
  profile,
  onChange,
}: {
  clientId: string;
  profile: ClientProfile;
  onChange: () => Promise<unknown>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-uploading the same filename
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      await api.uploadResume(clientId, profile.id, file);
      await onChange();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">{profile.label}</div>
        {err && <div className="mt-0.5 text-xs text-destructive">{err}</div>}
      </div>
      <div className="flex items-center gap-2">
        {profile.embeddedAt && (
          <Link
            href={`/jobs?profile=${profile.id}`}
            className="text-xs font-medium text-primary hover:underline"
          >
            View jobs →
          </Link>
        )}
        <Chip tone={profile.embeddedAt ? "success" : "warning"}>
          {busy ? "embedding…" : profile.embeddedAt ? "embedded" : "needs embed"}
        </Chip>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.txt,.md,application/pdf"
          className="hidden"
          onChange={onPick}
        />
        <Button variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
          {profile.embeddedAt ? "Replace" : "Upload resume"}
        </Button>
      </div>
    </div>
  );
}
