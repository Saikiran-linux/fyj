# Session Progress Log

Append/update at the top each session. Long-form rationale → commit messages + `docs/`.

---

## 2026-06-24 — f-139 Phase 3: Candidates roster + tabbed profile (+ PROD APPLY)

Third phase of the operator-console rebuild (**f-139**), plus the first prod DB change of the
session (the user provided the `neondb_owner` string for a one-off ops pass).

- **Schema (migration `0002_easy_praxagora.sql`):** `clients` += `headline`, `consent_status`
  (enum `active|pending|revoked`); `client_profiles` += `autopilot`; `placements` += `job_title`,
  `company_name`, `tailored_resume_name`, `stage_changed_at`; `placement_status` enum **appended**
  `drafted`/`ready_to_send`/`responded` (existing values keep their positions → plain `ADD VALUE`).
- **Backend:** `repo.updateClient` (status/headline/consent), `repo.updateProfile`
  (autopilot/criteria), `listApplications` now takes `{clientId}` and selects `job_title`/
  `company_name`; `approveMatch` now queues the placement at `ready_to_send` + `stage_changed_at`.
  Routes: `PATCH /api/clients/:id`, `GET /api/clients/:id/applications`, `PATCH /api/profiles/:id`.
- **Web:** `clients/page.tsx` → candidate **roster** (cards: avatar, headline, status + consent
  chips, Add candidate). `clients/[id]/page.tsx` → **tabbed profile**: hero (avatar, headline,
  status/consent chips, Pause/Resume) + 3-stat row + tabs **Overview / Matches / Tracks /
  Applications / Activity** (Matches = inline Approve/Decline; Tracks = autopilot toggle + résumé
  upload, reusing the f-134 upload path). Types/api extended accordingly.
- **GATES GREEN:** `./init.sh` (Worker tsc + `db:generate` no-drift + web tsc) and
  `cd web && npm run build` (13 routes; `/clients` 2.97 kB, `/clients/[id]` 9.62 kB).
- **PROD APPLY (this session):** migrations **0001 + 0002** and **`db/policies.sql`** applied to
  Neon over the `@neondatabase/serverless` WS driver (raw 5432 is blocked in this container; same
  trick as 06-20). Idempotent guards (`IF NOT EXISTS`, guarded `CREATE TYPE`, `ADD VALUE IF NOT
  EXISTS`). Verified: the 6 `app.*` fns exist, `ops_app` has `execute`, and every new column + enum
  value is present. **policies.sql compiling against the live schema validates the SQL functions**
  (the Phase 1/2 dashboard + matcher fns) — the first real verification beyond typecheck this session.
- **STILL NEEDS for the live URL:** `wrangler deploy` (CF token — to expose the new Worker routes)
  and **merge to `main`** (Vercel auto-deploys `web/`). The DB is ready; the deployed Worker/UI are
  still the 06-20 versions until then.
- ⚠️ **`neondb_owner` password was pasted in chat — ROTATE it.**
- **Next:** Phase 4 — Calendar (month/week/agenda from placements).

---

## 2026-06-24 — f-139 Phase 2: Explore (match review) + match enrichment

Second phase of the operator-console rebuild (**f-139**). Built the **Explore** match-review view
and enriched `campaign_matches` so matches carry fit/confidence — on the **live matcher path**.

- **Schema (migration `drizzle/0001_fair_red_hulk.sql`):** `campaign_matches` gains `fit_score`
  (smallint), `confidence` (new enum `match_confidence` high|medium|low), `rationale` (text), and
  `matched_skills`/`missing_skills`/`guardrails` (`text[]`).
- **Matcher:** `app.record_campaign_run` (db/policies.sql) now derives `fit_score =
  round(clamp(score,0,1)*100)` and bands `confidence` (≥0.82 high, ≥0.64 medium, else low) **at
  surface time**. `rationale` + skill breakdown stay null until the LLM eval pass (f-136) — we don't
  fabricate them.
- **API/repo:** `repo.listMatches` (cross-campaign, RLS-scoped via the `campaign_matches` policy →
  operators see their book, admins the org; ordered fit desc nulls last) + `repo.approveMatch`
  (sets `action=shortlisted`, queues a `placement` idempotent on client+job, audits). Routes:
  `GET /api/matches` (hydrates job title/company/location/url via `get_job`/KV), `POST
  /api/matches/:id/approve`; decline reuses `POST /api/matches/:id/action {dismissed}`.
- **Web:** `app/(app)/explore/page.tsx` replaces the stub — confidence filter + match cards (fit +
  confidence chips, rationale, matched/gaps skills, guardrail block that disables Approve) + a right
  detail drawer with Approve & queue / Decline. `web/lib/{types,api}.ts` gain
  `Match`/`MatchConfidence`/`ApproveMatchResult` + `listMatches`/`approveMatch`/`declineMatch`.
- **GATES GREEN:** `./init.sh` (Worker tsc + `db:generate` no-drift + web tsc) and
  `cd web && npm run build` (13 routes; `/explore` 4.71 kB).
- **NOT runtime-verified** (no infra). ⚠️ Before live: **apply migration 0001** (`db:migrate` /
  `drizzle-kit`) **and re-apply `db/policies.sql`** to Neon (updated `app.record_campaign_run` + the
  Phase-1 dashboard fns). Until a campaign surfaces matches, Explore shows its empty state.
- **Next:** Phase 3 — Candidates roster + Candidate profile (headline/consent on clients, autopilot
  on profiles, placement stage lifecycle).

---

## 2026-06-24 — f-139 Phase 1: operator dashboard analytics + top navbar (present look)

Started the design-parity rebuild of the operator console (**f-139**) — building the Claude Design
mockup's features in the **present look** (square corners, grayscale, Source Sans, shadcn), adopting
its **top navbar** but not its warm/mono/rounded chrome. Planned as 4 phases; **Phase 1 (dashboard +
navbar) done + verified** on `claude/bold-cori-fohjtb`.

- **Backend, no schema change (lower risk):** KPIs/funnel/leaderboard/trends/activity are computed
  live from existing tables (`placements`, `campaign_matches`, `audit_log`, `memberships`,
  `clients`) — so `db:generate` stays no-drift, **no migration**. `db/policies.sql` adds 5
  org-scoped `SECURITY DEFINER` fns (`app.org_kpis` / `org_funnel` / `operator_stats` / `org_trends`
  / `org_activity`) that read the `app.org_id` GUC and are staff-gated — the **same RLS-exempt owner
  pattern as the f-135 matcher fns**. Needed because org-wide rollups span every client/operator
  (which an operator's `can_access_client` RLS blocks) and `audit_log` is admin-select-only. Granted
  to `ops_app`. `src/db/repo.ts` + `src/api.ts` expose `GET /api/dashboard/{kpis,funnel,leaderboard,
  trends,activity}` + `/api/applications` (isStaff guard).
- **Frontend (present look):** `web/components/navbar.tsx` — a top navbar (brand · Dashboard /
  Explore / Candidates / Calendar · profile menu) — **replaces the left icon rail** in
  `app/(app)/layout.tsx`; `components/topbar.tsx` slimmed to a title strip (identity moved to the
  navbar). `web/components/dashboard.tsx` holds the widgets (KPI cards, segmented throughput, funnel
  bars, activity stream, operator leaderboard, top-applications table); the design's dot-matrix
  charts are re-rendered as plain **square SVG `MiniBars`/`Sparkline`**. `app/(app)/page.tsx`
  composes them. `/explore` + `/calendar` are `Placeholder` stubs so the navbar resolves (real views
  land in P2/P4). `rail.tsx` is now unused (left in place; removable later).
- **GATES GREEN:** `./init.sh` (Worker tsc + `db:generate` no-drift + web tsc) and
  `cd web && npm run build` (13 routes).
- **NOT runtime-verified** (no infra this session). **Before the endpoints return data,
  `db/policies.sql` must be re-applied to prod Neon** (via the Neon serverless WS driver — raw 5432
  is blocked here) so the 5 new `app.*` fns exist + are granted. Widgets read real tables and render
  graceful empty states until `placements`/`campaign_matches` exist.
- **Next:** Phase 2 — Explore (match review) + `campaign_matches` enrichment
  (fit/confidence/rationale/skills/guardrails) + approve→placement.

---

## 2026-06-20 — AUTH FIX: RLS on Better Auth tables blocked all logins

**Symptom:** "can't log in even with correct creds." **Root cause:** `user`/`session`/`account`/`verification` (the Better Auth tables) had **RLS enabled but ZERO policies**. `ops_app` is non-BYPASSRLS, so RLS-on + no-policy = every row denied → sign-in reads `account` → 0 rows → "Invalid email or password" (even when correct); sign-up's INSERT into `user` denied → `FAILED_TO_CREATE_USER`. Verified via the WS driver: as `neondb_owner` the user row is visible; as `ops_app` the same query returned `[]`.

**Why now:** `db/policies.sql` only RLS-enables the *app* tables — it never touched the auth tables. The **Neon Data API** is enabled on this project (`authenticated`/`authenticator` roles exist), and switching it on enables RLS across the whole `public` schema, sweeping up Better Auth's tables (which ship no policies). The existing user + 2 sessions were created on 06-18, before the Data API flipped RLS on.

**Fix (in `db/policies.sql`, idempotent):** keep RLS **enabled** on the 4 auth tables (so the Data API roles stay denied — password hashes in `account` are never exposed over REST) and add a policy `for all to ops_app using (true) with check (true)` on each. Re-applied to prod Neon. **Verified end-to-end:** `ops_app` now sees the user/account rows; a throwaway `sign-up/email` returns **200** with `__Secure-better-auth.session_token` (`SameSite=None; Secure; Partitioned; HttpOnly`), and `get-session` resolves the user. Test account + its bootstrapped org cleaned up afterward (only the real user/org remain).

NB the session cookie is correctly cross-site (`SameSite=None; Partitioned`). If a browser with third-party-cookie blocking still won't persist the session, the durable fix is a same-site custom domain for UI+API (separate follow-up).

---

## 2026-06-20 — f-134 + f-135 DEPLOYED LIVE (runtime-verified)

The two "code-done, needs creds" carryovers are now **live on prod** and smoke-tested. User provided an OpenAI key, a Cloudflare User API token, and the Neon `neondb_owner` connection string for a one-off ops pass.

**Environment note for next session:** this container's egress allows **HTTPS (443) only** — raw Postgres **5432 is blocked**, so `npm run db:policies` (psql) does **not** work here. Applied `db/policies.sql` instead via the **Neon serverless WebSocket driver** (`@neondatabase/serverless` + `ws`, installed `--no-save` so `package.json` is untouched): connect `Pool`, `begin; <whole file>; commit`. psql meta-command-free file, so a single simple-query call runs it. Same trick works for any future DDL from here.

What ran:
- **OpenAI** → `wrangler secret put OPENAI_API_KEY` on `fyj-ops-console`. Verified the key independently: `text-embedding-3-small` returns 1536-dim. f-134 resume→embed path is unblocked.
- **policies.sql** → applied to Neon (idempotent). Confirmed the 3 f-135 functions now exist, `prosecdef=true`, execute granted to `ops_app`+`ops_system`. Pre-existing schema already had `client_profiles.embedding/parsed_profile/embedded_at` + `campaign_matches` + roles `ops_app`/`ops_system` (f-134/infra migrations were already applied; note `drizzle.__drizzle_migrations` table is absent — schema was pushed, not migrate-tracked).
- **Worker** → `wrangler deploy` (version `ce041109-0fa6-45a0-98f0-e592f2a13dab`), bindings intact (Hyperdrive, R2 `fyj-resumes`, `MATCH_QUEUE`, KV `JOB_CACHE`), cron `17 * * * *` armed. Live at `https://fyj-ops-console.saikiran13055.workers.dev`.

Smoke tests (all green): `/api/health` → 401 (auth live, not a crash); OpenAI embeddings → 1536d; **`ops_app` (non-BYPASSRLS) executes `app.list_active_campaigns()`** → 0 active campaigns (expected — none activated yet). This proves the SECURITY DEFINER matcher path works from the actual request role.

**To watch:** the hourly cron now runs for real; it'll be a no-op until a campaign is set active and its profile has an embedding (upload a resume → embeds → matcher surfaces `campaign_matches`). Secrets used in this pass (OpenAI key, CF token, Neon password) were shared in chat — **rotate them.** `ANTHROPIC_API_KEY` is still unset on the Worker (needed for f-136 A–G eval, not yet).

---

## 2026-06-19 — console UI migrated to shadcn (radix-nova) + @aliimam registry

Full re-platform of `web/` onto **shadcn/ui** (CLI v4, `radix-nova`, base color neutral), keeping the prior decisions: **square corners (`--radius: 0`) + Source Sans Pro**.

- **Foundation:** `shadcn init` → `components.json`, `lib/utils.ts` (cn = clsx+tailwind-merge), deps (clsx, tailwind-merge, cva, radix-ui, lucide-react, tw-animate-css). `globals.css` rewritten to a single shadcn token system (oklch neutral) + `success`/`warning`/`info` tokens for status chips; `--radius: 0` and a global `border-radius: 0 !important` keep everything square (incl. avatars). `layout.tsx` binds Source Sans Pro to `--font-sans`. Deleted `lib/cn.ts`.
- **@aliimam registry** wired in `components.json` (`https://aliimam.in/r/{name}.json`) — verified it resolves (`shadcn view @aliimam/typewriter`). NB the correct CLI flow is `npx shadcn@latest add @aliimam/<item>` (there is no `registry add` subcommand). It's a 195-item marketing/landing kit (heroes, pricing, shaders…); none pulled yet — available on demand.
- **Primitives** pulled from base shadcn: button, card, badge, input, label, textarea, select, tabs, table, separator, dropdown-menu. Custom composites rebuilt on them: `Chip` (semantic-tone badge), `Avatar` (initials), `ActionCard`, CommandBar, Topbar, Rail (lucide icons), PageHeader, Placeholder.
- **Every screen** rewritten to shadcn components + tokens: dashboard (shadcn Tabs + Table), clients, client detail (resume upload intact), jobs, members (shadcn Select), campaign matches, sign-in.

Gate: web `npm run typecheck` + `next build` green (11 routes). No Worker/API changes.

---

## 2026-06-18 — f-134 fix: summarize-then-embed (match how JDs are embedded)

The first f-134 cut embedded the **raw resume text**. The fyj index embeds jobs from their **LLM summary**, not the raw description (fyj_scanner `src/summarize.mjs` + `buildJobText` in `src/embeddings.mjs`; proof in `scripts/embed-resume.mjs`). Embedding raw prose sits in a different region of the space and ranks worse. Fixed to replicate the JD pipeline exactly:

- **`src/summarize.ts`** (new): resume → **gpt-4o-mini** (temp 0, max_tokens 500) → the **identical 14-field labeled precis** (Role/Level/Experience/Required skills/Preferred skills/Team/Industry/Company stage/Location/Remote policy/Compensation/Benefits/Visa/Schedule) the scanner produces for jobs, plus a leading `Title:` (jobs carry title as a column; resumes don't). Then assembles `title \n\n signal-block \n\n summary` — the **same shape `buildJobText` embeds** (Seniority/Workplace/Employment type/Department/Location derived from the precis). Framed as the role the candidate *fills* so it lands in the JD distribution. Retries 429/5xx.
- **`src/embeddings.ts`**: added **`embedRaw`** — embeds the assembled input **verbatim (newlines preserved)**, because jobs are embedded with their `\n` structure intact and the embedder keys off the labeled lines. The old `embedText` (whitespace-collapsing) now serves ONLY the short free-text query path (`/api/search`), which is correct — fyj_scanner embeds NL queries raw too.
- **`src/api.ts`** resume route: `parseResume → summarizeResume → embedRaw(summary.embedInput)`; stores `title` + `summary` in `parsedProfile`.

Gates green: Worker typecheck + `wrangler dry-run` (966 KiB gzip). Still needs `OPENAI_API_KEY` (now used for BOTH the gpt-4o-mini summary and the embedding) + deploy to verify live.

---

## 2026-06-18 — f-135 built (continuous matcher, SECURITY DEFINER path)

**Active feature:** `f-135` (continuous campaign matcher) — **code done, gates green.** Next: `f-136` (deep eval A–G).

### The blocker, resolved
`ops_system` can't be `BYPASSRLS` on Neon (owner role can't grant it via SQL). **User chose SECURITY DEFINER over chasing BYPASSRLS.** The matcher now runs on the **existing `ops_app` Hyperdrive connection** (no second binding, no privileged role) and reaches across tenants ONLY through owner-owned, RLS-exempt functions — the same trick as the f-133 resolvers (and the file already forbids `FORCE RLS` precisely so this works).

### What shipped
- **`db/policies.sql`** (f-135 section): `app.list_active_campaigns()` → (id, org_id); `app.get_campaign_for_match(uuid)` → campaign + 1:1 profile (embedding **as text** — pgvector has no driver mapping over a raw RPC, Worker `JSON.parse`s it) + filters + watermark; `app.record_campaign_run(uuid, jsonb)` → inserts `campaign_matches` `on conflict (campaign_id, job_id) do nothing` **and** bumps `last_run_at`, atomically. **org_id/client_id are derived from the campaign id inside the DB, never trusted from the payload.** Granted to ops_app + ops_system.
- **`src/matcher.ts`** rewritten to call those via `db.execute(sql\`…\`)` instead of raw drizzle selects/inserts (which RLS denies for ops_app). Incremental: `since = last_run_at`, `targetOnly` defaults true. No embedding → returns early WITHOUT bumping the watermark (so first jobs aren't skipped once embedded).
- Cron (`17 * * * *`) enqueues active campaigns → queue consumer matches each (unchanged wiring in `src/index.ts`).

### Gates — green
- `./init.sh`: Worker typecheck + `db:generate` (no schema.ts change) + web typecheck. `wrangler deploy --dry-run` bundles.

### ⚠️ Remaining to run LIVE (operational, needs creds)
1. **Re-apply `db/policies.sql` to Neon** so the new `app.list_active_campaigns` / `get_campaign_for_match` / `record_campaign_run` exist (idempotent — safe to re-run).
2. Redeploy the Worker (`npm run deploy`). Then the hourly cron surfaces matches.
3. NOT runtime-verified in-repo (no creds). Also still needs `OPENAI_API_KEY` from f-134 for embeddings to exist at all.

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
