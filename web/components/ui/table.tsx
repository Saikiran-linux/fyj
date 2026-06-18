import { cn } from "@/lib/cn";

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-white">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function THead({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr className="border-b border-border">
        {cols.map((c) => (
          <th
            key={c}
            className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-text-faint"
          >
            {c}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export function TRow({ children }: { children: React.ReactNode }) {
  return (
    <tr className="group border-b border-border last:border-0 transition-colors hover:bg-bg-subtle">
      {children}
    </tr>
  );
}

export function TCell({
  children,
  muted,
  className,
}: {
  children: React.ReactNode;
  muted?: boolean;
  className?: string;
}) {
  return (
    <td className={cn("px-4 py-3 align-middle", muted && "text-text-muted", className)}>
      {children}
    </td>
  );
}

export function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-text-faint">
        {label}
      </td>
    </tr>
  );
}
