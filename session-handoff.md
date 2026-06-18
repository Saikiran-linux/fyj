# Session Handoff

## Current Objective

- **Goal:** ops-console (Product A) is **deployed & live**; next is **f-134** (résumé → R2 → embed → live Jobs search).
- **Current status:** f-131/f-132/f-133/**f-infra all DONE**. Signup works end-to-end in production.
- **Branch:** everything is merged to **`main`** (`4d7e0bf`). `main` auto-deploys production via Vercel↔GitHub.

## Live system (production)

| Piece | URL / id |
|---|---|
| UI | https://fyj-console.vercel.app (Vercel `fyj-ops-console`, git-deploy from `main`, root dir `web`) |
| API | https://fyj-ops-console.saikiran13055.workers.dev (Cloudflare Worker `fyj-ops-console`) |
| DB | Neon `neon-bisque-yacht` / project `tiny-silence-25740582` / db `neondb` |
| CF account | `489409dba6e11499199acff6ffb8eddf` · Hyperdrive `78ccefa7…` · KV `b6f1e38f…` · Queue `fyj-match` · R2 `fyj-resumes` |

## Verification evidence (this session)

| Check | Result | Notes |
|---|---|---|
| Worker / web typecheck + build | PASS | |
| Live signup (real origin) | PASS | CORS 204, signup 200, cross-site cookie set |
| Org bootstrap on signup | PASS | org + admin membership auto-created |
| RLS fails closed for `ops_app` | PASS | `ops_app` non-BYPASSRLS, 0 rows w/o GUCs |
| Git → production deploy from `main` | PASS | git-built deploy reached READY |

## Decisions / invariants (unchanged)

- Separate repos; Cloudflare + Neon; Better Auth with **app-owned orgs**; **RLS is the boundary**; privileged ops via `SECURITY DEFINER`. (See `docs/PLAN.md`, `CLAUDE.md`.)

## Blockers / risks for the next session

- **Secrets aren't in the repo and aren't recoverable** (`BETTER_AUTH_SECRET`, `ops_app` DB password live only in the Worker secret + Hyperdrive config). To rotate: reset `ops_app` pw in Neon → patch Hyperdrive → redeploy.
- **Rotate all tokens shared in chat** (Neon/Cloudflare/Vercel/Supabase). A new session needs **fresh credentials** to deploy.
- **`ops_system` is not BYPASSRLS** → the **f-135 matcher** needs that resolved (Neon role flag or SECURITY DEFINER refactor).
- Raw Postgres `5432` egress is blocked in CI → apply DB changes via Neon's serverless/HTTPS driver, not `db:migrate` directly from here.

## Next session startup

1. Read `CLAUDE.md`, then `feature_list.json` + `progress.md`, then this handoff.
2. Run `./init.sh` (typecheck/build gates only — no live infra calls).
3. Read `docs/INFRA-SETUP.md` for live resource ids + how schema was applied.

## Recommended next step (f-134)

1. `wrangler secret put OPENAI_API_KEY` on the Worker (needed for embeddings).
2. Résumé upload → R2 (`fyj-resumes`) → parse (PDF/DOCX) → embed → `client_profiles.embedding`.
3. Wire the **Jobs** screen + dashboard command bar to the index `search_jobs` (live) using a selected profile's embedding.
4. Every tenant DB call goes through the repository → `withTenant` → RLS.
