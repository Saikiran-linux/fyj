import { cn } from "@/lib/cn";

type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const TONES: Record<Tone, string> = {
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  danger: "bg-danger/12 text-danger",
  info: "bg-info/12 text-info",
  neutral: "bg-bg-subtle text-text-faint",
};

export function Chip({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium",
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Map a domain status string to a chip tone. */
export function statusTone(status: string): Tone {
  switch (status) {
    case "active":
    case "placed":
    case "applied":
    case "shortlisted":
      return "success";
    case "paused":
    case "invited":
    case "saved":
      return "warning";
    case "archived":
    case "dismissed":
    case "disabled":
      return "neutral";
    default:
      return "info";
  }
}
