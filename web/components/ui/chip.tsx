import { cn } from "@/lib/utils";

/**
 * Status chip — a semantic-tone badge. Built on the shadcn Badge look (same
 * size/shape) but with success/warning/info tones the neutral base doesn't
 * ship. `danger` maps to shadcn's `destructive`.
 */
type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const TONES: Record<Tone, string> = {
  success: "bg-success/12 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-destructive/12 text-destructive",
  info: "bg-info/12 text-info",
  neutral: "bg-muted text-muted-foreground",
};

export function Chip({
  tone = "neutral",
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 px-2 py-0.5 text-xs font-medium whitespace-nowrap",
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
