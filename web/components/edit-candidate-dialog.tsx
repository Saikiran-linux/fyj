"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Chip } from "@/components/ui/chip";
import { api } from "@/lib/api";
import type { Client, ClientProfile, ClientStatus, ConsentStatus } from "@/lib/types";

const STATUSES: ClientStatus[] = ["active", "paused", "placed", "archived"];
const CONSENTS: ConsentStatus[] = ["active", "pending", "revoked"];

/**
 * Edit-candidate modal — full candidate detail in one enterprise-style dialog:
 * editable core fields (name / headline / email / phone / status / consent /
 * notes) plus a read-only view of the candidate's campaigns + parsed résumé.
 */
export function EditCandidateDialog({
  client,
  profiles,
  onClose,
  onSaved,
}: {
  client: Client;
  profiles: ClientProfile[] | null;
  onClose: () => void;
  onSaved: (c: Client) => void;
}) {
  const [fullName, setFullName] = useState(client.fullName);
  const [headline, setHeadline] = useState(client.headline ?? "");
  const [email, setEmail] = useState(client.email ?? "");
  const [phone, setPhone] = useState(client.phone ?? "");
  const [status, setStatus] = useState<ClientStatus>(client.status);
  const [consentStatus, setConsentStatus] = useState<ConsentStatus>(client.consentStatus);
  const [notes, setNotes] = useState(client.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openResume, setOpenResume] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  async function save() {
    if (!fullName.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateClient(client.id, {
        fullName: fullName.trim(),
        headline: headline.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        status,
        consentStatus,
        notes: notes.trim() || null,
      });
      onSaved(updated);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div
        className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-lg"
        role="dialog"
        aria-modal="true"
      >
        {/* header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-heading text-lg tracking-tight">Edit candidate</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

          <div className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="ec-name">Full name</Label>
              <Input id="ec-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="ec-headline">Headline</Label>
              <Input
                id="ec-headline"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder="e.g. Senior Backend Engineer"
              />
            </div>
            <div>
              <Label htmlFor="ec-email">Email</Label>
              <Input id="ec-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ec-phone">Phone</Label>
              <Input id="ec-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ClientStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Consent</Label>
              <Select value={consentStatus} onValueChange={(v) => setConsentStatus(v as ConsentStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONSENTS.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="ec-notes">Notes</Label>
              <Textarea
                id="ec-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Internal notes about this candidate…"
              />
            </div>
          </div>

          {/* campaigns + résumé (read-only) */}
          <div className="mt-6">
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              Campaigns &amp; résumé
            </div>
            <div className="mt-2 flex flex-col gap-2">
              {profiles === null && <p className="text-sm text-muted-foreground">Loading…</p>}
              {profiles?.length === 0 && (
                <p className="text-sm text-muted-foreground">No campaigns yet.</p>
              )}
              {profiles?.map((p) => (
                <div key={p.id} className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{p.label}</span>
                    <Chip tone={p.embeddedAt ? "success" : "neutral"}>
                      {p.embeddedAt ? "résumé embedded" : "no résumé"}
                    </Chip>
                  </div>
                  {p.resumeText && (
                    <>
                      <button
                        onClick={() => setOpenResume(openResume === p.id ? null : p.id)}
                        className="mt-1 text-xs text-primary hover:underline"
                      >
                        {openResume === p.id ? "Hide résumé" : "View résumé"}
                      </button>
                      {openResume === p.id && (
                        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                          {p.resumeText}
                        </pre>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
