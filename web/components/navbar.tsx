"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  Calendar,
  ChevronDown,
  Compass,
  ExternalLink,
  FlaskConical,
  Inbox,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MessagesSquare,
  PenLine,
  Settings,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { signOut, useSession } from "@/lib/auth-client";
import { Avatar } from "@/components/ui/avatar";
import { DotBlock } from "@/components/primitives";
import { PreferencesDialog } from "@/components/preferences-dialog";
import { cn } from "@/lib/utils";

// The console's primary chrome, in the prototype's icon-forward style (f-154):
// icon-only destinations with hover tooltips, an accent underline on the active
// item, and a badge slot for unread counts. `badge` stays undefined until the
// worklist/messaging backends land (f-157/f-158) — don't fake counts.
const NAV: { href: string; label: string; icon: LucideIcon; badge?: () => number | null }[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/chat", label: "Chat", icon: MessagesSquare },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/review", label: "Review", icon: ListChecks },
  { href: "/clients", label: "Candidates", icon: Users },
  { href: "/write", label: "Write", icon: PenLine },
  { href: "/calendar", label: "Calendar", icon: Calendar },
];

function ProfileMenu() {
  const router = useRouter();
  const { data } = useSession();
  const name = data?.user?.name || data?.user?.email || "You";
  const email = data?.user?.email ?? "";
  const [open, setOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const item =
    "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg py-1 pr-2 pl-1 transition-colors hover:bg-muted"
        title={name}
      >
        <Avatar name={name} size={28} />
        <span className="hidden max-w-[12ch] truncate text-sm font-medium sm:block">
          {name.split(/[\s@]/)[0]}
        </span>
        <ChevronDown
          className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-50 min-w-56 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md">
          <div className="flex items-center gap-2.5 px-2 py-2">
            <Avatar name={name} size={32} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{name}</div>
              {email && <div className="truncate text-xs text-muted-foreground">{email}</div>}
            </div>
          </div>
          <div className="my-1 h-px bg-border" />
          <Link href="/members" onClick={() => setOpen(false)} className={item}>
            <Users className="size-4 text-muted-foreground" />
            Members
          </Link>
          <Link href="/tools/tailor-lab" onClick={() => setOpen(false)} className={item}>
            <FlaskConical className="size-4 text-muted-foreground" />
            Tailor Lab
          </Link>
          <button
            onClick={() => {
              setOpen(false);
              setPrefsOpen(true);
            }}
            className={cn(item, "w-full")}
          >
            <SlidersHorizontal className="size-4 text-muted-foreground" />
            Preferences
          </button>
          <Link href="/settings" onClick={() => setOpen(false)} className={item}>
            <Settings className="size-4 text-muted-foreground" />
            Settings
          </Link>
          <div className="my-1 h-px bg-border" />
          <Link href="/portal" onClick={() => setOpen(false)} className={item}>
            <ExternalLink className="size-4 text-muted-foreground" />
            Candidate portal
          </Link>
          <button
            onClick={() => void signOut({}).then(() => router.push("/sign-in"))}
            className={cn(item, "w-full text-destructive")}
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      )}

      <PreferencesDialog open={prefsOpen} onClose={() => setPrefsOpen(false)} />
    </div>
  );
}

export function Navbar() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md">
      <Link href="/" className="mr-2 flex items-center gap-2.5" aria-label="fyj home">
        <span className="flex size-7 items-center justify-center rounded-lg bg-foreground">
          <DotBlock pattern={["1 1", "111", "1 1"]} color="var(--background)" size={4.5} />
        </span>
        <span className="font-mono text-sm font-bold tracking-tight">fyj</span>
      </Link>

      <nav className="flex items-center gap-0.5">
        {NAV.map(({ href, label, icon: Icon, badge }) => {
          const active = isActive(href);
          const count = badge?.() ?? null;
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex size-9 items-center justify-center rounded-lg transition-colors",
                active
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-[17px]" />
              {count != null && count > 0 && (
                <span className="absolute right-0.5 top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-primary px-0.5 font-mono text-[9px] font-semibold text-primary-foreground">
                  {count}
                </span>
              )}
              {active && (
                <span className="absolute inset-x-2.5 -bottom-[3px] h-0.5 rounded-full bg-primary" />
              )}
              <span className="pointer-events-none absolute top-[calc(100%+8px)] left-1/2 z-30 -translate-x-1/2 translate-y-[-3px] whitespace-nowrap rounded-md bg-foreground px-2 py-1 font-mono text-[11px] text-background opacity-0 shadow-sm transition-all group-hover:translate-y-0 group-hover:opacity-100">
                {label}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto">
        <ProfileMenu />
      </div>
    </header>
  );
}
