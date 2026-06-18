"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/topbar";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, THead, TRow, TCell, EmptyRow } from "@/components/ui/table";
import { Avatar } from "@/components/ui/avatar";
import { Chip, statusTone } from "@/components/ui/chip";
import { api } from "@/lib/api";
import type { Membership, StaffRole } from "@/lib/types";

const ROLES: StaffRole[] = ["admin", "operator", "viewer"];

export default function MembersPage() {
  const [members, setMembers] = useState<Membership[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<StaffRole>("operator");
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .listMembers()
      .then(setMembers)
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    void load();
  }, []);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!userId.trim()) return;
    setBusy(true);
    try {
      await api.inviteMember(userId.trim(), role);
      setUserId("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Topbar title="Settings" />
      <div className="mx-auto max-w-4xl px-8 pb-16">
        <PageHeader title="Members" subtitle="Org staff and their roles. Admin only." />
        {error && <p className="mb-4 text-sm text-danger">{error}</p>}

        <Card className="mb-5">
          <form onSubmit={invite} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text-muted">User ID (Better Auth)</span>
              <input
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="h-9 w-72 rounded-sm border border-border bg-bg-subtle px-3 text-sm outline-none focus:border-primary/40 focus:bg-white"
                placeholder="usr_…"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text-muted">Role</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as StaffRole)}
                className="h-9 rounded-sm border border-border bg-bg-subtle px-3 text-sm outline-none focus:border-primary/40 focus:bg-white"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" disabled={busy}>
              {busy ? "Inviting…" : "Invite"}
            </Button>
          </form>
        </Card>

        <Table>
          <THead cols={["Member", "Role", "Status"]} />
          <tbody>
            {members === null && !error && <EmptyRow colSpan={3} label="Loading…" />}
            {members?.length === 0 && <EmptyRow colSpan={3} label="No members." />}
            {members?.map((m) => (
              <TRow key={m.id}>
                <TCell>
                  <div className="flex items-center gap-2.5">
                    <Avatar name={m.userId} />
                    <span className="font-mono text-xs text-text-muted">{m.userId}</span>
                  </div>
                </TCell>
                <TCell>
                  <Chip tone={m.role === "admin" ? "info" : "neutral"}>{m.role}</Chip>
                </TCell>
                <TCell>
                  <Chip tone={statusTone(m.status)}>{m.status}</Chip>
                </TCell>
              </TRow>
            ))}
          </tbody>
        </Table>
      </div>
    </>
  );
}
