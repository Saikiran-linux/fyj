# Ops Console — Infra & Secrets Setup Checklist

> **Status: NOT DONE — blocks runtime verification of f-133 and everything downstream.**
> The code (Worker API, RLS, repository, auth, and the `web/` UI) is written and typechecks,
> but nothing can run end-to-end until the boxes below are ticked. Owner: **human** (needs
> Neon + Cloudflare + secret access). When done, mark each box and run the smoke test at the end.

## 1. Neon Postgres (ops DB)
- [ ] Create a Neon project (region near the Workers).
- [ ] In the DB: `create extension if not exists vector;` and `create extension if not exists pgcrypto;`
- [ ] Capture the **direct** (non-pooled) URL → `.dev.vars` `DATABASE_URL` (used by `db:generate`/`db:migrate`).
- [ ] Capture the **pooled** URL → used by Hyperdrive (step 3), connecting as role `ops_app`.

## 2. Apply schema + policies (after step 1; I can drive this once URLs exist)
- [ ] `npm run db:migrate` — creates the 14 tables from `drizzle/0000_*` (10 tenancy + 4 Better Auth).
- [ ] `npm run db:policies` — RLS + `app.*` GUC helpers + resolvers + `ops_app`/`ops_system` roles.
- [ ] Set passwords for `ops_app` and `ops_system` in Neon (the policies file creates the roles
      with `LOGIN`; set passwords out-of-band): `alter role ops_app with password '...';`
- [ ] Sanity: `select rolbypassrls from pg_roles where rolname='ops_app';` must be **false**.

## 3. Cloudflare resources → fill the placeholder ids in `wrangler.jsonc`
- [ ] **Hyperdrive** config pointing at Neon's **pooled** URL as `ops_app` → id into `HYPERDRIVE`.
- [ ] **R2** bucket `fyj-resumes` → `RESUMES`.
- [ ] **KV** namespace (job-detail cache) → `JOB_CACHE`.
- [ ] **Queue** `fyj-match` → `MATCH_QUEUE` (producer + consumer).
- [ ] Confirm the hourly cron trigger + `nodejs_compat` flag are present.

## 4. Secrets (`wrangler secret put <NAME>` for prod; `.dev.vars` for local)
- [ ] `BETTER_AUTH_SECRET` — `openssl rand -base64 32`
- [ ] `BETTER_AUTH_URL` — the deployed Worker origin (e.g. `https://ops-api.fyj.app`) / `http://localhost:8787` locally
- [ ] `FYJ_INDEX_URL` — `https://mwcpoaefmggapztkxakp.supabase.co`
- [ ] `FYJ_INDEX_KEY` — a Supabase key authorized to call `search_jobs`/`get_job`
- [ ] `OPENAI_API_KEY` — profile resume embeddings (f-134)
- [ ] `ANTHROPIC_API_KEY` — deep eval / CV (f-136)

## 5. Web UI env (`web/.env.local`, see `web/.env.local.example`)
- [ ] `NEXT_PUBLIC_API_URL` — the Worker API origin the browser calls (CORS must allow it).

## 6. Security hygiene (separate, do now)
- [ ] **Rotate the Supabase service-role key** — an `sb_secret_…` was pasted into a prior chat
      transcript (never committed/used, but exposed). Roll it in Supabase → Settings → API and
      update the `SUPABASE_SERVICE_ROLE_KEY` GitHub Actions secret in `fyj_scanner`.

---

## Smoke test (run once 1–5 are green — this is the real f-133 verification)
1. `wrangler dev` (API) + `cd web && npm run dev` (UI).
2. Sign up a user → confirm an org + admin membership were auto-created
   (`select * from memberships;` → one `admin` row for the new user).
3. `GET /api/me` returns `{ principal: { principal: "staff", role: "admin", ... } }`.
4. Create a client, a second operator, reassign — confirm **operators only see their assigned
   clients** (RLS), admins see all.
5. Enable a client's portal, sign in as that client → confirm **read-only own pipeline +
   feedback-insert-only**, and that they cannot see other clients (RLS denies).

If any step leaks across tenants, STOP — that's an RLS regression, not a UI bug.
