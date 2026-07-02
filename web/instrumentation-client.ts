/**
 * Sentry — browser side. Next.js (15.3+) loads this file automatically on the
 * client. Env-gated: without NEXT_PUBLIC_SENTRY_DSN the SDK disables itself.
 *
 * Errors only, deliberately: session replay is PostHog's job here (one recorder
 * is plenty), perf tracing stays minimal, and PII never rides error payloads —
 * this app handles candidate résumés.
 */
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "production",
  tracesSampleRate: 0.05,
  sendDefaultPii: false,
});

// Wires client-side navigation spans (no-op while the DSN is unset).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
