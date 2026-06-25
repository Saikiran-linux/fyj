import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { DB } from "./db/client";
import * as authSchema from "./db/auth-schema";

/**
 * Better Auth instance (f-133). Created PER REQUEST because the DB handle is a
 * per-isolate Hyperdrive connection (createDb in src/db/client.ts) — never a
 * module global. The Worker passes `env.BETTER_AUTH_SECRET` / `BETTER_AUTH_URL`
 * explicitly: Workers bindings are not on `process.env`, so Better Auth can't
 * auto-read them.
 *
 * Auth owns ONLY the user/session/account/verification tables (auth-schema.ts).
 * Org/role/membership live in the app's own tenancy tables (schema.ts) — we
 * deliberately do NOT use the Better Auth organization plugin
 * (HOSTED_PLATFORM_PLAN decision: app-owned, RLS-governed orgs).
 *
 * ONBOARDING MODEL (locked): public self-sign-up is closed (the
 * `/api/auth/sign-up/**` HTTP route is hard-blocked in src/api.ts). Orgs +
 * their admin are created via the protected seed endpoint, and admins create
 * operators from the Members screen. Both paths call `auth.api.signUpEmail`
 * DIRECTLY (off the HTTP route, so the block doesn't apply and no session
 * cookie is set on the caller's response) and then insert the membership /
 * call `app.bootstrap_org_for_user` themselves. There is therefore NO
 * `user.create.after` org-bootstrap hook anymore — a stray signup must never
 * mint an org on its own.
 *
 * The `username` plugin lets staff sign in with a username instead of email
 * (email is still required + unique on the user row; for username-only staff we
 * synthesize a placeholder — see src/db/repo.ts createStaffMember).
 *
 * `backgroundTasks.handler` is required on serverless so deferred work (timing-
 * safe email sends, etc.) is kept alive; the caller supplies the platform
 * `waitUntil`.
 */
export function createAuth(env: Env, db: DB, waitUntil?: (p: Promise<unknown>) => void) {
  // The UI lives on a different origin (e.g. *.vercel.app) from this API, so:
  //  - it must be a trusted origin (CSRF), and
  //  - the session cookie must be SameSite=None; Secure; Partitioned to be sent
  //    on cross-site fetch(credentials:"include"). Only do that over https —
  //    localhost dev is same-site (same host, different port) and stays Lax.
  const webOrigins = (env.WEB_ORIGIN ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const trustedOrigins = [...(env.BETTER_AUTH_URL ? [env.BETTER_AUTH_URL] : []), ...webOrigins];
  const crossSite = webOrigins.some((o) => o.startsWith("https://"));

  const advanced: Record<string, unknown> = {};
  if (crossSite) {
    advanced.defaultCookieAttributes = { sameSite: "none", secure: true, partitioned: true };
  }
  // backgroundTasks keeps deferred work (timing-safe email, the signup org hook)
  // alive on serverless; the caller supplies the platform waitUntil.
  if (waitUntil) {
    advanced.backgroundTasks = { handler: (p: Promise<unknown>) => waitUntil(p) };
  }

  return betterAuth({
    appName: "fyj-ops-console",
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins,
    database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
    plugins: [username()],
    emailAndPassword: {
      enabled: true,
      // No email provider wired yet. Verification stays off (placeholder emails
      // for username-only staff are never deliverable). The public sign-up
      // route is blocked in src/api.ts; users are created only by the seed +
      // admin paths.
      requireEmailVerification: false,
    },
    advanced,
  });
}

export type Auth = ReturnType<typeof createAuth>;
