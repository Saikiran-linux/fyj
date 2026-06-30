"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Compass,
  Inbox,
  Users,
  Calendar,
  ChevronDown,
  Settings,
  LogOut,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { signOut, useSession } from "@/lib/auth-client";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

// The console's primary chrome (replaces the old icon rail). The design uses a
// top navbar — brand · nav · profile menu — which we render in the present look
// (square corners, neutral palette, Source Sans), not the mockup's mono/warm
// styling.
const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/review", label: "Review", icon: Inbox },
  { href: "/clients", label: "Candidates", icon: Users },
  { href: "/calendar", label: "Calendar", icon: Calendar },
];

function ProfileMenu() {
  const router = useRouter();
  const { data } = useSession();
  const name = data?.user?.name || data?.user?.email || "You";
  const email = data?.user?.email ?? "";
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 py-1 pr-2 pl-1 transition-colors hover:bg-muted"
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
        <div className="absolute right-0 top-[calc(100%+6px)] z-50 min-w-56 border border-border bg-popover p-1 text-popover-foreground shadow-md">
          <div className="flex items-center gap-2.5 px-2 py-2">
            <Avatar name={name} size={32} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{name}</div>
              {email && <div className="truncate text-xs text-muted-foreground">{email}</div>}
            </div>
          </div>
          <div className="my-1 h-px bg-border" />
          <Link
            href="/members"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-2 py-1.5 text-sm transition-colors hover:bg-muted"
          >
            <Users className="size-4 text-muted-foreground" />
            Members
          </Link>
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-2 py-1.5 text-sm transition-colors hover:bg-muted"
          >
            <Settings className="size-4 text-muted-foreground" />
            Settings
          </Link>
          <div className="my-1 h-px bg-border" />
          <button
            onClick={() => void signOut({}).then(() => router.push("/sign-in"))}
            className="flex w-full items-center gap-2.5 px-2 py-1.5 text-sm text-destructive transition-colors hover:bg-muted"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function Navbar() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
      <Link href="/" className="mr-2 flex items-center gap-2" aria-label="fyj home">
        <span className="flex h-7 w-7 items-center justify-center bg-primary text-sm font-bold text-primary-foreground">
          f
        </span>
        <span className="text-sm font-bold tracking-tight">fyj</span>
      </Link>

      <nav className="flex items-center gap-1">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(href) ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors",
              isActive(href)
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            <span className="hidden md:inline">{label}</span>
          </Link>
        ))}
      </nav>

      <div className="ml-auto">
        <ProfileMenu />
      </div>
    </header>
  );
}
