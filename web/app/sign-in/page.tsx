"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn, signUp } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function SignInPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === "sign-in"
          ? await signIn.email({ email, password })
          : await signUp.email({ email, password, name: name || email });
      if (res.error) {
        setError(res.error.message ?? "Something went wrong");
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

        <h1 className="mb-1 font-heading text-xl font-bold text-foreground">
          {mode === "sign-in" ? "Welcome back" : "Create your workspace"}
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {mode === "sign-in"
            ? "Sign in to your operator account."
            : "Sign up — we’ll set up your org automatically."}
        </p>

        <form onSubmit={submit} className="flex flex-col gap-3">
          {mode === "sign-up" && (
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="h-10"
            />
          )}
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="h-10"
          />
          <Input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="h-10"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy} className="mt-1 h-10">
            {busy ? "…" : mode === "sign-in" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <button
          onClick={() => {
            setMode((m) => (m === "sign-in" ? "sign-up" : "sign-in"));
            setError(null);
          }}
          className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground"
        >
          {mode === "sign-in" ? "No account? Sign up" : "Have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
