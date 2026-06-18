# Session Handoff

## Current Objective

- **Goal:** ops-console (Product A) — get f-133 runtime-verified, then build f-134.
- **Current status:** f-131/f-132/f-133 done (code); UI shell built. Blocked on `f-infra` (no Neon/Cloudflare yet).
- **Branch / commit:** `claude/eager-keller-e92gc8` (fyj). Draft PR #3 (UI + infra checklist + harness).

## Completed this session

- [x] Transplanted the P1 foundation into this repo; merged backend via PR #1.
- [x] f-132 read contract (`search_jobs`/`get_job`) — in fyj_scanner, applied + verified live.
- [x] f-133 auth + repository + tenant API + Next.js `web/` UI shell.
- [x] Adopted the harness-creator structure (CLAUDE.md / feature_list.json / progress.md / init.sh / this file).

## Verification evidence

| Check | Command | Result | Notes |
|---|---|---|---|
| Worker types | `npm run typecheck` | PASS | |
| Migration | `npm run db:generate` | PASS | drizzle/0000, 14 tables |
| Web types | `cd web && npm run typecheck` | PASS | |
| Web build | `cd web && npm run build` | PASS | 11 routes |
| RLS smoke test | `docs/INFRA-SETUP.md` | NOT RUN | needs `f-infra` |

## Files changed (high level)

- `src/` (auth, principal, api, db/repo, db/auth-schema), `db/policies.sql`, `drizzle/`, `web/`, `docs/INFRA-SETUP.md`, harness files.

## Decisions made

- Separate repos; Cloudflare + Neon; Better Auth with app-owned orgs; RLS is the boundary; privileged ops via SECURITY DEFINER. (Details in `docs/PLAN.md`.)

## Blockers / risks

- **`f-infra` (human):** Neon + Hyperdrive/R2/KV/Queue + secrets → `db:migrate` → `db:policies`. Rotate the Supabase service-role key.

## Next session startup

1. Read `CLAUDE.md`.
2. Read `feature_list.json` and `progress.md`.
3. Review this handoff.
4. Run `./init.sh` before editing.

## Recommended next step

- If infra is up: run `docs/INFRA-SETUP.md` (incl. the RLS smoke test) → mark `f-infra` done → start **f-134** (resume → R2 → embed; wires the Jobs search). Otherwise continue buildable slices of f-134 against the contract.
