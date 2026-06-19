"use client";

import { useState } from "react";
import { Search, ArrowUp } from "lucide-react";

/**
 * The hero "ask anything / search jobs" input. Submits a free-text query the
 * Jobs page embeds against the index (search_jobs). onSubmit is the hook.
 */
export function CommandBar({ onSubmit }: { onSubmit?: (q: string) => void }) {
  const [q, setQ] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) onSubmit?.(q.trim());
      }}
      className="flex h-14 items-center gap-3 border border-border bg-muted px-4 transition-all focus-within:border-ring focus-within:bg-card focus-within:ring-3 focus-within:ring-ring/30"
    >
      <Search className="size-4 text-muted-foreground" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Ask anything or search jobs…"
        className="h-full flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
      <button
        type="submit"
        aria-label="Submit"
        className="flex h-8 w-8 items-center justify-center bg-primary text-primary-foreground transition-colors hover:bg-primary/80"
      >
        <ArrowUp className="size-4" />
      </button>
    </form>
  );
}
