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

const ROLES: StaffRole[] = ["operator", "admin", "viewer"];

export default function MembersPage() {
  const [members, setMembers] = useState<Membership[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<StaffRole>("operator");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () =>
    api
      .listMembers()
      .then(setMembers)
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    void load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.createMember({
        username: username.trim(),
        password,
        name: name.trim() || undefined,
        role,
      });
      setNotice(`Created ${role} “${username.trim()}”. Share the username + password with them.`);
      setUsername("");
      setName("");
      setPassword("");
      setRole("operator");
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
        <PageHeader
          title="Members"
          subtitle="Create operator logins and manage org staff. Admin only."
        />
        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
        {notice && <p className="mb-4 text-sm text-emerald-600">{notice}</p>}

        <Card className="mb-5 px-5">
          <form onSubmit={create} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-44"
                placeholder="jdoe"
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-48"
                placeholder="Jane Doe (optional)"
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Temp password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-44"
                placeholder="At least 8 characters"
                autoComplete="new-password"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as StaffRole)}>
                <SelectTrigger className="h-8 w-32">
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
              {busy ? "Creating…" : "Create operator"}
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
              {members?.map((m) => {
                const display = m.name || m.username || m.userId;
                return (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={display} />
                        <div className="flex flex-col">
                          <span className="text-sm text-foreground">{display}</span>
                          {m.username && (
                            <span className="font-mono text-xs text-muted-foreground">
                              @{m.username}
                            </span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Chip tone={m.role === "admin" ? "info" : "neutral"}>{m.role}</Chip>
                    </TableCell>
                    <TableCell>
                      <Chip tone={statusTone(m.status)}>{m.status}</Chip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </>
  );
}
