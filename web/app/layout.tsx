import type { Metadata } from "next";
import { Source_Sans_3 } from "next/font/google";
import "./globals.css";

// Source Sans Pro (renamed "Source Sans 3" on Google Fonts) — the console's one
// typeface. Self-hosted by next/font (no runtime request / layout shift) and
// exposed as --font-source-sans, which globals.css feeds into --font-sans.
const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-source-sans",
});

export const metadata: Metadata = {
  title: "fyj Ops Console",
  description: "Multi-tenant staffing operations console.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sourceSans.variable}>
      <body className="min-h-screen bg-bg text-text antialiased">{children}</body>
    </html>
  );
}
