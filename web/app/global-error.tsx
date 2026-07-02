"use client";

/**
 * App-router global error boundary — the only place root-layout render crashes
 * surface. Reports to Sentry (no-op without the DSN) and offers a reload.
 */
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "4rem 2rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>Something went wrong</h1>
        <p style={{ color: "#666", marginBottom: "1.5rem" }}>
          The error has been reported. Try reloading the page.
        </p>
        <button
          onClick={() => reset()}
          style={{ padding: "0.5rem 1.25rem", cursor: "pointer", border: "1px solid #ccc", background: "#fff" }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
