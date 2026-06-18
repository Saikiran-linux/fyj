"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

// Minimal monochrome line icons (stroke=currentColor), no icon dependency.
const Icon = ({ d }: { d: string }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

const NAV = [
  { href: "/", label: "Dashboard", d: "M3 11l9-8 9 8M5 10v10h14V10" },
  { href: "/clients", label: "Clients", d: "M16 19v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6M22 19v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11" },
  { href: "/campaigns", label: "Campaigns", d: "M3 11l18-5v12L3 14v-3zM3 11v3M7 12v6a2 2 0 0 0 4 0v-4" },
  { href: "/jobs", label: "Jobs", d: "M21 21l-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z" },
  { href: "/tracker", label: "Tracker", d: "M4 4h6v16H4zM14 4h6v10h-6z" },
] as const;

const BOTTOM = [{ href: "/settings", label: "Settings", d: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.81 1.17V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3.6 14a1.65 1.65 0 0 0-1.51-1H2a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 3.6 8M21 12h-.09" }] as const;

function RailLink({ href, label, d, active }: { href: string; label: string; d: string; active: boolean }) {
  return (
    <Link
      href={href}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
        active ? "bg-primary-tint text-primary" : "text-text-muted hover:bg-bg-subtle hover:text-text",
      )}
    >
      <Icon d={d} />
      <span className="pointer-events-none absolute left-12 z-10 hidden whitespace-nowrap rounded-sm bg-text px-2 py-1 text-xs text-white group-hover:block">
        {label}
      </span>
    </Link>
  );
}

export function Rail() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-border bg-bg-rail py-4">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">
        f
      </div>
      {NAV.map((n) => (
        <RailLink key={n.href} {...n} active={isActive(n.href)} />
      ))}
      <div className="mt-auto">
        {BOTTOM.map((n) => (
          <RailLink key={n.href} {...n} active={isActive(n.href)} />
        ))}
      </div>
    </nav>
  );
}
