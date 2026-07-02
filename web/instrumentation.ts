/**
 * Next.js server instrumentation hook — initializes Sentry for the Node and
 * Edge runtimes and reports server-side request errors (RSC/render failures).
 * Env-gated via SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN; no-op when unset.
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  Sentry.init({
    dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "production",
    tracesSampleRate: 0.05,
    sendDefaultPii: false,
  });
}

export const onRequestError = Sentry.captureRequestError;
