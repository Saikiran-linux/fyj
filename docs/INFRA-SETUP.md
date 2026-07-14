# Ops Console — Infra & Secrets Setup Checklist

> **Status: ✅ DONE (2026-06-18) — deployed & live; signup verified end-to-end.**
> The checklist below is kept as reference. See "Live deployment state" first.

## Live deployment state (what actually exists)

| Resource | Value |
|---|---|
| UI (prod) | https://fyj-console.vercel.app — Vercel project `fyj-ops-console`, git auto-deploy from `main`, **root dir `web`** |
| API (Worker) | https://fyj-ops-console.saikiran13055.workers.dev — `wrangler deploy` from repo root |
| Neon | store **`neon-bisque-yacht`**, project `tiny-silence-25740582`, db `neondb`, role `neondb_owner` (owner) + `ops_app`/`ops_system` (app roles) |
| Cloudflare acct | `489409dba6e11499199acff6ffb8eddf` |
| Hyperdrive | `78ccefa7a3284ceebccc7fa1ceac1379` (→ Neon **direct** endpoint as `ops_app`) |
| KV (`JOB_CACHE`) | `b6f1e38fdce3455783d0038eb62dac26` |
| Queue / R2 | `fyj-match` / `fyj-resumes` |
| Worker secrets set | `BETTER_AUTH_SECRET`, `FYJ_INDEX_KEY` (NOT `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` yet — needed for f-134/136) |
| Worker vars | `BETTER_AUTH_URL`, `WEB_ORIGIN` (localhost + both vercel domains), `FYJ_INDEX_URL` — in `wrangler.jsonc` |

**How the schema was applied:** raw Postgres `5432` egress is **blocked in this CI**, so `npm run db:migrate`/`db:policies` (which use a 5432 driver) can't connect from here. Schema + `db/policies.sql` were applied over **Neon's serverless/WebSocket driver (port 443)** instead (split `drizzle/0000` on `--> statement-breakpoint`; ran `db/policies.sql` as one simple-protocol query). From a normal network the `npm run db:migrate` / `db:policies` scripts work as written.

**Known caveats:**
- `ops_system` is **NOT BYPASSRLS** — Neon's owner role can't grant BYPASSRLS via SQL. Auth/now is fine; the **f-135 matcher** needs cross-tenant reads, so resolve this (Neon role flag, or refactor the matcher into a `SECURITY DEFINER` function).
- **Secrets are write-only / not in the repo.** `BETTER_AUTH_SECRET` + the `ops_app` password exist only in the Worker secret + Hyperdrive config. To rotate `ops_app`: reset its password in Neon → patch the Hyperdrive config → `wrangler deploy`.
- **Rotate every credential pasted in chat** (Neon API key, Cloudflare token, Vercel token, Supabase `sb_secret_…`).

---

### Original checklist (reference — all done)

> The code (Worker API, RLS, repository, auth, and the `web/` UI) is written and typechecks.
> These were the steps; all are complete per the table above.

## 1. Neon Postgres (ops DB)
- [ ] Create a Neon project (region near the Workers).
- [ ] In the DB: `create extension if not exists vector;` and `create extension if not exists pgcrypto;`
- [ ] Capture the **direct** (non-pooled) URL → `.dev.vars` `DATABASE_URL` (used by `db:generate`/`db:migrate`).
- [ ] Capture the **pooled** URL → used by Hyperdrive (step 3), connecting as role `ops_app`.

## 2. Apply schema + policies (after step 1; I can drive this once URLs exist)
- [ ] `npm run db:migrate` — creates the 14 tables from `drizzle/0000_*` (10 tenancy + 4 Better Auth).
- [ ] `npm run db:policies` — RLS + `app.*` GUC helpers + resolvers + the `ops_app` role.
      (`ops_system` is retired — the matcher runs as `ops_app` via SECURITY DEFINER functions.)
- [ ] Set a password for `ops_app` in Neon (the policies file creates the role
      with `LOGIN`; set the password out-of-band): `alter role ops_app with password '...';`
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
- [ ] `VOYAGE_API_KEY` — profile resume embeddings (f-134, moved from OpenAI in f-152) + rerank (f-149)
- [ ] `OPENAI_API_KEY` — intake extraction + résumé precis (gpt-4o-mini, f-141) — no longer used for embeddings
- [ ] `ANTHROPIC_API_KEY` — deep eval / CV (f-136)
- [ ] `ADMIN_BOOTSTRAP_SECRET` — shared secret guarding `POST /api/seed/org-admin` (f-140). Pick a
      long random value (`openssl rand -base64 32`); required only to mint the first org + admin.

## 5. Web UI env (`web/.env.local`, see `web/.env.local.example`)
- [ ] `NEXT_PUBLIC_API_URL` — the Worker API origin the browser calls (CORS must allow it).

## 6. Security hygiene (separate, do now)
- [ ] **Rotate the Supabase service-role key** — an `sb_secret_…` was pasted into a prior chat
      transcript (never committed/used, but exposed). Roll it in Supabase → Settings → API and
      update the `SUPABASE_SERVICE_ROLE_KEY` GitHub Actions secret in `fyj_scanner`.

---

## Onboarding model (f-140) — admin-created accounts, no public sign-up

Public self-sign-up is **closed**: `POST /api/auth/sign-up/**` returns 403. Accounts are created
two ways, both server-side via `auth.api.signUpEmail` (off the blocked HTTP route) with the
`username` plugin (staff sign in by username; a non-deliverable placeholder email is synthesized):

1. **Seed the first org + admin** (once, after secrets are set):
   ```
   curl -X POST "$API/api/seed/org-admin" \
     -H "x-seed-secret: $ADMIN_BOOTSTRAP_SECRET" \
     -H "content-type: application/json" \
     -d '{"username":"founder","password":"<temp>","name":"Founder","orgName":"Acme Staffing"}'
   ```
   → creates the organization + an `admin` membership (`app.bootstrap_org_for_user`).
2. **Admin creates operators** from the Members screen (`POST /api/members`,
   `{username,password,name?,role}`) — adds an **active** membership in the admin's org, no stray org.

## Smoke test (run once 1–5 are green — the real f-133 + f-140 verification)
1. `wrangler dev` (API) + `cd web && npm run dev` (UI).
2. Seed the first org + admin (above) → `select * from memberships;` shows one `admin` row.
3. Sign in as the admin (username + password) → `GET /api/me` returns
   `{ principal: { principal: "staff", role: "admin", ... } }`; confirm `POST /api/auth/sign-up/email`
   returns **403**.
4. As admin, create an **operator** (Members screen). Sign out, sign in as the operator → confirm
   they land in the **admin's org** (not a new one) and see only their assigned clients (RLS).
5. As the operator: add a client → create a profile/track → upload a résumé → a match surfaces →
   **Approve & queue résumé** (creates a placement) and **Decline** another (dismissed).
6. Enable a client's portal, sign in as that client → confirm **read-only own pipeline +
   feedback-insert-only**, and that they cannot see other clients (RLS denies).

If any step leaks across tenants, STOP — that's an RLS regression, not a UI bug.
