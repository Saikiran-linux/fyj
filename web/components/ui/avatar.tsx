import { cn } from "@/lib/cn";

const TINTS = ["#EFF4FF", "#FEF3C7", "#DCFCE7", "#FCE7F3", "#E0F2FE", "#EDE9FE"];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function Avatar({ name, size = 26 }: { name: string; size?: number }) {
  // Deterministic tint from the name so a person keeps the same color.
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const tint = TINTS[hash % TINTS.length];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-text ring-1 ring-border",
      )}
      style={{ width: size, height: size, backgroundColor: tint }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}
