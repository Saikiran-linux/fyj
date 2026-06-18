# Session Progress Log

Append/update at the top each session. Long-form rationale → commit messages + `docs/`.

---

## 2026-06-18 — f-134 built (resume → R2 → embed → index search)

**Active feature:** `f-134` (clients/profiles + resume→R2→embed) — **code done, gates green.** Next: `f-135` (continuous matcher).

### What shipped this session
- **Embeddings** (`src/embeddings.ts`): single-fetch OpenAI `text-embedding-3-small`, **1536d** — deliberately in lockstep with how `fyj_scanner` embeds jobs, or `search_jobs` scores are meaningless. Caps input ~24k chars.
- **Resume parsing** (`src/resume.ts`): Workers-native — `unpdf` for PDF, `fflate` unzip + `word/document.xml` strip for DOCX, decode for text/markdown. Plus a heuristic `parsedProfile` (email/phone/links/name guess). Best-effort, feeds the embedder; real structured parse is f-136.
- **Repo** (`src/db/repo.ts`): `getProfile` + `attachResume` (both through `withTenant`→RLS; `attachResume` writes embedding+parsedProfile+embeddedAt and audits `profile.embed`).
- **Routes** (`src/api.ts`): `POST /api/clients/:id/profiles/:profileId/resume` (multipart → R2 `fyj-resumes` key `resumes/{org}/{client}/{profile}/{name}` → parse → embed → persist); `GET /api/profiles/:id/jobs` (profile embedding) + `POST /api/search` (ad-hoc text query) → `searchAndHydrate` (`search_jobs` + KV-cached `get_job`, top 25 hydrated in parallel).
- **UI**: client-detail page gets per-profile **resume upload** (PDF/DOCX/text) + a **View jobs →** link once embedded; the **/jobs** page is now real (profile matches *or* `?q=` text search, score chips, links out); dashboard command bar already routes here.

### Gates (standing) — all green
- Worker `npm run typecheck`; `wrangler deploy --dry-run` bundles clean (**964 KiB gzip**, unpdf/fflate included, under limit).
- Web `npm run typecheck` + **`next build`** (11 routes; `/jobs` static with a Suspense boundary around `useSearchParams`).

### ⚠️ Remaining for this to work LIVE (operational, needs creds I don't have)
1. **`wrangler secret put OPENAI_API_KEY`** on the Worker — `embedText` throws a clear error until then.
2. `npm run deploy` (Worker) — UI auto-deploys from `main` on Vercel.
3. NOT runtime-verified in-repo this session (no deploy creds). Resume parse + embed + index search are only type/bundle-checked.

---

## 2026-06-18 — 🚀 DEPLOYED & LIVE end-to-end (f-infra done, signup works)

**Active feature:** `f-134` (clients/profiles + resume→R2→embed) — **now unblocked** (infra is live).

### Live URLs (production)
- **UI:** https://fyj-console.vercel.app  (Vercel project `fyj-ops-console`, **git auto-deploy from `main`**, root dir `web`)
- **API:** https://fyj-ops-console.saikiran13055.workers.dev  (Cloudflare Worker `fyj-ops-console`)
- **DB:** Neon store **`neon-bisque-yacht`** (project `tiny-silence-25740582`, db `neondb`)

### What shipped this session
- **Deployed the whole stack** and **verified signup end-to-end** from the real origin: CORS preflight 204, signup 200, cross-site session cookie (`SameSite=None; Secure; Partitioned`), **org + admin membership auto-created** (`app.bootstrap_org_for_user`). `ops_app` is non-BYPASSRLS; RLS fails closed.
- **Cross-origin auth fix** (needed because UI + API are different origins): `hono/cors` on `/api/*` with an exact-origin allowlist, Better Auth `trustedOrigins`, and `defaultCookieAttributes` — all keyed off the new **`WEB_ORIGIN`** var. See `src/api.ts`, `src/auth.ts`.
- **Neon schema applied over HTTPS** (the serverless/WebSocket driver) because **raw Postgres 5432 egress is blocked in this CI** — `npm run db:migrate`/`db:policies` won't connect from here; they DO work from a normal network or you apply via the serverless driver. 14 tables, 22 policies, 10 `app.*` fns.
- **PR #1** (backend) and **PR #3** (UI + harness + CORS + live wrangler) merged to `main` (`4d7e0bf`). Git auto-deploy reconnected and a git-built production deploy verified `READY`.

### ⚠️ Blockers / risks / gotchas for next session
- **Secrets are NOT in the repo and NOT recoverable.** `BETTER_AUTH_SECRET` + the `ops_app` DB password live only inside the Cloudflare Worker secret + Hyperdrive config (write-only). To rotate: reset the `ops_app` password in Neon → recreate/patch the Hyperdrive config → redeploy.
- **Tokens shared in chat must be rotated** (Neon API key, Cloudflare token, Vercel token, Supabase `sb_secret_…`). A new session will need **fresh credentials** to re-deploy anything.
- **`ops_system` is NOT BYPASSRLS** (Neon's owner role can't grant BYPASSRLS via SQL). Fine for auth; the **f-135 matcher** (cross-tenant `listActiveCampaignIds`) needs this solved — options: Neon support/role flag, or refactor the matcher to a SECURITY DEFINER function.
- Operational details (resource ids, how schema was applied, smoke test) are in **`docs/INFRA-SETUP.md`**.

### Next session → start f-134
1. `wrangler secret put OPENAI_API_KEY` on the Worker (needed for embeddings).
2. Resume upload → R2 (`RESUMES`/`fyj-resumes` bucket is live) → parse → embed → `client_profiles.embedding`.
3. Wire the **Jobs** screen + dashboard command bar to `search_jobs` (f-132 is live on the index) against a selected profile embedding.
4. Keep every tenant DB call going through the repository → `withTenant` → RLS.

---

## 2026-06-17 — harness adopted; f-131/132/133 done, UI shell landed

**Active feature:** `f-134` (clients/profiles + resume→R2→embed) — **blocked by `f-infra`**.

### What's done
- **f-131** foundation (Workers + Neon + RLS) — merged `main` (PR #1).
- **f-132** index read contract (`search_jobs`/`get_job`) — merged in **fyj_scanner** (PR #57), applied + verified live on the index DB.
- **f-133** auth + principal + org-scoped repository + Hono tenant API (PR #1) **+ Next.js `web/` UI shell** (Clay-inspired) — draft **PR #3**.
- Adopted the **harness-creator** structure: `CLAUDE.md`, `feature_list.json`, `progress.md`, `session-handoff.md`, `init.sh` (+ skill under `.agents/skills/`, gitignored).

### Verified (standing gates)
- Worker `npm run typecheck` clean; `npm run db:generate` → `drizzle/0000` (14 tables).
- `cd web && npm run typecheck` clean; `npm run build` green (11 routes).
- **NOT runtime-verified** — no Neon/Cloudflare provisioned. Real f-133 proof = the RLS smoke test in `docs/INFRA-SETUP.md`.

### Blockers / risks
- **`f-infra` (human):** Neon + Hyperdrive/R2/KV/Queue + secrets, then `db:migrate` → `db:policies`. Gates f-134+ and all end-to-end testing. Also: **rotate the Supabase service-role key**.

### Decisions (settled — see docs/PLAN.md)
- Separate repos; Cloudflare + Neon (keep Postgres RLS); Better Auth with **app-owned orgs** (no org plugin); RLS is the boundary; privileged ops via `SECURITY DEFINER`.

### Next session
1. If infra is up: run the `docs/INFRA-SETUP.md` checklist + RLS smoke test; mark `f-infra` done.
2. Then start **f-134**: R2 resume upload + parse/embed Worker → `client_profiles.embedding`; wire the Jobs screen + dashboard command bar to `search_jobs`.
3. UI lives in `web/`; API in `src/`. Keep every tenant call going through the repository → `withTenant`.

---
