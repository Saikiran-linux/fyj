import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { Observability } from "./observability";

// Geist + Geist Mono (f-154, from the prototype). Self-hosted by next/font (no
// runtime request / layout shift); bound to --font-sans / --font-mono, which
// Tailwind's font-sans/font-mono + the .label chrome read.
const geistSans = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});
const geistMono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "fyj Ops Console",
  description: "Multi-tenant staffing operations console.",
};

// Pre-paint preference boot — reads fyj_prefs_v1 and stamps <html> (dark class,
// accent/heading vars, density attr) before first paint so there is no theme
// flash. MUST mirror lib/prefs.ts applyPrefs(); keep the two in sync.
const PREFS_BOOT = `try{var p=JSON.parse(localStorage.getItem("fyj_prefs_v1")||"{}");var d=document.documentElement;if(p.dark)d.classList.add("dark");if(p.accent)d.style.setProperty("--primary",p.accent);if(p.headingFont==="mono")d.style.setProperty("--font-heading","var(--font-mono)");if(p.density)d.dataset.density=p.density;}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={cn("font-sans", geistSans.variable, geistMono.variable)}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background text-foreground antialiased">
        <script dangerouslySetInnerHTML={{ __html: PREFS_BOOT }} />
        {/* PostHog bootstrap (env-gated no-op without NEXT_PUBLIC_POSTHOG_KEY) */}
        <Observability />
        {children}
      </body>
    </html>
  );
}
