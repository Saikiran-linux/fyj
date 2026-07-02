"use client";

/**
 * Client-side observability bootstrap — PostHog product analytics. Mounted once
 * in the root layout; renders nothing. Env-gated: without NEXT_PUBLIC_POSTHOG_KEY
 * this is a no-op, so local dev and un-keyed deploys behave exactly as before.
 *
 * What it sets up:
 *  • autocapture + pageviews + session replay (inputs MASKED — operators paste
 *    candidate PII into this app; recordings must never contain it)
 *  • identify(operator) + group("org", orgId) — every event slices per tenant,
 *    which is the whole point in a multi-tenant console
 *
 * Errors are Sentry's job (instrumentation-client.ts) — capture_exceptions stays
 * off here so issues aren't double-reported.
 */

import { useEffect } from "react";
import posthog from "posthog-js";
import { api } from "@/lib/api";

export function Observability() {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key || posthog.__loaded) return;

    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
      defaults: "2025-05-24", // SPA pageviews on history change, sane modern defaults
      capture_exceptions: false, // Sentry owns errors
      session_recording: {
        maskAllInputs: true, // candidate names/emails/résumé text stay out of replays
      },
    });

    // Tie the session to the signed-in operator + org group. Best-effort — on
    // the sign-in page (or an expired session) me() 401s and events stay anon.
    api
      .me()
      .then(({ principal }) => {
        posthog.identify(principal.userId, {
          kind: principal.principal,
          ...(principal.principal === "staff" ? { role: principal.role } : {}),
        });
        posthog.group("org", principal.orgId);
      })
      .catch(() => {});
  }, []);

  return null;
}
