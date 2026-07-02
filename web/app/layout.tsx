import type { Metadata } from "next";
import { Source_Sans_3 } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { Observability } from "./observability";

// Source Sans Pro (renamed "Source Sans 3" on Google Fonts) — the console's one
// typeface. Self-hosted by next/font (no runtime request / layout shift) and
// bound to --font-sans, which Tailwind's font-sans + shadcn read.
const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "fyj Ops Console",
  description: "Multi-tenant staffing operations console.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", sourceSans.variable)}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {/* PostHog bootstrap (env-gated no-op without NEXT_PUBLIC_POSTHOG_KEY) */}
        <Observability />
        {children}
      </body>
    </html>
  );
}
