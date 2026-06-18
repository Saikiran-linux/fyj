import { cn } from "@/lib/cn";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg border border-border bg-white p-5 shadow-sm", className)}
      {...props}
    />
  );
}

/** Clay-style quick-action card: tinted emoji square, title, one-line description. */
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
        "group flex flex-col items-start gap-2 rounded-lg border border-border bg-bg-subtle p-5 text-left",
        "transition-all hover:-translate-y-0.5 hover:border-text-faint/40 hover:bg-white hover:shadow",
      )}
    >
      <span
        className="flex h-9 w-9 items-center justify-center rounded text-lg"
        style={{ backgroundColor: tint }}
      >
        {emoji}
      </span>
      <span className="mt-1 text-[15px] font-semibold text-text">{title}</span>
      <span className="text-[13px] text-text-muted">{description}</span>
    </button>
  );
}
