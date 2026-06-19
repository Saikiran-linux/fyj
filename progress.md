# Session Progress Log

Append/update at the top each session. Long-form rationale → commit messages + `docs/`.

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
