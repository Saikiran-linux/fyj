import { Badge } from "@/components/ui/badge";

// A lightweight per-page title strip. Identity + sign-out now live in the global
// top navbar (components/navbar.tsx), so this no longer renders the user avatar.
export function Topbar({ title }: { title?: string }) {
  return (
    <header className="flex h-14 items-center justify-between px-8">
      <div className="text-sm font-medium text-muted-foreground">{title ?? ""}</div>
      <div className="flex items-center gap-3">
        <Badge variant="secondary">beta</Badge>
        <button
          aria-label="Help"
          className="flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          ?
        </button>
      </div>
    </header>
  );
}
