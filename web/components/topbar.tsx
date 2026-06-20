"use client";

import { useRouter } from "next/navigation";
import { signOut, useSession } from "@/lib/auth-client";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

export function Topbar({ title }: { title?: string }) {
  const router = useRouter();
  const { data } = useSession();
  const name = data?.user?.name || data?.user?.email || "You";

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
        <button
          onClick={() => void signOut({}).then(() => router.push("/sign-in"))}
          className="flex items-center gap-2 py-1 pr-2 pl-1 transition-colors hover:bg-muted"
          title="Sign out"
        >
          <Avatar name={name} size={28} />
        </button>
      </div>
    </header>
  );
}
