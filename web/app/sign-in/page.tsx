"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn, signUp } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

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
    <div className="flex min-h-screen items-center justify-center bg-bg-subtle px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">
            f
          </div>
          <span className="text-[15px] font-semibold text-text">fyj Ops Console</span>
        </div>

        <h1 className="mb-1 text-xl font-bold text-text">
          {mode === "sign-in" ? "Welcome back" : "Create your workspace"}
        </h1>
        <p className="mb-6 text-sm text-text-muted">
          {mode === "sign-in"
            ? "Sign in to your operator account."
            : "Sign up — we’ll set up your org automatically."}
        </p>

        <form onSubmit={submit} className="flex flex-col gap-3">
          {mode === "sign-up" && (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="h-10 rounded-sm border border-border bg-bg-subtle px-3 text-sm outline-none focus:border-primary/40 focus:bg-white"
            />
          )}
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="h-10 rounded-sm border border-border bg-bg-subtle px-3 text-sm outline-none focus:border-primary/40 focus:bg-white"
          />
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="h-10 rounded-sm border border-border bg-bg-subtle px-3 text-sm outline-none focus:border-primary/40 focus:bg-white"
          />
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" disabled={busy} className="mt-1 h-10">
            {busy ? "…" : mode === "sign-in" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <button
          onClick={() => {
            setMode((m) => (m === "sign-in" ? "sign-up" : "sign-in"));
            setError(null);
          }}
          className="mt-4 w-full text-center text-sm text-text-muted hover:text-text"
        >
          {mode === "sign-in" ? "No account? Sign up" : "Have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
