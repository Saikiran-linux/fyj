# Session Progress Log

Append/update at the top each session. Long-form rationale → commit messages + `docs/`.

---

## 2026-06-29 — f-149: hybrid retrieval + Voyage rerank-2.5 + soft signals on the match path

Cross-repo session (branch `claude/resume-tailor-job-matching-wr2i3o` in **both** repos). Moves the production profile↔job match path off dense-only cosine onto the validated **dense + lexical(RRF) → rerank → soft-adjust** pipeline, and fixes the filter design. The index side (lexical GIN + `search_jobs_hybrid` RPC) is **f-148** in `fyj_scanner`; this repo is the consumer.

**New pipeline — one orchestrator, every entrypoint.** `src/match.ts` `matchProfile()` is now the single path behind résumé intake (`graph/intake.ts` search node), on-demand `POST /api/profiles/:id/match`, the display `GET /api/profiles/:id/jobs`, and the background `matcher.ts`:
1. **Hybrid retrieve** — `searchJobsHybrid` (`index-client.ts`) → new `search_jobs_hybrid` RPC: dense (HNSW cosine) + lexical (`ts_rank_cd`) arms, RRF-fused (k=60), returning candidate text + comp + seniority.
2. **Voyage rerank-2.5** — `src/rerank.ts` (`rerankRelevance`), contract proven in `fyj_scanner/scripts/voyage-vs-openai.mjs`. **Non-fatal**: no `VOYAGE_API_KEY` / error / timeout → keep RRF order. Query = résumé precis; docs = job title+summary.
3. **Soft adjust** — `seniorityBand()` (coarse bands so the résumé's `mid` no longer zeroes against the index vocab) + comp-floor penalty that **never punishes null comp**. Small weights so the reranker dominates; both annotate `guardrails`.

**Filter design (the spec):** hard filters cut to `closed_at` + `targetOnly` + opt-in `remote` + `since`. `compFloor`/`families`/`seniority` are stripped from the predicates in `matchProfile` and applied softly. `department`/`employment_type`/`industry` stay embedding-only (already true — `fyj_scanner buildJobText` + the summary precis). Embedding model unchanged (`text-embedding-3-small`); Voyage is **rerank-only** → no re-embed.

**DB (no Drizzle migration — reused existing columns + `parsed_profile` jsonb).** `db/policies.sql`: `get_campaign_for_match` now also returns `resume_text` + `parsed_profile` (drop+recreate — return cols changed) so the matcher can build the rerank/lexical queries; `record_campaign_run` accepts optional `fitScore`/`confidence`/`guardrails`, falling back to the cosine-derived band. `repo.recordRun` payload widened. `VOYAGE_API_KEY` (+ optional `VOYAGE_RERANK_MODEL`/`_ENABLED`) added to `worker-configuration.d.ts` + `.dev.vars.example`.

**Verified:** `./init.sh` green — Worker `tsc --noEmit` clean, `db:generate` → "No schema changes, nothing to migrate", web `tsc --noEmit` clean. **NOT runtime-verified** (no Neon/Cloudflare infra, per CLAUDE.md) and depends on the `fyj_scanner` f-148 RPC being applied to the index. Degrades safely: dense-only `searchJobs` if the RPC 404s; RRF order if `VOYAGE_API_KEY` is unset.

**Deploy order:** apply `fyj_scanner` `supabase/schema.sql` (f-148) to the index **first**, then `wrangler secret put VOYAGE_API_KEY` + deploy the Worker. **What's next:** deploy + the f-133 RLS smoke test once infra exists; consider folding the soft seniority/comp signals into the f-136 LLM eval pass.

---

## 2026-06-26 — f-147 follow-up #2: LIVE root-cause of "tailor does nothing" = waitUntil cancel

Reproduced the "tailor résumé does nothing" report live and captured the cause with `wrangler tail`:

- Approving a match returns `tailoring:true` (Anthropic key present) but the résumé stays `pending`
  forever on a **cold** run. `wrangler tail` on a fresh match logged:
  *"waitUntil() tasks did not complete within the allowed time after invocation end and have been
  cancelled."* The tailoring (`c.executionCtx.waitUntil(tailorMatchBackground)`, a draft→critique→
  revise Sonnet chain) outlasts Cloudflare's short post-response budget and is **killed before
  `saveTailoredResume`** → stuck pending. A *warm-cache* re-kick finishes fast enough to slip in,
  which is why a 2nd attempt works and the 1st "does nothing".
- **Fix:** run tailoring in the **queue consumer** (full background invocation, generous budget),
  not request `waitUntil`. Added a `TailorJob` queue message (`{kind:"tailor", matchId, principal}`);
  `approve` + `POST /api/matches/:id/tailor` now `MATCH_QUEUE.send(...)` (enqueue is fast, fits
  waitUntil) instead of running the chain inline; `src/index.ts` `queue()` discriminates `MatchJob`
  vs `TailorJob` and runs `tailorMatchBackground` for the latter. `worker-configuration.d.ts` gains
  `TailorJob`/`QueueJob`; `MATCH_QUEUE: Queue<QueueJob>`. Worker `tsc` green.
- Needs a `wrangler deploy` to take effect (shares the existing `fyj-match` queue — no new infra).

---

## 2026-06-26 — f-147 follow-up: LIVE root-cause of "no matches" = seniority filter

Live-verified against the deployed Worker with an operator login the user provided, and found the
**actual** cause of the "no matches" report (it was NOT just an empty candidate):

- The one candidate (`025ad1b4…e413`, "Sai Vamshi K") **had an embedded résumé profile** ("AI
  Engineer", embedded 06-25, skills extracted) yet **0 matches**. Triggering `POST
  /api/profiles/:id/match` surfaced **0**.
- Isolated it by relaxing `target_filters` via `PATCH /api/profiles/:id` + re-running match:
  `{seniority:["mid"], targetOnly:…}` → **0**; drop seniority → **25**. So the **`seniority`
  filter zeroes the index search** — the exact same controlled-vocabulary mismatch the code already
  works around for `families`. (Remediated the live profile: cleared seniority → 25 real matches
  now surfaced, e.g. Data Engineer @ tavus fit 85.)
- **Fix (this change):** stop sending `seniority` to the index everywhere it carries role fit via
  the embedding anyway — `intake.ts toFilters()` and `repo.applyResumeExtraction` no longer add it;
  `matcher.ts` (cron) and the `POST /api/profiles/:id/match` route now **defensively drop**
  `seniority` (alongside `families`) so profiles embedded before this fix also recover without a
  re-upload. Seniority stays in `parsed_profile.candidate` for display.
- Gates: worker `tsc` green. **Needs a `wrangler deploy`** to take effect for future uploads / the
  cron; the live remediation above already fixed the current candidate. Also pending deploy: the
  rest of f-147's backend (Experience extraction, `/extraction` + `/tailor` endpoints, index
  timeouts). SECURITY: a Cloudflare API token was shared in chat to enable the deploy — **rotate it**.

---

## 2026-06-26 — f-147: Overview Experience/Skills sections + match/tailor robustness

Reworked the candidate **Overview** per live-console feedback (the
Email/Phone/Status/Consent/Portal/Added grid wasted space; no matches showed; "tailor résumé" did
nothing) and hardened the two flagged paths. Merged on top of f-146 (documents tab / activity
feedback / prompt caching) — both coexist.

- **Overview UI (`web/app/(app)/clients/[id]/page.tsx`):** removed the detail `<Card>` grid
  (redundant with the hero status/consent chips + edit-profile modal). Under the heatmap/agenda:
  an **Experience** section (work history) then a **Skills** section — both from the candidate's
  primary résumé profile (`parsed_profile.candidate`) and **editable inline** (Experience =
  add/remove role cards w/ title·company·period·summary; Skills = chip add/remove). Empty states
  route to the Tracks tab. Kept f-146's Documents tab + Activity Feedback panel.
- **Résumé extraction (`src/graph/intake.ts`):** `ExtractedCandidate` gains structured
  `experience[]`; gpt-4o-mini prompt asks for up to 6 recent roles; `normalizeCandidate()` guards
  arrays; extract maxTokens 700→1500. Rides existing `attachResume` persistence.
- **Persistence:** `repo.updateProfileCandidate` read-merges `experience`/`skills` into
  `parsed_profile.candidate` (display-only, not re-embedded); `PATCH /api/profiles/:id/extraction`;
  `api.updateProfileExtraction`. No schema migration.
- **Matches robustness:** `src/index-client.ts` 8s `AbortController` timeout on `search_jobs`/
  `get_job` so a slow index can't hang `GET /api/matches`; Matches tab now shows a load-failure
  state (with Retry) distinct from empty (the error was previously swallowed → looked like "no
  matches").
- **Tailor robustness:** `POST /api/matches/:id/tailor` kicks (re-kicks) tailoring without changing
  the match action and returns a reason (`no_resume`/`no_ai`); the drawer kicks on open and shows a
  clear blocked message instead of an endless spinner.
- **Verification:** gates green — worker `tsc`, web `tsc`, `next build`. Drove the real Next app in
  headless Chromium (mocked `/api/**`): new Overview, Experience/Skills edit+save, Matches chips,
  Approve→drawer pending→ready, no-résumé blocked state. Backend changes need a `wrangler deploy`;
  UI ships on PR merge (Vercel). Likely root cause of the user's "no matches/tailor" report: the
  candidate had **0 activity** → no résumé uploaded → nothing to match/tailor.

---

## 2026-06-26 — f-146: prompt caching + activity feedback panel + documents tab

Three requested improvements.

- **Prompt caching (where it pays off).** `src/graph/llm.ts` `anthropicText`/`anthropicJson` now take
  cacheable segments (`Seg = string | {text, cache?}`) and emit `cache_control:{type:"ephemeral"}` on
  flagged blocks; cache usage is logged when non-zero (verify via `wrangler tail`). **Tailoring** is the
  real win: one `WRITER_SYSTEM` shared by draft+revise (both Sonnet) with a byte-stable cached prefix
  (candidate+master+job) and the per-call TASK after the breakpoint, so `revise` reads the cache `draft`
  wrote; `critique` (Haiku) caches job+master. **Enrichment** marks the candidate prefix cached
  opportunistically (only triggers if it clears Haiku's 4096-token min — short résumés won't; harmless).
  No beta header (caching is GA).
- **Activity feedback panel.** `db/policies.sql` adds `feedback_staff_insert` (admin/operator,
  `can_access_client`) alongside the client-insert policy — additive, still no update/delete so feedback
  stays immutable. `repo.addStaffFeedback` + `listFeedback`; `POST`/`GET /api/clients/:id/feedback`; the
  Activity tab gains a Feedback panel (signal select + note → log; lists prior feedback).
- **Documents tab.** `repo.listDocuments` (master résumés from `client_profiles` + tailored from
  `reports⋈campaign_matches`); `GET /api/clients/:id/documents` (hydrates tailored titles via `getJob`)
  + `GET /api/clients/:id/profiles/:profileId/resume-file` (RLS-checked, streams the R2 object). Web
  Documents tab: résumé cards (Open file) + tailored cards (open the existing résumé drawer).
- **Gates green:** `./init.sh` + web `next build` (`/clients/[id]` 16.8 kB).
- **To go live:** `wrangler deploy` (routes + caching); **re-apply `db/policies.sql` to Neon** for
  `feedback_staff_insert` (staff feedback INSERT fails closed until applied — everything else works on
  deploy alone); UI ships on PR merge (Vercel).

---

## 2026-06-25 — f-144: candidate Overview heatmap + agenda + edit-profile modal

Enriched the candidate profile **Overview** tab and added full-detail editing.

- The two requested `devl.dev` registry items are **mock showcase pages** (the year-heatmap fetches the
  GitHub contributions API for a username; the agenda is static) and pull `@coss/*` deps + an
  `AvatarImage`/`Skeleton` API this project doesn't have — so a verbatim `shadcn add` would drop in
  disconnected demos. Instead I **adapted their visual language** into data-driven components:
  - `web/components/candidate-heatmap.tsx` — GitHub-style 53-week grid (teal quartile scale, month/
    weekday labels, legend, active-days + longest/current streak), built from a date→count map over
    the candidate's `matches.surfacedAt` + applications `appliedAt`/`updatedAt`.
  - `web/components/candidate-agenda.tsx` — tone-bar timeline grouped by day (lucide icons), from the
    candidate's applications/placements.
  - `web/components/edit-candidate-dialog.tsx` — centred modal (Esc + scroll-lock) editing
    name/headline/email/phone/status/consent/notes via `api.updateClient`, plus a read-only
    campaigns + résumé-text viewer.
- **Backend:** `updateClient` (repo) + `PATCH /api/clients/:id` extended to accept
  `fullName/email/phone/notes` (was status/headline/consent only); empty name rejected. No schema
  migration — those columns already exist.
- **Wiring:** Overview renders heatmap + agenda in a 2-col grid; an **Edit profile** (pencil) button
  in the hero opens the modal; `lib/api.ts` `updateClient` input widened.
- Gates green: `./init.sh` + web `next build` (`/clients/[id]` 15.6 kB). Backend field persistence
  needs a Worker deploy; the UI ships on PR merge (Vercel).

---

## 2026-06-25 — f-141: end-to-end candidate value loop (LangGraph intake / enrich / tailor)

Delivered the product's core value loop: **upload résumé → AI extracts the candidate + targeting
criteria → 20–25 ranked, explained matches → operator accepts/declines → accepting tailors the
master résumé** (editable Markdown, client-side PDF). Code landed in commit `a7a2a8d` (already
pushed); this session set the missing secret and verified the LLM path.

- **LangGraph.js embedded in the Worker** via `@langchain/langgraph/web` (zod pinned to v3 — v4
  crashes the workerd runtime at init). Three graphs in `src/graph/`: `intake.ts` (extract
  `gpt-4o-mini` → summarize → embed → search), `enrich.ts` (per-match rationale / matched / missing /
  guardrails via Claude Haiku), `tailor.ts` (draft → critique → revise, ≤2 iterations; Sonnet
  draft/revise + Haiku critique). `src/graph/llm.ts` holds Workers-safe raw-fetch OpenAI/Anthropic
  helpers; `hasAnthropic()` makes enrichment/tailoring a graceful no-op when the key is absent.
- **Backend:** `db/policies.sql` adds `app.upsert_campaign_for_profile` (SECURITY DEFINER, granted
  `ops_app`) so a UI "campaign" = a `client_profiles` row + its 1:1 `campaigns` row; repo
  `createProfile` auto-creates the campaign; `runMatchNow` / `applyResumeExtraction` (populates
  headline + index-safe `target_filters`; dropped `families` from index filters — the index vocab
  zeroed results), `enrichMatch`, `approveMatch` tailoring + `reports` storage. `api`: resume route
  runs the intake graph then enriches in `waitUntil`; `POST /api/profiles/:id/match` (on-demand);
  approve triggers tailoring in `waitUntil`; `GET/PUT /api/matches/:id/resume`.
- **Web:** Campaigns panel (`CampaignCard` + Find matches), `MatchRow` rationale/skills/guardrails +
  Approve/Decline, tailored-résumé drawer (poll → edit → Save → print-to-PDF).
- **This session — unblock + verify the LLM path:** `./init.sh` green (Worker tsc + `db:generate`
  no-drift + web tsc). Set **`ANTHROPIC_API_KEY`** as a Worker secret (`wrangler secret put`, via
  stdin) → live version `5c974d1c` (a "Secret Change" deploy over the 06:46 f-141 bundle
  `c7cb3894`). Validated the key directly against both model IDs the code calls
  (`claude-haiku-4-5-20251001`, `claude-sonnet-4-6` — both returned 200/OK). Live Worker healthy and
  auth-enforced (`401 unauthenticated`). A full `wrangler deploy` was intentionally **not** run (the
  auto-mode classifier flagged production deploy as unauthorized, and it's unnecessary — the live
  bundle already carries the f-141 code).
- **FULL E2E VERIFIED LIVE** (operator session, driven via the API with a login the user provided):
  sign in → create candidate + profile → upload résumé → intake extracted the candidate and surfaced
  **25 hydrated matches** → **enrichment (Phase C)** populated fit/confidence + a real Claude-Haiku
  rationale + matched/missing skills + guardrails (24/25 within seconds) → **approve** created a
  placement → **tailoring (Phase D)** produced a `claude-sonnet-4-6` tailored résumé (Markdown); GET
  returns `status=ready`, PUT operator-edit persists.
- **Bug found + fixed during verification** (`79ea9f3`, deployed version `feff73a2`): the tailor
  graph failed to build — LangGraph rejects a node whose name equals a state-channel key (*"draft is
  already being used as a state attribute…"*). Nodes renamed `write`/`review`/`revise`; channels stay
  `draft`/`critique`. Tailoring had been silently no-op'ing (résumé stuck `pending`) until this.
- **Quality finding (follow-up, not blocking):** the tailored résumé added skills the master résumé
  doesn't support (Next.js/React/tRPC/LLM/vector-search/OpenTelemetry/Grafana) despite the "never
  fabricate" instruction — the critique→revise loop didn't catch the additions. Tighten the
  DRAFT/CRITIQUE prompts so critique fails on any skill not grounded in the master.
- **Test data:** a candidate `E2E Test — Jordan Rivera (f-141 verify)` + a placement remain in the
  prod org (there's no delete-client endpoint).
- **SECURITY:** the `ANTHROPIC_API_KEY` and a Cloudflare API token were pasted into chat this
  session — **rotate both** once verification is done.

---

## 2026-06-25 — f-140: admin→operator→client onboarding MVP (username/password)

The console's onboarding model was inverted to match the product: **public self-sign-up is closed**
and accounts are **created by an admin**, not self-registered (the old flow had every signup mint a
separate org via a `user.create.after` hook, then invite-by-raw-user-id).

- **Auth (server):** added the Better Auth `username` plugin (`src/auth.ts`; client
  `usernameClient()` in `web/lib/auth-client.ts`) — staff sign in by **username**. Migration
  `drizzle/0003_curious_triton.sql` adds `user.username` (unique) + `display_username`. Removed the
  org-bootstrap `databaseHook`; `src/api.ts` **hard-blocks** `POST /api/auth/sign-up/**` (403).
- **Admin creates operators:** `POST /api/members {username,password,name?,role}` (admin-gated)
  creates the auth user via `auth.api.signUpEmail` directly (off the blocked route, so no cookie is
  minted for the admin; a non-deliverable placeholder email is synthesized) then
  `repo.addStaffMembership` adds an **active** membership in the admin's org. `listMembers` now joins
  `user` for username/name.
- **Seed path:** `POST /api/seed/org-admin` (guarded by `ADMIN_BOOTSTRAP_SECRET`) mints the first
  org + admin via `app.bootstrap_org_for_user`. Documented in `docs/INFRA-SETUP.md` (+ secret,
  + rewritten smoke test).
- **Web:** `sign-in/page.tsx` → username/password only, no sign-up toggle; `members/page.tsx` →
  "Create operator" form (username/password/name/role) + usernames in the table.
- **Client profile to the attached design** (decoded from the standalone HTML's gzip+base64 bundle):
  `clients/[id]/page.tsx` gains a cover-band hero + overlapping 96px avatar, meta row, skill tags,
  5-stat row (matches/in-flight/response%/interviews/offers), and **expandable match rows**
  (rationale, matched skills, gaps, guardrails, confidence) with **Decline** / **Approve & queue
  résumé** — the operator accept/decline, wired to existing `approveMatch`/`declineMatch`.
- **GATES GREEN:** `npm run typecheck` (Worker) + `cd web && npm run typecheck` + `npm run build`
  (13 routes; `/clients/[id]` 5.37 kB, `/members` 3.84 kB, `/sign-in` 4.45 kB) + `db:generate`
  no-drift. NOT runtime-verified (no infra this session): before live, apply migration `0003` to
  Neon, set `ADMIN_BOOTSTRAP_SECRET`, `wrangler deploy`, and seed the first admin.

---

## 2026-06-24 — f-139 Phase 4: Calendar — f-139 COMPLETE

Final phase of the operator-console rebuild (**f-139**). No schema/migration — schedule events are
**derived from `placements`**.

- **Backend:** `repo.listCalendarEvents` maps a placement's stage → an `interview`/`offer`/`call`/
  `sync` event, dated by `stage_changed_at ?? applied_at ?? updated_at`, RLS-scoped to the book;
  `GET /api/calendar?year=&month=` (month 0–11).
- **Web:** `calendar/page.tsx` replaces the stub — **Month** grid (Mon-start, today highlight,
  per-day event chips, day-detail panel) + **Agenda** list + prev/next/Today nav. `CalendarEvent`
  type + `api.listCalendar`.
- **GATES GREEN:** `./init.sh` + `cd web && npm run build` (13 routes; `/calendar` 3.94 kB).

### f-139 done — all four phases shipped on `claude/bold-cori-fohjtb` (PR #10)
1. Dashboard + top navbar (analytics home; navbar replaces the icon rail).
2. Explore + `campaign_matches` enrichment (fit/confidence/rationale/skills/guardrails; approve → placement).
3. Candidates roster + tabbed candidate profile (headline/consent/autopilot; pipeline stages).
4. Calendar (month/agenda from placements).

**Prod state:** migrations 0001+0002 + `db/policies.sql` applied to Neon this session (verified).
**Not yet live on the URL:** needs `wrangler deploy` (Worker routes) + **merge `claude/bold-cori-fohjtb`
→ `main`** (Vercel auto-deploys `web/`). The deployed Worker/UI are still the 06-20 versions.
⚠️ **Rotate the `neondb_owner` password** (pasted in chat this session).

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
