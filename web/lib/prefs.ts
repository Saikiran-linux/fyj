/**
 * User preferences (f-154) — the prototype's tweaks panel distilled to a small
 * persisted object. localStorage v1; a `user_prefs` row can replace the store
 * later without changing this interface.
 *
 * applyPrefs() stamps the <html> element (dark class, accent/heading vars,
 * density attr). A pre-paint boot script in app/layout.tsx (PREFS_BOOT) mirrors
 * this logic so there is no theme flash — keep the two in sync.
 */

export type Density = "compact" | "regular" | "comfy";
export type HeadingFont = "sans" | "mono";

export interface Prefs {
  dark: boolean;
  /** CSS color written to --primary; null = the stock muted indigo. */
  accent: string | null;
  density: Density;
  headingFont: HeadingFont;
}

export const PREFS_KEY = "fyj_prefs_v1";

export const DEFAULT_PREFS: Prefs = {
  dark: false,
  accent: null,
  density: "regular",
  headingFont: "sans",
};

/** Prototype ACCENTS palette + the stock indigo as the null default. */
export const ACCENT_OPTIONS: { label: string; value: string | null }[] = [
  { label: "Indigo", value: null },
  { label: "Blue", value: "#2f6bff" },
  { label: "Green", value: "#1f9d57" },
  { label: "Ember", value: "#e8623d" },
  { label: "Violet", value: "#6d4aef" },
  { label: "Magenta", value: "#d83b8e" },
];

export function loadPrefs(): Prefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
    return { ...DEFAULT_PREFS, ...raw };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function applyPrefs(p: Prefs): void {
  const el = document.documentElement;
  el.classList.toggle("dark", p.dark);
  if (p.accent) el.style.setProperty("--primary", p.accent);
  else el.style.removeProperty("--primary");
  if (p.headingFont === "mono") el.style.setProperty("--font-heading", "var(--font-mono)");
  else el.style.removeProperty("--font-heading");
  el.dataset.density = p.density;
}

export function savePrefs(p: Prefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  applyPrefs(p);
}
