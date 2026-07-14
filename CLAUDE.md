# CLAUDE.md — fyj ops-console

**Ops Console (Product A): a multi-tenant staffing dashboard on Cloudflare Workers + Neon
Postgres.** Staffing orgs sign up; operators manage job-seeker clients; each client profile has a
1:1 campaign that continuously matches it against the **fyj job index** (read-only, owned by the
sibling **fyj_scanner** repo). This file is the agent entry point — routing + invariants, not a
manual. Project facts live in `docs/`.

## Startup workflow

1. `pwd` — confirm you're in the repo root.
2. Read this file fully.
3. Read `docs/PLAN.md` (architecture/PRD) and `docs/UI.md` (visual spec); skim `README.md` + `web/README.md`.
4. Run `./init.sh` (type-checks the Worker + web; see its caveats — it cannot run anything live without infra).
5. Read `feature_list.json` (state) and `progress.md` (last session).
6. `git log --oneline -5`.

If `./init.sh` type-checks are failing, fix that before adding scope.

## Architecture (the one diagram in words)

```
fyj_scanner repo (the job index, READ-ONLY to us)      THIS repo (fyj ops-console)
  Supabase Postgres: ~169k jobs, pgvector               Cloudflare Worker (Hono API): src/
  search_jobs / get_job RPC  ◀── HTTPS ───────────────  src/index-client.ts (KV-cached)
                                                          Neon Postgres via Hyperdrive — RLS
                                                          Better Auth · R2 · KV · Queues+Cron
                                                          web/ — Next.js UI (Clay-inspired)
```

- **Worker API**: `src/index.ts` (fetch/scheduled/queue) → `src/api.ts` (Hono) → `src/db/repo.ts` → `withTenant` → RLS.
- **DB**: tables in `src/db/schema.ts` (+ `src/db/auth-schema.ts`); migrations in `drizzle/`; **security core in `db/policies.sql`** (RLS + GUC helpers + resolvers + roles).
- **UI**: `web/` (separate npm project; calls the Worker API over `NEXT_PUBLIC_API_URL`).

## Hard rules (invariants the code can't enforce)

1. **RLS is the tenant boundary, not app code.** Every tenant data access goes through the
   repository → `withTenant()` → per-request `SET LOCAL app.*` GUCs. Forgetting them fails CLOSED
   (every policy denies). The request role `ops_app` must stay **non-BYPASSRLS**; the background
   matcher runs as `ops_app` too — its cross-tenant steps live in `SECURITY DEFINER` `app.*`
   functions, and nothing ever connects with BYPASSRLS.
2. **No cross-DB joins / FKs to the index.** `campaign_matches` stores `job_id`+`company_id`;
   hydrate detail via `get_job` + KV. The index is read-only — never write to it from here.
3. **Schema changes go through `src/db/schema.ts` + `drizzle-kit generate`; RLS through
   `db/policies.sql` (idempotent, re-applied every deploy AFTER `drizzle-kit migrate`).** Don't
   hand-edit the DB.
4. **Secrets never commit.** `.dev.vars` / `.env.local` are gitignored; prod secrets via
   `wrangler secret put`. Workers bindings are NOT on `process.env` — pass them explicitly
   (see `src/auth.ts`).
5. **Privileged DB ops live in `SECURITY DEFINER` functions** (`app.resolve_*`,
   `app.bootstrap_org_for_user`) so `ops_app` stays non-BYPASSRLS. Don't widen `ops_app`.

## Working rules

- **One feature at a time** from `feature_list.json`.
- **Verification required** before "done" — run `./init.sh`; record evidence in the feature entry.
- **Stay in scope**; update `progress.md` + `feature_list.json` before ending a session.
- **Leave a clean restart**: the next session must run `./init.sh` immediately.

## Definition of done

- [ ] Behavior implemented.
- [ ] Verification actually ran (`./init.sh`: Worker typecheck + `db:generate` + web typecheck; `next build` for UI changes).
- [ ] Evidence recorded in `feature_list.json` / `progress.md`.
- [ ] Repo restartable from `./init.sh`.

> **Runtime caveat:** infra IS provisioned and live (see `docs/INFRA-SETUP.md`), but the repo
> ships without `.dev.vars`, so the Worker can't run locally until you copy
> `.dev.vars.example` and fill it. Type-checks + `next build` are the standing in-repo gates;
> live verification means the deployed Worker (or `.dev.vars` + `npm run dev`). Don't claim
> runtime correctness you can't show.

## Where to look when something breaks

| Symptom | First place |
|---|---|
| RLS denies everything | a `SET LOCAL app.*` GUC is missing — check `withTenant` / `src/principal.ts` |
| Cross-tenant leak (STOP) | an RLS policy / `can_access_client` regression in `db/policies.sql` |
| Auth/session fails | `src/auth.ts` (per-request DB; `BETTER_AUTH_SECRET`/`URL` bindings) |
| Worker can't reach the index | `src/index-client.ts` (`FYJ_INDEX_URL`/`KEY`); the RPC lives in fyj_scanner |
| Drizzle/better-auth peer errors | `package.json` (drizzle-orm ^0.45 / drizzle-kit ^0.31; better-auth peers) |

## Escalation

Architecture → `docs/PLAN.md`; infra/setup → `docs/INFRA-SETUP.md`; cross-tenant or
auth-boundary ambiguity → stop and ask. Don't relitigate settled decisions (separate repos;
Cloudflare+Neon; Better Auth; app-owned orgs) — they're in `docs/PLAN.md`.
