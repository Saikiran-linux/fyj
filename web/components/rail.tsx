"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Megaphone, Search, KanbanSquare, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/jobs", label: "Jobs", icon: Search },
  { href: "/tracker", label: "Tracker", icon: KanbanSquare },
] as const;

const BOTTOM = [{ href: "/settings", label: "Settings", icon: Settings }] as const;

function RailLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-10 w-10 items-center justify-center transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="size-5" />
      <span className="pointer-events-none absolute left-12 z-10 hidden whitespace-nowrap bg-foreground px-2 py-1 text-xs text-background group-hover:block">
        {label}
      </span>
    </Link>
  );
}

export function Rail() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-border bg-sidebar py-4">
      <div className="mb-3 flex h-9 w-9 items-center justify-center bg-primary text-sm font-bold text-primary-foreground">
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
