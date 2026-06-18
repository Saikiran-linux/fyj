"use client";

import { useRouter } from "next/navigation";
import { signOut, useSession } from "@/lib/auth-client";
import { Avatar } from "@/components/ui/avatar";

export function Topbar({ title }: { title?: string }) {
  const router = useRouter();
  const { data } = useSession();
  const name = data?.user?.name || data?.user?.email || "You";

  return (
    <header className="flex h-14 items-center justify-between px-8">
      <div className="text-sm font-medium text-text-muted">{title ?? ""}</div>
      <div className="flex items-center gap-3">
        <span className="rounded-sm bg-bg-subtle px-2 py-1 text-xs text-text-muted">beta</span>
        <button
          aria-label="Help"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-bg-subtle hover:text-text"
        >
          ?
        </button>
        <button
          onClick={() => void signOut({}).then(() => router.push("/sign-in"))}
          className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-bg-subtle"
          title="Sign out"
        >
          <Avatar name={name} size={28} />
        </button>
      </div>
    </header>
  );
}
