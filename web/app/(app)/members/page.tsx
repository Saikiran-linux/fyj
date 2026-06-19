"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/topbar";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

        <Card className="mb-5 px-5">
          <form onSubmit={invite} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="userId">User ID (Better Auth)</Label>
              <Input
                id="userId"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="w-72"
                placeholder="usr_…"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as StaffRole)}>
                <SelectTrigger className="h-8 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? "Inviting…" : "Invite"}
            </Button>
          </form>
        </Card>

        <div className="border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                {["Member", "Role", "Status"].map((c) => (
                  <TableHead key={c}>{c}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members === null && !error && (
                <TableRow>
                  <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {members?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                    No members.
                  </TableCell>
                </TableRow>
              )}
              {members?.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={m.userId} />
                      <span className="font-mono text-xs text-muted-foreground">{m.userId}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Chip tone={m.role === "admin" ? "info" : "neutral"}>{m.role}</Chip>
                  </TableCell>
                  <TableCell>
                    <Chip tone={statusTone(m.status)}>{m.status}</Chip>
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
