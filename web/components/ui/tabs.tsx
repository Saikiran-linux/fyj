"use client";

import { cn } from "@/lib/cn";

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: string[];
  active: string;
  onChange: (t: string) => void;
}) {
  return (
    <div className="flex items-center gap-5 border-b border-border">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={cn(
            "-mb-px border-b-2 pb-2 text-sm transition-colors",
            t === active
              ? "border-text font-medium text-text"
              : "border-transparent text-text-muted hover:text-text",
          )}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
