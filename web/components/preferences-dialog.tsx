"use client";

/**
 * Preferences (f-154) — the prototype's tweaks panel as a small modal: theme
 * (dark + accent), type (heading font), layout (density). Values persist via
 * lib/prefs.ts (localStorage) and apply immediately.
 */

import { useEffect, useState } from "react";
import { Check, Moon, Sun, X } from "lucide-react";
import {
  ACCENT_OPTIONS,
  DEFAULT_PREFS,
  loadPrefs,
  savePrefs,
  type Density,
  type HeadingFont,
  type Prefs,
} from "@/lib/prefs";
import { cn } from "@/lib/utils";

function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-border">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={cn(
            "flex-1 px-3 py-1.5 text-xs font-medium capitalize transition-colors",
            o === value ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-muted",
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export function PreferencesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);

  useEffect(() => {
    if (open) setPrefs(loadPrefs());
  }, [open]);

  if (!open) return null;

  const set = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePrefs(next);
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/20 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Preferences</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close preferences"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-5">
          <section className="space-y-2.5">
            <span className="label">Theme</span>
            <button
              onClick={() => set({ dark: !prefs.dark })}
              className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-muted"
            >
              <span className="flex items-center gap-2">
                {prefs.dark ? <Moon className="size-4" /> : <Sun className="size-4" />}
                Dark mode
              </span>
              <span
                className={cn(
                  "relative h-5 w-9 rounded-full transition-colors",
                  prefs.dark ? "bg-primary" : "bg-input",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 size-4 rounded-full bg-card shadow transition-all",
                    prefs.dark ? "left-[18px]" : "left-0.5",
                  )}
                />
              </span>
            </button>
            <div className="flex items-center gap-2">
              {ACCENT_OPTIONS.map((o) => {
                const on = prefs.accent === o.value;
                return (
                  <button
                    key={o.label}
                    title={o.label}
                    onClick={() => set({ accent: o.value })}
                    className={cn(
                      "grid size-7 place-items-center rounded-full border transition-transform",
                      on ? "scale-110 border-foreground" : "border-transparent hover:scale-105",
                    )}
                    style={{ background: o.value ?? "oklch(0.54 0.155 277)" }}
                  >
                    {on && <Check className="size-3.5 text-white" strokeWidth={3} />}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-2.5">
            <span className="label">Type</span>
            <Seg<HeadingFont>
              value={prefs.headingFont}
              options={["sans", "mono"] as const}
              onChange={(headingFont) => set({ headingFont })}
            />
          </section>

          <section className="space-y-2.5">
            <span className="label">Layout</span>
            <Seg<Density>
              value={prefs.density}
              options={["compact", "regular", "comfy"] as const}
              onChange={(density) => set({ density })}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
