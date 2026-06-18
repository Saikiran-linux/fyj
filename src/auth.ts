import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { sql } from "drizzle-orm";
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
 * Org/role/membership live in the app's own tenancy tables (schema.ts), created
 * on signup by the user.create.after hook below — we deliberately do NOT use the
 * Better Auth organization plugin (HOSTED_PLATFORM_PLAN decision: app-owned,
 * RLS-governed orgs). The hook calls a SECURITY DEFINER function so the request
 * role `ops_app` (no BYPASSRLS) can bootstrap an org without an INSERT policy on
 * organizations.
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
    emailAndPassword: {
      enabled: true,
      // No email provider wired yet — keep signup unblocked. Flip on once
      // emailVerification.sendVerificationEmail is configured (f-138 digests).
      requireEmailVerification: false,
    },
    advanced,
    databaseHooks: {
      user: {
        create: {
          after: async (createdUser) => {
            // Every new staff signup gets its own org + admin membership.
            await db.execute(
              sql`select app.bootstrap_org_for_user(${createdUser.id}, ${createdUser.name ?? createdUser.email})`,
            );
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
