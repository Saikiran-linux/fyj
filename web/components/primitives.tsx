"use client";

/**
 * Presentational primitives ported from the operator-dashboard prototype
 * (f-154, dash-primitives.jsx): fit score, company marks, dot-matrix charts,
 * braille loaders. Colors ride the design tokens so the runtime accent
 * (Preferences) propagates: --primary/--success/--warning/--secondary.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/* ---------------- Fit score ------------------------------------------ */

export function fitColor(score: number): string {
  return score >= 80 ? "var(--success)" : score >= 64 ? "var(--primary)" : "var(--warning)";
}

export function FitScore({ score, className }: { score: number; className?: string }) {
  const col = fitColor(score);
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-xs font-medium", className)}
      style={{ color: col }}
    >
      <span className="h-1 w-9 flex-none overflow-hidden rounded-full bg-secondary">
        <i
          className="block h-full rounded-full"
          style={{ width: `${Math.max(0, Math.min(100, score))}%`, background: col }}
        />
      </span>
      <span className="tabular-nums">{score}</span>
    </span>
  );
}

/* ---------------- Company marks --------------------------------------- */

// Brand colors for well-known companies (from the prototype's fixture set).
// Anything else gets a monogram on a deterministic hue from the name.
const BRANDS: Record<string, { color: string; fg: string; mark?: "tri" | "figma" | "burst" | "stripe" }> = {
  stripe: { color: "#635bff", fg: "#fff", mark: "stripe" },
  databricks: { color: "#ff3621", fg: "#fff" },
  ramp: { color: "#11181c", fg: "#ffd43b" },
  anthropic: { color: "#d97757", fg: "#fff", mark: "burst" },
  figma: { color: "#1a1a1a", fg: "#fff", mark: "figma" },
  notion: { color: "#11181c", fg: "#fff" },
  vercel: { color: "#11181c", fg: "#fff", mark: "tri" },
  linear: { color: "#5e6ad2", fg: "#fff" },
  plaid: { color: "#11181c", fg: "#fff" },
  datadog: { color: "#632ca6", fg: "#fff" },
  snowflake: { color: "#29b5e8", fg: "#fff" },
  coinbase: { color: "#0052ff", fg: "#fff" },
  brex: { color: "#f46f4e", fg: "#fff" },
  retool: { color: "#3c3c3c", fg: "#fff" },
  vanta: { color: "#6f4ff2", fg: "#fff" },
  mercury: { color: "#5266eb", fg: "#fff" },
  webflow: { color: "#4353ff", fg: "#fff" },
  twilio: { color: "#f22f46", fg: "#fff" },
  mongodb: { color: "#00684a", fg: "#fff" },
  confluent: { color: "#173361", fg: "#fff" },
  robinhood: { color: "#11181c", fg: "#ccff00" },
  scale: { color: "#11181c", fg: "#fff" },
  rippling: { color: "#11181c", fg: "#f2c94c" },
  gusto: { color: "#f45d48", fg: "#fff" },
  asana: { color: "#f06a6a", fg: "#fff" },
  airtable: { color: "#2d7ff9", fg: "#fff" },
  benchling: { color: "#1186d6", fg: "#fff" },
  verkada: { color: "#0b6ef5", fg: "#fff" },
  cloudflare: { color: "#f6821f", fg: "#fff" },
  affirm: { color: "#4a4af4", fg: "#fff" },
};

function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function CompanyLogo({ company, size = 24 }: { company: string; size?: number }) {
  const key = company.trim().toLowerCase();
  const b = BRANDS[key];
  const style: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: size * 0.26,
    background: b?.color ?? `oklch(0.55 0.11 ${hueOf(key)})`,
    color: b?.fg ?? "#fff",
  };
  let inner: React.ReactNode;
  if (b?.mark === "tri") {
    inner = (
      <svg width={size * 0.54} height={size * 0.54} viewBox="0 0 24 22" aria-hidden="true">
        <path d="M12 2l10 18H2L12 2Z" fill={b.fg} />
      </svg>
    );
  } else if (b?.mark === "figma") {
    inner = (
      <svg width={size * 0.46} height={size * 0.7} viewBox="0 0 12 18" aria-hidden="true">
        <circle cx="3" cy="3" r="3" fill="#f24e1e" />
        <circle cx="9" cy="3" r="3" fill="#ff7262" />
        <circle cx="3" cy="9" r="3" fill="#a259ff" />
        <circle cx="9" cy="9" r="3" fill="#1abcfe" />
        <circle cx="3" cy="15" r="3" fill="#0acf83" />
      </svg>
    );
  } else if (b?.mark === "burst") {
    inner = (
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 2v20 M2 12h20 M5 5l14 14 M19 5L5 19"
          stroke={b.fg}
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
    );
  } else if (b?.mark === "stripe") {
    inner = (
      <span className="font-mono italic" style={{ fontWeight: 700, fontSize: size * 0.5 }}>
        S
      </span>
    );
  } else {
    inner = (
      <span className="font-mono" style={{ fontWeight: 650, fontSize: size * 0.46 }}>
        {company.trim()[0]?.toUpperCase() ?? "?"}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-none items-center justify-center" style={style} title={company}>
      {inner}
    </span>
  );
}

/* ---------------- Dot-matrix charts ----------------------------------- */

/** Vertical bar chart; bars fade in toward the newest (last) value. */
export function DotColumns({ data, height = 36 }: { data: number[]; height?: number }) {
  const cols = data.length;
  if (!cols) return null;
  const max = Math.max(...data, 1);
  const gap = 2.2;
  const bw = 8;
  const step = bw + gap;
  const w = cols * step - gap;
  const h = 100;
  const r = Math.min(bw / 2, 3);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden="true">
      {data.map((v, c) => {
        const bh = Math.max(2, (v / max) * h);
        return (
          <rect
            key={c}
            x={c * step}
            y={h - bh}
            width={bw}
            height={bh}
            rx={r}
            ry={r}
            fill="var(--primary)"
            style={{ opacity: c === cols - 1 ? 1 : 0.32 + (c / cols) * 0.5 }}
          />
        );
      })}
    </svg>
  );
}

/** Horizontal progress track — fraction 0..1 filled. */
export function DotTrack({
  frac,
  tone = "primary",
}: {
  frac: number;
  tone?: "primary" | "success" | "warning" | "destructive" | "info";
}) {
  return (
    <svg viewBox="0 0 100 8" width="100%" height={9} preserveAspectRatio="none" aria-hidden="true">
      <rect x="0" y="0" width="100" height="8" rx="4" fill="var(--secondary)" />
      <rect
        x="0"
        y="0"
        width={Math.max(2, Math.min(1, frac) * 100)}
        height="8"
        rx="4"
        fill={`var(--${tone})`}
      />
    </svg>
  );
}

/** Decorative dot-matrix block (brand mark / corner texture). */
export function DotBlock({
  pattern,
  color = "var(--primary)",
  size = 4,
}: {
  pattern: string[];
  color?: string;
  size?: number;
}) {
  const gap = 6;
  const r = 1.8;
  const rows = pattern.length;
  const cols = pattern[0]?.length ?? 0;
  const cells: React.ReactNode[] = [];
  pattern.forEach((row, y) =>
    row.split("").forEach((ch, x) => {
      if (ch !== " ")
        cells.push(
          <circle key={`${x}-${y}`} cx={x * gap + gap / 2} cy={y * gap + gap / 2} r={r} fill={color} />,
        );
    }),
  );
  return (
    <svg viewBox={`0 0 ${cols * gap} ${rows * gap}`} width={size * cols} aria-hidden="true">
      {cells}
    </svg>
  );
}

/* ---------------- Loaders --------------------------------------------- */

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function BrailleSpinner({ size = 13, className }: { size?: number; className?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % BRAILLE_FRAMES.length), 80);
    return () => clearInterval(t);
  }, []);
  return (
    <span className={cn("font-mono text-primary", className)} style={{ fontSize: size }}>
      {BRAILLE_FRAMES[i]}
    </span>
  );
}

export function BrailleBar({ className }: { className?: string }) {
  const [s, setS] = useState("");
  useEffect(() => {
    const chars = "⠁⠃⠇⠧⠷⠿⡿⣿";
    let n = 0;
    const t = setInterval(() => {
      n = (n + 1) % 11;
      setS(
        Array.from({ length: 8 }, (_, i) => chars[Math.max(0, Math.min(7, n - i))] ?? "⠄").join(""),
      );
    }, 90);
    return () => clearInterval(t);
  }, []);
  return <span className={cn("font-mono text-primary", className)}>{s}</span>;
}

export function LoaderOverlay({ caption = "Syncing pipeline" }: { caption?: string }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/60 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-8 py-6 shadow-md">
        <BrailleBar className="text-lg" />
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <BrailleSpinner />
          {caption}
        </div>
      </div>
    </div>
  );
}
