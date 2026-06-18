"use client";

import { useState } from "react";

/**
 * The hero "ask anything / search jobs" input (Clay's command bar). Visual +
 * local-state today; wires to the index search_jobs RPC in a later step (f-132
 * is live, the Jobs page will consume it). onSubmit is a hook for that.
 */
export function CommandBar({ onSubmit }: { onSubmit?: (q: string) => void }) {
  const [q, setQ] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) onSubmit?.(q.trim());
      }}
      className="flex h-14 items-center gap-3 rounded-lg border border-border bg-bg-subtle px-4 transition-all focus-within:border-primary/40 focus-within:bg-white focus-within:shadow"
    >
      <span className="text-lg">✦</span>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Ask anything or search jobs…"
        className="h-full flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
      />
      <button
        type="submit"
        aria-label="Submit"
        className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white hover:bg-primary-hover"
      >
        ↑
      </button>
    </form>
  );
}
