import { cn } from "@/lib/utils";

/** Quick-action card: tinted emoji square, title, one-line description. */
export function ActionCard({
  emoji,
  tint,
  title,
  description,
  onClick,
}: {
  emoji: string;
  tint: string;
  title: string;
  description: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex flex-col items-start gap-2 border border-border bg-muted p-5 text-left",
        "transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-card hover:shadow-sm",
      )}
    >
      <span
        className="flex h-9 w-9 items-center justify-center text-lg"
        style={{ backgroundColor: tint }}
      >
        {emoji}
      </span>
      <span className="mt-1 text-[15px] font-semibold text-foreground">{title}</span>
      <span className="text-[13px] text-muted-foreground">{description}</span>
    </button>
  );
}
