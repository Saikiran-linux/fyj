"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function SignInPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await signIn.username({ username: username.trim(), password });
      if (res.error) {
        setError(res.error.message ?? "Invalid username or password");
        return;
      }
      router.push("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted px-4">
      <div className="w-full max-w-sm border border-border bg-card p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center bg-primary text-sm font-bold text-primary-foreground">
            f
          </div>
          <span className="font-heading text-[15px] font-semibold text-foreground">
            fyj Ops Console
          </span>
        </div>

        <h1 className="mb-1 font-heading text-xl font-bold text-foreground">Welcome back</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Sign in with the username your admin gave you.
        </p>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <Input
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            autoComplete="username"
            autoFocus
            className="h-10"
          />
          <Input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            className="h-10"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy} className="mt-1 h-10">
            {busy ? "…" : "Sign in"}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Accounts are created by your organization admin.
        </p>
      </div>
    </div>
  );
}
