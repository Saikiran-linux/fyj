import { Placeholder } from "@/components/placeholder";
import Link from "next/link";

export default function SettingsPage() {
  return (
    <div>
      <Placeholder
        title="Settings"
        note="Org + account settings. Member management lives under Members."
      />
      <div className="mx-auto -mt-10 max-w-5xl px-8">
        <Link href="/members" className="text-sm font-medium text-primary hover:underline">
          → Manage members
        </Link>
      </div>
    </div>
  );
}
