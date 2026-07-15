# Session Progress Log

Append/update at the top each session. Long-form rationale → commit messages + `docs/`.

---

## 2026-07-14 (later still) — P4: Activity worklist (f-157); UI header cleanup; PR #37

**Plan change first (user decision):** the Autopilot surface was REMOVED from Phase 4 in the plan
doc — no `GET /api/autopilot`, no Autopilot section — because no cron/queue job acts on the
`client_profiles.autopilot` flag (the matcher surfaces matches for manual review regardless), so
any Autopilot UI beyond the existing Profile toggle would be a control with nothing behind it.
The P2 toggle (`PATCH /api/profiles/:id`) stays the only place the flag lives.

**f-157 backend.** `activity_state` table (`drizzle/0006_woozy_tana_nile.sql`): org_id + UNIQUE
task_key + done_by/done_at — the worklist itself is DERIVED on every read; this only remembers
which derived tasks were checked off (stale rows for vanished tasks are harmless). Staff-only
org-scoped RLS (viewers read, admin/operator write). `repo.listWorklist`: review = action-new
matches (deduped per client+job, best fit first, cap 10), send = `ready_to_send` placements,
reply = `responded`, decide = `offer` + `drafted`; placements are linked back to their campaign
match via a separate (clientId, jobId)-IN query (a JOIN would duplicate rows when two tracks
surfaced the same job) for `/tailor/[matchId]` deep links; targets = active clients with ≥1
track, submitted-today from `placements.applied_at >= date_trunc('day', now())` vs
`max(3, tracks×2)` (prototype heuristic). `repo.setActivityDone` insert/delete — deliberately
NOT audited (checkbox toggles would spam the dashboard activity feed the audit log feeds).
Routes: `GET /api/activity/worklist` (hydrates review-task job titles via KV-cached `getJob` —
approve-created placements carry only jobId/companyId, their denormalized title cols are null)
+ `POST /api/activity/done` (task_key regex-validated so junk can't accumulate).

**f-157 frontend.** `/activity` replaces the placeholder (port of dash-activity.jsx): greeting +
date header, candidate filter + Open/All/Done segments, four category sections (icons, blurbs,
open counts), TaskRow with a PERSISTED done checkbox (optimistic flip, revert on API failure)
and a deep-link action button (Review → /review, Send → /tailor/[matchId], others →
/clients/[id]) — unlike the prototype, acting and checking-off are separate. Right rail:
per-candidate application targets + today's calendar events (from the existing month endpoint,
filtered client-side) + all-caught-up empty state. `Chip` gained an optional `title` prop.
Deviation: no fake times on agenda items (derived events are date-only — kind chips instead).

**Also this session (user request):** removed the page-title headers from Explore ("Explore" +
subtitle), Write ("Write" + subtitle) and Candidates (PageHeader title/subtitle; kept the
+ Add candidate button; PageHeader component untouched — Campaigns/Members still use it).
And opened **PR #37** (console-redesign → main, P0–P3 delta) — PR #36 had merged into the
tailor-lab stack base, not main, so #37 carries everything; Vercel preview built green.

**Live state.** Neon migration 0006 + policies APPLIED + verified live (RLS on, both policies,
ops_app sel/ins/del, journal row 7 recorded). Gates green (worker tsc · db:generate · web tsc ·
next build — /activity 5.24 kB). **Worker deploy PENDING — the permission classifier requires
per-instance user authorization; run `npm run deploy`** (with NODE_EXTRA_CA_CERTS set). Until
then the deployed Worker 404s the two new routes; the DB side is already in place. Post-deploy
smoke: GET /api/activity/worklist as vamshik (expect ≥6 send tasks + review tasks + targets),
POST /api/activity/done round-trip, then check /activity in the UI after the PR merges.

## 2026-07-14 (later) — P3: Write library + standalone tailor workspace (f-156); prod Worker verified live

**Live verification first (user request).** The user had deployed the Worker; verified the deploy
end-to-end with the operator login (`vamshik`): sign-in via `POST /api/auth/sign-in/username` →
`/api/me` resolves `staff/operator`; `/api/clients` returns the real book; `/api/applications` 6
rows; dashboard KPIs + 50-match review queue live; and the **f-155 placement stage-write was
driven for real** — `PATCH /api/placements/ad0f231e…` `ready_to_send → interview → ready_to_send`
(fresh `stageChangedAt` stamps each way; invalid status → 400; bogus id → 404). That closes the
"drive a live stage change after deploy" item from the previous session. Environment notes: curl
on this box needs `--ssl-no-revoke` (Norton TLS intercept breaks schannel revocation checks), and
`interviewing` is not a stage — the enum value is `interview`.

**f-156 backend.** New `resume_documents` table (`src/db/schema.ts` →
`drizzle/0005_luxuriant_starhawk.sql`): org_id, **nullable client_id** (org-wide drafts),
`source_match_id` → campaign_matches (links a workspace doc to its match; extension beyond the
planned column list, needed for find-doc-by-match), title, `body_json` (opaque editor doc:
{meta, blocks, versions}), version (bumps on every body write), r2_pdf_key (null for now —
export is client-side print-to-PDF like the drawer). RLS in `db/policies.sql`: staff-only, the
usual `can_access_client` gate with an `or client_id is null` escape for org-wide drafts; never
portal-visible. Repo CRUD is audited; `repo.getMatch` added (single hydrated match). Routes:
`GET/POST /api/resumes`, `GET/PATCH/DELETE /api/resumes/:id`, `GET /api/matches/:id`, and
**`POST /api/resumes/ai`** — Haiku line transforms (improve/grammar/shorter/longer/simplify/
continue/custom) with a system prompt that hard-bans invented employers/dates/metrics; takes
optional {jobTitle, company, missingSkills} context from the workspace. Pure LLM call, no DB.

**f-156 frontend.** `web/lib/resume-doc.ts` — the block model + **markdown round-trip in the
exact dialect `lib/resume-render.ts` renders** (`# Name`, contact para, `## SECTION`,
`### Role | Company<TAB>Date`, bullets; skills-list paragraphs under a Skills section parse back
into a chips block), plus coverage calc, LCS word-diff, docAddSkill. `components/resume-editor.tsx`
— the PlateKit port: contentEditable rows seeded on id/epoch (caret survives typing), hover
gutter (add/drag-reorder), Enter/Backspace block management, "/" slash menu, floating
bold/italic/underline/code/link toolbar, skills chips, inline-editable job rows, word-diff view,
and **real AI chips** calling /api/resumes/ai with accept/retry/discard (prototype's canned
rewrites replaced). `/write` — library grid (blank / from-candidate seeded from
parsedProfile.candidate / duplicate / delete) + editor with 800ms-debounced autosave, preview
iframe, Download PDF. `/tailor/[matchId]` — full workspace: loads the REAL tailored markdown
(polls while the queue tailors; kicks if missing, same contract as the drawer), rail with JD
coverage ring + per-requirement add buttons + rationale + guardrails, diff vs the as-loaded
generated version, **Save = saveTailoredResume** (the store the drawer/documents/send flow read),
**Save version → snapshots into the linked resume_documents row** (survives reloads, shows in
/write), Regenerate (re-enqueue + poll). Drawer gained an "Open workspace ↗" link.

**Deliberate deviations from the prototype** (why): no ghost-text autocomplete (canned fake), no
margin comments (no persistence model until messaging f-158), no AI dock chat (inline only), no
synthetic variants (production has ONE real tailored output + Regenerate; fake variants would
lie), meta is name+contact only (that's what the markdown/PDF engine renders).

**Gates.** `./init.sh` green (worker tsc; db:generate no-drift after 0005; web tsc) + web
`next build` green — 21 routes incl. `/tailor/[matchId]` (4.97 kB) and the real `/write` (3.45 kB).

**Closed out later the same session — user supplied the Neon owner URL + authorized deploy.**
- **Migration applied live** via `@neondatabase/serverless` WebSocket Client (raw 5432 blocked in
  this sandbox, same as f-152): drizzle `0005_luxuriant_starhawk` created `resume_documents`;
  `db/policies.sql` re-applied. Verified: RLS on, both policies present, `ops_app` has
  select/insert and stays non-BYPASSRLS.
- **Journal reconciled:** live Neon had NO `drizzle.__drizzle_migrations` at all (drizzle-kit
  migrate was never run there — every prior migration was applied manually). Created it and
  seeded all 6 entries (hash = sha256 of each file, created_at = journal `when`), so a future
  `npm run db:migrate` is a clean no-op instead of re-running 0000..0005 — 0004 re-running would
  have re-NULLed `client_profiles.embedding`.
- **Worker deployed** — version `e759e0a9-e302-42ec-b8b8-612f9177e491`.
- **Live-verified as `vamshik`:** `/api/resumes` full CRUD cycle (create → PATCH bumps version
  1→2 + persists `versions[]` → GET → DELETE → list `[]`); `POST /api/resumes/ai` returned a real
  Haiku rewrite ("worked on backend services…" → "Engineered backend services supporting product
  data pipelines…"); `GET /api/matches/:id` hydrates (Data Engineer @ tavus, fit 85, 7 matched
  skills). First request after deploy 404'd once (version propagation), fine seconds later.
- Earlier in the session, the prod placement stage-write was also driven live
  (`ready_to_send → interview → back`, fresh `stageChangedAt` both ways) — f-155's open item.

**Still open:**
1. **Rotate the Neon owner password** — pasted in chat this session (third occurrence of the
   pattern; docs/INFRA-SETUP.md standing rule).
2. ~~Vestigial `ops_system` role~~ — DROPPED later this session on explicit user authorization.
   Note the Neon quirk: `neondb_owner` isn't superuser, so `DROP OWNED BY ops_system` needs
   `grant ops_system to neondb_owner;` first (42501 otherwise). Verified after: role gone,
   `ops_app` grants intact + non-BYPASSRLS, live `/api/clients` still serves. P0's manual-cleanup
   item is fully closed.
3. Vercel ships /write + /tailor on merge to main (PR #35 first, then this branch's PR). UI-level
   smoke after merge: create/edit a doc in /write; open a match workspace → Save → drawer shows
   the edit; AI chip accept path.

---

## 2026-07-14 — Console redesign kickoff: hygiene (P0) + prototype design system (f-154, P1)

Start of the console-redesign workstream (plan: fyj_scanner plan doc; tracker: f-154…f-160,
seeded this session — portal/onboarding/billing remain f-137/f-145/f-138). Branch
`claude/console-redesign`, stacked on `claude/tailor-lab-gpt-models` (PR #35, **open — merge
it first**, then this branch's PR rebases clean).

**P0 hygiene (commit `e0c92ef`).** Retired the vestigial `ops_system` BYPASSRLS role:
`db/policies.sql` no longer creates it and all grants dropped `, ops_system` (fresh-DB safe;
manual cleanup documented in the file). Corrected the stale matcher/BYPASSRLS claims in
`README.md` + `CLAUDE.md` (matcher runs as `ops_app` through the SECURITY DEFINER `app.*`
fns), refreshed the ancient "P1 foundation" README status + CLAUDE.md runtime caveat,
fixed `src/api.ts` resume-attach fallback `embeddingModel` (`text-embedding-3-small` →
`voyage-4-large`, metadata-only), and seeded f-154…f-160 into `feature_list.json`.

**P1 design system (f-154).** `web/app/globals.css` remapped to the prototype's palette —
cool hue-275 neutrals (paper `oklch(0.977 0.002 270)`, ink `0.25/275`), muted-indigo
`--primary oklch(0.54 0.155 277)`, semantic ok/info/warn/bad, prototype dark block — with
the 8px radius scale restored (**removed `border-radius: 0 !important`**); `--accent` is a
`color-mix` wash off `--primary` so the runtime accent propagates. Fonts: Source Sans 3 →
**Geist + Geist Mono** (`next/font`), `--font-heading` var + `.label` mono-uppercase utility.
Navbar reworked to the prototype's icon-forward style (tooltips, active underline, badge
slots left un-faked) with new destinations **Activity / Inbox / Chat / Write** (Placeholder
pages pointing at f-157/f-158/f-156) + Candidate portal (`/portal`, public teaser page) +
**Preferences** dialog (dark / accent / density / heading font → `lib/prefs.ts`,
localStorage `fyj_prefs_v1`, pre-paint boot script in `app/layout.tsx` — keep the two in
sync). Ported primitives: `components/primitives.tsx` (FitScore, CompanyLogo marks,
DotColumns/DotTrack/DotBlock, braille loaders).

**Gates.** Worker `tsc` clean; web `tsc` clean; web `next build` green (20 routes incl. the
5 new). Live-verified on `next dev` + browser: body font = Geist, `--radius` 8px with real
10px card corners, `--primary`/`--background` = prototype values. NOT yet verified: the
pre-paint prefs boot in a real browser (permission-classifier outage mid-session) — flip
`fyj_prefs_v1` and reload to confirm no-flash dark/accent.

**Open for the user:** merge PR #35, then the redesign PR; `npm run deploy` (wrangler is
authed) so prod picks up the api.ts/policies hygiene — policies.sql re-apply is optional
(the retired-role edit is inert on an existing DB). NOTE: local `npm run deploy` hit the
Norton TLS intercept — set `NODE_EXTRA_CA_CERTS=$HOME\.career-ops\norton-root.pem` first
(same fix as fyj_scanner; consider persisting it as a user env var).

**P2 — surface richness + placement writes (f-155, same session).** Backend:
`repo.updatePlacement`/`createPlacement` + `PATCH/POST /api/placements` (staff non-viewer,
enum-validated, audited; stage change stamps `stage_changed_at`, first move to `applied`
coalesce-stamps `applied_at`) — no schema change (`db:generate` clean; the pipeline stages
and denormalized job cols already existed from f-139 P3). Web: Dashboard delta chips +
DotColumns throughput + accent funnel + **real Role/Company columns** (the "—" placeholders
were stale — placements carry job_title/company_name); Review: FitScore bars, CompanyLogo,
candidate filter, rounded chrome; **Explore rebuilt** — browse-mode discovery rails
(Fresh / Remote-first / Top-comp from one `recentJobs(60)` call; the web `JobHit` mirror was
dropping the workplace/comp/source/postedAt fields the Worker already returns — extended) +
search grid + slide-over drawer with the real posting description; Candidates roster search +
per-candidate new-matches/live-apps metrics; Profile applications tab **stage is now an
inline Select** → `PATCH /api/placements/:id`; Calendar rounded + CompanyLogo rows. Gates
green (worker tsc / web tsc / next build, 20 routes). Deliberate deviation: roster stays a
grid → detail navigation (adding search + metrics) rather than the prototype's collapsible
master/detail sidebar — the existing IA, far less churn. NOT runtime-verified end-to-end
(no `.dev.vars`); drive a live stage change after deploy.

## 2026-07-02 — Résumé Tailoring Lab (prompt/model A/B harness, f-153)

Built a staff-only experimentation page to A/B tailoring **prompts** and **model
combinations** across a **planner → generator → verifier → (revise loop)**
pipeline — the user wants to iterate on prompts and try model mixes without
editing code.

**Backend.** New `src/graph/tailor-lab.ts` re-runs the production tailor pipeline
as a plain (non-LangGraph) function where every stage's system prompt AND model
id are caller-supplied. Defaults ARE the shipped prompts — exported
`WRITER_SYSTEM`/`CRITIQUE_SYSTEM`/`lengthBand`/`lengthBudgetBlock`/`countWords`
from `tailor.ts` (single source of truth) + a new `DEFAULT_PLANNER_SYSTEM`
(production has no planner; the lab adds one as an optional pre-step whose plan
is fed to the generator). `src/graph/llm.ts` gained `callAnthropic` (text +
usage), `openaiText` (text + usage), a normalized `LlmUsage` shape, and
`runChat()` that dispatches by model id (`gpt-*`/`o[1-9]-*` → OpenAI, else
Anthropic) so any stage runs on either provider. `anthropicText` now delegates to
`callAnthropic` (no behavior change). Two staff-gated routes in `src/api.ts`:
`GET /api/tools/tailor-lab` (model catalogue w/ approx prices, prod defaults, a
runnable sample, provider-key presence) and `POST /api/tools/tailor-lab` (runs
synchronously, returns the full trace: each intermediate output + latency + token
usage + verifier pass/issues; resilient — a stage throw is recorded as a step,
not a 500). No DB access (inputs pasted) → works without infra.

**Frontend.** `web/app/(app)/tools/tailor-lab/page.tsx`: inputs (master / JD /
summary + Load sample), three per-stage config cards (model **datalist** so you
can pick a known model or type any id + editable system-prompt textarea; planner
has an enable toggle), max-iterations select, a run trace of collapsible step
cards (tokens / latency / est-cost, verifier pass·fail + issues), and a final
résumé preview (rendered iframe via `lib/resume-render`, with Markdown/Copy).
Nav link added to the profile menu ("Tailor Lab"). Types mirrored in
`web/lib/types.ts`; client methods `tailorLabConfig`/`runTailorLab` in
`web/lib/api.ts`.

**Follow-up (same feature): résumé upload.** Added an "Upload résumé" button to
the lab Inputs card so the master field can be populated from a PDF/DOCX/text
file instead of pasting. New `POST /api/tools/tailor-lab/parse` (staff-gated)
reuses `parseResume` (src/resume.ts, unpdf/fflate) for pure bytes→text — no R2,
no embedding, no DB, unlike the real intake route. Client method
`parseTailorLabResume(file)`. Gates re-run green (Worker tsc · web tsc · web
build; lab route now 11 kB). NOTE: the parse route needs a Worker redeploy to go
live (same as the rest of f-153).

**Follow-up 2 (same feature): newer-model support + model picker + résumé
download.** (1) Fixed a hard failure when a stage used a newer model — Sonnet 5
/ Opus 4.8 reject `temperature` ("temperature is deprecated for this model"), and
GPT-5 / o-series reject `temperature` AND require `max_completion_tokens` instead
of `max_tokens`. `callAnthropic` and `openaiText` (src/graph/llm.ts) now ADAPT on
the specific 400: drop `temperature` and/or switch the token param and retry,
rather than hardcoding per-model behavior (self-heals for future models; older
models unchanged). (2) Added GPT-5 / GPT-5-mini / GPT-5-nano to `LAB_MODELS`. (3)
Model picker reworked from a flaky `<datalist>` (had a `Math.random()` id →
hydration mismatch) to an explicit provider-grouped `<select>` PLUS an
always-visible free-text field, so any model id can be selected or typed. (4)
Final résumé in the lab gained **Download PDF** (print-to-PDF via
lib/resume-render, same as the drawer) + **Download .md** buttons. Gates green
(Worker tsc · web tsc · web build; lab route 11.3 kB). NOTE: the llm.ts fix + new
GPT-5 catalogue entries are BACKEND — need a Worker redeploy; the picker + download
buttons are frontend-only (hot-reload).

**Follow-up 3 (same feature): output-truncation fix.** Long résumés came back cut
off mid-document (a real data-engineer résumé stopped at "…with monito,"). Root
cause: the generator/revise calls were hardcoded to `max_tokens: 4096`, so a long
tailored résumé exceeded it and got clipped — then the verifier's length gate saw
a short draft and looped a revise that also clipped. Fix: `LabRequest` now carries
`maxOutputTokens` (default 8000, clamped 1000–32000), applied to both generator +
revise calls (`maxOut` in runTailorLab); exposed as a "Max output tokens" number
input in the lab run bar. NOTE for reasoning models (GPT-5/o-series) the budget
also covers hidden reasoning tokens, so long résumés there may need a higher
value. INPUT is NOT truncated in the lab (unlike production tailor.ts which slices
master→16k / JD→8k chars). Gates green (Worker tsc · web tsc · web build; lab route
11.4 kB). BACKEND change → needs a Worker redeploy to take effect; the old deploy
ignores `maxOutputTokens` and stays at 4096.

**Follow-up 4: same truncation fix in PRODUCTION tailoring.** `src/graph/tailor.ts`
(the real approve-match → tailored-résumé path, run on the queue) had the same
hardcoded `max_tokens: 4096` on draft+revise. Raised to a `WRITER_MAX_TOKENS = 8000`
constant, and gave the input more headroom (master slice 16k→32k chars, JD
8k→12k). Worker tsc clean. Needs a Worker redeploy like the rest.

**Design notes / caveats.** (1) The POST runs the whole pipeline **synchronously
in-request** (not the queue) so the trace returns at once — deliberately unlike
production tailoring which moved to the queue for the f-147 `waitUntil` reason;
kept safe by capping revise iterations at 3. (2) `LAB_MODELS` prices are
approximate/display-only for the cost estimate — one obvious constant to edit.
(3) Cross-provider stages skip prompt caching (plain strings) — fine for one-off
lab runs. (4) NOT runtime-verified — no provisioned infra; a live run needs the
deployed Worker + `ANTHROPIC_API_KEY` (present) and `OPENAI_API_KEY` for GPT
stages.

**Gates.** Worker `tsc` clean · `db:generate` no schema changes · web `tsc` clean
· web `next build` green (`/tools/tailor-lab` 9.89 kB in the route table).

---

## 2026-07-02 — Résumé tailor template + observability rollout; embedding fix reconciliation

Three things landed this session, plus a genuine conflict with the f-152 work
below that's worth understanding if you hit something similar.

**1. Résumé tailor upgrade** — ported the stronger generator prompt + strict
markdown/template conventions from the sibling `fyj_scanner` repo (its f-402
generator + f-406 renderer): `src/graph/tailor.ts`'s `WRITER_SYSTEM` now carries
scaffold preservation, JD-skills-in-bullets, exhaustive bolding, and the
`# Name` / `## SECTION` / `### Title | Company<TAB>Date` conventions the
renderer depends on, plus a ±10% length budget with a local length gate in the
critique node. New `web/lib/resume-render.ts` — dependency-free TS port of the
scanner's markdown→HTML renderer + print-tuned Word/Cambria CSS. The tailor
drawer now defaults to a rendered preview (isolated iframe) with a Preview/Edit
toggle; PDF export uses the same renderer.

**2. Observability** — Sentry (errors + `hourly-matcher` cron monitor), PostHog
(`resume_uploaded`/`match_run`/`match_approved`/`tailor_completed`/`_failed`
events, org-grouped), LangSmith (traces on `runIntake`/`tailorResume`),
Cloudflare AI Gateway (LLM transport logging/cost). New `src/observability.ts` —
all four seams optional/env-gated, no-ops until their secret is set. Live-
verified: Sentry envelope 200, PostHog capture `Ok`, LangSmith trace visible,
AI Gateway `fyj` created (acct `489409dba6e11499199acff6ffb8eddf`) and routing.
Worker secrets set (`SENTRY_DSN`, `POSTHOG_API_KEY`, `LANGSMITH_API_KEY`,
`AI_GATEWAY_URL`); Vercel env set for the web side.

**3. Embedding fix — discovered a duplicate, reconciled with real data.** While
independently root-causing why matching was dark (NULL `client_profiles.
embedding`), this session re-derived and shipped almost the same fix the
**f-152 entry below already did** (a local `main` that was 4 commits stale
meant the collision wasn't visible until PR time). The only real difference:
this session's `embedRaw`/`embedText` both used Voyage `input_type='query'`;
f-152 below uses `document`/`query`. **Ran a live A/B against the real index
using the actual 3 profiles' stored summaries** (not synthetic text) before
deciding: `document` beat `query` by **+0.10 to +0.16 absolute cosine on every
single profile** (e.g. Backend Engineer: 0.89 vs 0.73 top-1). Reason: the
résumé precis (`src/summarize.ts`) is deliberately built in the SAME
`Key: value` JD-shaped structure as a job's `buildJobText` — it's document-
shaped text, not a short natural-language search string, so Voyage's `query`
role (tuned for short NL queries — which is exactly what `embedText`'s
command-bar searches are) fits it poorly. **f-152's choice was correct; this
session's independent one was a regression** and has been discarded — the
duplicate commit was dropped rather than merged. **Live state was briefly
wrong**: this session deployed its `query`/`query` version to production
*after* f-152 was already merged (never pulled first), so prod ran the worse
code for a short window with the 3 live profiles backfilled under it. Both
are now fixed: production redeployed from the real `origin/main`, all 3
profiles re-embedded with `document` (verified: cosine now 0.83–0.89, matching
the A/B numbers exactly).

**Lesson for future sessions:** `git fetch && git log main..origin/main`
before opening a PR, always — this collision was only caught because GitHub
refused the merge (`mergeStateStatus: DIRTY`), not because anything local
flagged the drift.

---

## 2026-06-30 — f-152: embeddings OpenAI -> Voyage voyage-4-large (1024d), both repos

- **Why both repos:** `src/embeddings.ts`'s own doc comment says the query-side embedding model MUST stay in lockstep with whatever fyj_scanner embeds jobs with, or cosine scores are meaningless. Confirmed fyj_scanner (`~/Desktop/fyj_scanner`) was still on OpenAI `text-embedding-3-small` (1536d) — yesterday's Voyage change was rerank-only (f-149), not an embed swap. So this migration touches BOTH repos in lockstep, not just this one.
- **fyj_scanner** (`src/embeddings.mjs`): now calls Voyage `voyage-4-large` (`input_type=document`, `output_dimension=1024`) instead of OpenAI; response shape changed (`{embeddings,total_tokens}` vs OpenAI's `{data:[{embedding}]}`). `supabase/schema.sql`: `jobs.embedding` -> `vector(1024)`, guarded by a `DO` block checking the column's CURRENT dimension (via `format_type`) so re-running schema.sql after the first apply is a no-op — without the guard every deploy would re-null embeddings. Nulls `embedding`/`embedding_model`/`embedded_at` before the `ALTER COLUMN TYPE` (hard cutover — old 1536d vectors can't cast to 1024d), drops+recreates the HNSW index. Also updated the manual test scripts (`scripts/embed-resume.mjs`, `scripts/match-resume.mjs`) and the backfill script's key-check message.
- **Scale check (via Supabase MCP against `mwcpoaefmggapztkxakp`):** of 341,349 total job rows (168,374 active/open), only **8,772** had ANY embedding before this change — the OpenAI backfill was never run to completion. So the real blast radius of the hard cutover is ~8.7k rows, not the full index.
- **Data-drift finding (unrelated to this task, flagging for later):** `search_jobs`/`search_jobs_hybrid`/`get_job`/`recent_jobs` RPCs are live on Supabase but do **not** appear anywhere in `fyj_scanner`'s `supabase/schema.sql` on any local branch — they were applied out-of-band (likely via a prior session's direct MCP `apply_migration`) without being persisted back to the idempotent schema file, which fyj_scanner's own CLAUDE.md rule 3 says shouldn't happen. Didn't fix this now (out of scope) — worth a follow-up to reconcile schema.sql with what's actually deployed.
- **ops-console** (`src/embeddings.ts`): same Voyage swap, reusing the **existing** `VOYAGE_API_KEY` secret (already set for f-149 rerank — no new secret needed). `embedRaw` (résumé intake, mirrors `buildJobText`'s document shape) uses `input_type=document`; `embedText` (command-bar NL query) uses `input_type=query` — Voyage's asymmetric-retrieval pairing, a quality upgrade OpenAI's endpoint didn't offer. `src/db/schema.ts` embedding -> `vector(1024)`; generated `drizzle/0004_pale_guardian.sql`, then hand-added an `UPDATE ... SET embedding=NULL` before the `ALTER COLUMN TYPE` (same hard-cutover reasoning — drizzle-kit's raw generated ALTER would fail to cast any existing 1536d row). `OPENAI_API_KEY` is untouched — still required for `graph/llm.ts` (gpt-4o-mini intake extraction) and `summarize.ts` (résumé precis); only the embedding call moved providers.
- **Environment note:** this machine needs `NODE_EXTRA_CA_CERTS=~/.career-ops/norton-root.pem` for `npm install`/`wrangler` to reach the registry (Norton TLS interception, same issue documented in fyj_scanner's CLAUDE.md) — wasn't set by default in this shell; setting it unblocked `npm install` (`Exit handler never called!` npm errors beforehand were this, not a real npm bug).
- **Gates green:** ops-console `npm run typecheck` + `npm run db:generate` (no drift after generating 0004). fyj_scanner has no equivalent typecheck (plain `.mjs`, no build step) — reviewed by hand.
- **NOT done this session (needs credentials this sandbox doesn't have):** fyj_scanner's `.env` has no `VOYAGE_API_KEY` yet, so the schema.sql migration hasn't been applied to live Supabase and `npm run embed-backfill` hasn't been run. ops-console's Neon migration (`db:migrate`+`db:policies`) and `wrangler deploy` weren't run (no `DATABASE_URL`/wrangler auth in this session). **Any existing `client_profiles.embedding` will be nulled once the Neon migration runs** — matcher.ts already treats null embedding as "nothing to match" (no crash), but affected campaigns surface zero new matches until the résumé is re-uploaded (re-triggers `embedRaw`); there's no recompute-without-reupload path, which is fine for now (test data only) but worth knowing.
- **Next steps to actually go live:** (1) add `VOYAGE_API_KEY` to `fyj_scanner/.env`, apply `schema.sql` to Supabase, `npm run embed-backfill`; (2) `db:migrate` + `db:policies` against Neon, `wrangler deploy` ops-console; (3) re-verify live: upload a résumé, confirm a non-null 1024d `client_profiles.embedding`, confirm `search_jobs_hybrid` returns hits.

### Later same session — migrations actually applied live

User supplied a Neon `ops_app` connection string, a Cloudflare API token, and a Supabase `sb_secret_…` key directly in chat to unblock the deploy. **Flagging again: rotate all three** — pasted-in-chat credentials are the exact thing `docs/INFRA-SETUP.md`'s security-hygiene section already tells us to rotate, and this has now happened twice on this project.

- **Neon `ops_app` isn't a migration credential** — confirmed via `pg_roles` (queried through a scratchpad script using `@neondatabase/serverless`, since raw Postgres 5432 is blocked here same as always): `ops_app` has no `CREATEROLE`/`BYPASSRLS`, so `db:migrate`'s `ALTER COLUMN` and `db:policies`'s `CREATE ROLE` would both fail — asked the user for the `neondb_owner` (direct) connection string instead, which they provided.
- **Applied live via the owner role:** `drizzle/0004_pale_guardian.sql` + `db/policies.sql`, run through `@neondatabase/serverless`'s `Client` (WebSocket, needs `neonConfig.webSocketConstructor = ws` on Node <22 — no native WebSocket). Verified: `client_profiles.embedding` is now `vector(1024)` live; 3 existing rows nulled (hard cutover, as planned).
- **Applied to Supabase (`mwcpoaefmggapztkxakp`) via the MCP `apply_migration`:** `jobs.embedding` → `vector(1024)`, HNSW rebuilt. Hit a real blocker mid-migration: `public.v_jobs_enriched` (a view — `SELECT j.*, jd.description FROM jobs j LEFT JOIN job_descriptions jd`) depends on `jobs.embedding` and blocks `ALTER COLUMN TYPE`. **This view (and the `job_descriptions` table it joins) aren't in `schema.sql` at all** — same undocumented-drift pattern as the `search_jobs`/`search_jobs_hybrid`/`get_job`/`recent_jobs` RPCs flagged earlier this session. Captured the live view definition via `pg_get_viewdef`, dropped it, ran the migration, recreated it verbatim, and added the drop+recreate to `schema.sql` so re-running the file stays idempotent (confirmed grants on the recreated view match Supabase's default anon/authenticated/service_role/postgres set — nothing lost). `search_jobs_hybrid` itself queries `public.jobs` directly, not the view, so it's unaffected.
- **Deploy blocked in-session, punted to the user:** `wrangler` 4.x requires Node ≥22; this machine has 20.15.1 on PATH with no nvm/volta. Asked the user — they'll run `npm run deploy` themselves rather than have a portable Node 22 downloaded just for this.
- **Still open:** `fyj_scanner/.env` has no `VOYAGE_API_KEY`, so `npm run embed-backfill` hasn't run — `jobs.embedding` is currently all-null, so dense/hybrid search returns 0 rows (soft-degrades per `matchProfile`'s design, doesn't error) until someone adds the key and runs the backfill. The ops-console Worker itself also hasn't been redeployed yet, so it's still running the OLD (OpenAI, 1536d) embedding code against a NOW-1024d `client_profiles.embedding` column — **any résumé upload between now and the deploy will hard-fail** (dimension mismatch on insert). Deploy this ASAP.

### Later same session — backfill, a real Voyage response-shape bug, Node upgrade, deploy

User supplied `VOYAGE_API_KEY`, added to `fyj_scanner/.env`. Asked to scope the backfill to **summarized jobs only** (`EMBED_SUMMARIZED_ONLY=1`, 5,617 jobs) rather than all 168k active jobs — worth recording why: `search_jobs_hybrid`'s lexical arm only indexes `title`+`description_summary`, so an unsummarized job has no lexical signal either way; embedding it with a noisy raw-description fallback wouldn't actually buy much, so scoping to the already-summarized set keeps dense+lexical coverage consistent.

Two real bugs surfaced (and got fixed) while actually running this, which pure code review hadn't caught:
1. **`scripts/backfill-embeddings.mjs` selected `jobs.description`, which doesn't exist anymore** — it moved to a separate `job_descriptions` table at some undocumented point (same drift pattern as the RPCs/view found earlier). Fixed by fetching `job_descriptions` separately in chunks of 200 `job_id`s (no FK for PostgREST to embed the join) and merging by id in JS.
2. **Voyage's actual embeddings response isn't `{embeddings:[...], total_tokens}`** as the doc summary I'd pulled earlier claimed — it's OpenAI-shaped: `{data:[{embedding,index}], usage}`. Verified with a raw `fetch()` test call. This was wrong in **both** `src/embeddings.mjs` (fyj_scanner) and `src/embeddings.ts` (ops-console, not yet deployed at the time — caught before it shipped). Fixed both to read `data.data[].embedding`, sorted by `index`.

After both fixes: backfill ran clean — **5,617/5,617 embedded, 0 failed, 148s, $0** (within Voyage's free tier).

User then asked to update Node system-wide and deploy. This machine had Node pinned via the `OpenJS.NodeJS.20` winget package (20.15.1) — uninstalled it, installed `OpenJS.NodeJS.LTS` (24.18.0). Note: `winget install` failed against the default source set with a TLS certificate error (`0x8a15005e`) — same Norton-MITM root as always, but winget has no `NODE_EXTRA_CA_CERTS`-equivalent override; pinning `--source winget` (skipping the `msstore` source lookup) avoided it.

**Deployed:** `npm run deploy` → version `e5da98cb-25e3-4481-a5e8-eb20144e90e0`, live at `https://fyj-ops-console.saikiran13055.workers.dev`. Confirmed healthy: `GET /api/health` → 401 `unauthenticated` (auth live, not a crash).

**f-152 is now fully live end-to-end**: Neon `client_profiles.embedding` is `vector(1024)`, Supabase `jobs.embedding` is `vector(1024)` with 5,617 jobs embedded, and the deployed Worker is running the new Voyage code. Open items: rotate the three credentials pasted in chat this session (Neon owner password, Cloudflare token, Supabase key); optionally run the full unscoped backfill later for broader dense-search coverage over the unsummarized ~162k jobs; no live résumé-upload smoke test was run this session (nothing prompted one).

### Later same session — user hit "different vector dimensions 1536 and 1024" running fyj_scanner matches

Two more stale spots the migration missed, both in `fyj_scanner`'s local dev-testing scripts (not the production path, but real breakage for anyone using them):
1. `scripts/_resume.vec` was a cached 1536d vector from **May 22** — predates this entire migration by weeks. Being fed into `match_resume`/`match_resume_candidates` RPCs (two more undocumented-in-schema.sql functions, discovered live via `pg_get_functiondef` — both take an untyped `vector` param and compare against `jobs.embedding`, so no DB-side fix needed, just a fresh query vector).
2. `scripts/embed-resume.mjs`'s own inline Voyage fetch call still had the **same response-shape bug** fixed earlier in `src/embeddings.mjs`/`.ts` (`data.embeddings[0]` instead of `data.data[0].embedding`) — missed because I only fixed the shared module, not this script's independent fetch call. Fixed it, plus `scripts/call-match.mjs`'s hardcoded `vec.length !== 1536` check (now `1024`).

Regenerated `scripts/_resume.vec` (1024d confirmed) and re-ran `scripts/call-match.mjs` against live Supabase — **30 matches returned with sane cosine scores** (Gen AI / ML engineering roles for the test résumé). Confirms the whole pipeline (embed query → `match_resume_candidates`/`match_resume` RPC → `jobs.embedding` vector(1024)) is consistent end-to-end now.

**Lesson for later:** when a migration touches a shared module used by multiple call sites, grep for *inline* duplicates of the same logic (scripts that re-implement the same fetch instead of importing the module) — `embed-resume.mjs` and `call-match.mjs` both duplicate logic from `src/embeddings.mjs` instead of importing it, so fixing the module didn't fix them.

## 2026-06-29 — f-151: Explore browse-by-default + reranked search; match dedup; delete track

- **Explore browses newest jobs by default** (no query): new index RPC `recent_jobs(filters)` (newest active, applied to Supabase as `f151_recent_jobs`) → `/api/jobs/recent` → `index-client.recentJobs` → Explore default view. A query runs hybrid+rerank search. **Dropped all candidate-fit framing** from Explore (no "% match" chip / rationale) — it's job discovery.
- **`/api/search` now goes through hybrid + Voyage rerank** (the same `matchProfile` pipeline as candidate matching; the NL query doubles as the lexical-arm query and the rerank query), then hydrates. Verified: "remote senior data engineer python aws spark" → Senior Data Engineer roles on top.
- **Match dedup** (`repo.listMatches`): collapse rows by `(clientId, jobId)` keeping best fit, so two similar tracks no longer show the same job multiple times in the candidate Matches tab / Review queue.
- **Delete track**: `repo.deleteProfile` + `DELETE /api/profiles/:id` (RLS `client_profiles` staff-write + FK cascade to campaign/matches) + a **Delete** button on the CampaignCard (Tracks tab, with confirm).
- **Verified live** (Worker `ce8cb40a`, admin session): recent jobs, reranked search, delete route (404 on bogus id). Gates: Worker tsc + web tsc + `next build` green.
- ⚠️ **Web deploy:** these UI changes (and f-150's Explore/Review) only reach the user once **Vercel deploys** — Vercel tracks the production branch, so the feature branch must be merged/deployed. The Worker + index are already live.

---

## 2026-06-29 — f-150: Explore → general job search; Review queue; admin-role hardening

Follow-ups after the f-149 deploy.

**Explore tab is now general NL job search** (was the candidate match-review queue). `web/app/(app)/explore/page.tsx` rebuilt around `api.searchJobs` → `/api/search` (embed query → `searchAndHydrate` over ~169k jobs), `?q=` driven. The match-review queue (approve/decline across the book) was **moved to a new `/review` route** + a "Review" nav item (`components/navbar.tsx`) so the approve→placement/tailoring flow isn't lost. `/jobs` (profile-specific reranked view via `?profile=`) is unchanged.

**Auth: `resolvePrincipal` hardened** (`src/principal.ts`). A multi-membership staff user now defaults to the **highest-privilege role** (admin>operator>viewer) with a stable tiebreak, instead of the oldest-org role — `resolve_staff_memberships` only orders by `created_at`, and ties there made the resolved role non-deterministic across requests (could flip admin→operator).

**On the reported "admin switches to operator":** on live Neon the `admin` user has a **single** admin membership, and `/api/me` returns `role:"admin"` consistently (re-verified after deploy, version `9aadc58b`). So the server is NOT downgrading the role for this account — the hardening is latent-bug prevention. The symptom looks **client/session-side** (most likely a lingering operator/`vamshik` session in the same browser profile from earlier testing, given the cross-site `SameSite=None` cookies). Needs a repro (does it survive an incognito window? after refresh? what exactly shows operator?) to pin.

**Verified:** Worker `tsc`, web `tsc`, web `next build` all green (/explore + /review compiled). Worker deployed. Web ships via Vercel on push/merge.

---

## 2026-06-29 — f-149: hybrid retrieval + Voyage rerank-2.5 + soft signals on the match path

Cross-repo session (branch `claude/resume-tailor-job-matching-wr2i3o` in **both** repos). Moves the production profile↔job match path off dense-only cosine onto the validated **dense + lexical(RRF) → rerank → soft-adjust** pipeline, and fixes the filter design. The index side (lexical GIN + `search_jobs_hybrid` RPC) is **f-148** in `fyj_scanner`; this repo is the consumer.

**New pipeline — one orchestrator, every entrypoint.** `src/match.ts` `matchProfile()` is now the single path behind résumé intake (`graph/intake.ts` search node), on-demand `POST /api/profiles/:id/match`, the display `GET /api/profiles/:id/jobs`, and the background `matcher.ts`:
1. **Hybrid retrieve** — `searchJobsHybrid` (`index-client.ts`) → new `search_jobs_hybrid` RPC: dense (HNSW cosine) + lexical (`ts_rank_cd`) arms, RRF-fused (k=60), returning candidate text + comp + seniority.
2. **Voyage rerank-2.5** — `src/rerank.ts` (`rerankRelevance`), contract proven in `fyj_scanner/scripts/voyage-vs-openai.mjs`. **Non-fatal**: no `VOYAGE_API_KEY` / error / timeout → keep RRF order. Query = résumé precis; docs = job title+summary.
3. **Soft adjust** — `seniorityBand()` (coarse bands so the résumé's `mid` no longer zeroes against the index vocab) + comp-floor penalty that **never punishes null comp**. Small weights so the reranker dominates; both annotate `guardrails`.

**Filter design (the spec):** hard filters cut to `closed_at` + `targetOnly` + opt-in `remote` + `since`. `compFloor`/`families`/`seniority` are stripped from the predicates in `matchProfile` and applied softly. `department`/`employment_type`/`industry` stay embedding-only (already true — `fyj_scanner buildJobText` + the summary precis). Embedding model unchanged (`text-embedding-3-small`); Voyage is **rerank-only** → no re-embed.

**DB (no Drizzle migration — reused existing columns + `parsed_profile` jsonb).** `db/policies.sql`: `get_campaign_for_match` now also returns `resume_text` + `parsed_profile` (drop+recreate — return cols changed) so the matcher can build the rerank/lexical queries; `record_campaign_run` accepts optional `fitScore`/`confidence`/`guardrails`, falling back to the cosine-derived band. `repo.recordRun` payload widened. `VOYAGE_API_KEY` (+ optional `VOYAGE_RERANK_MODEL`/`_ENABLED`) added to `worker-configuration.d.ts` + `.dev.vars.example`.

**Verified:** `./init.sh` green — Worker `tsc --noEmit` clean, `db:generate` → "No schema changes, nothing to migrate", web `tsc --noEmit` clean.

**DEPLOYED TO PROD 2026-06-29.** (1) `fyj_scanner` f-148 applied to the index (Supabase `mwcpoaefmggapztkxakp`) — `search_jobs_hybrid` verified live (HTTP 200 via PostgREST, fused dense+lexical rows incl. a lexical-only hit). (2) Voyage `rerank-2.5` key validated. (3) `wrangler secret put VOYAGE_API_KEY` set. (4) `wrangler deploy` succeeded — version `cdca2802-…`, `https://fyj-ops-console.saikiran13055.workers.dev`, hourly cron + `fyj-match` queue, all bindings resolved; Worker boots.

**Neon functions applied + verified.** The two changed `db/policies.sql` functions were applied to Neon and confirmed live: `app.get_campaign_for_match` now RETURNS `(…, resume_text text, parsed_profile jsonb)` and `app.record_campaign_run` accepts the optional rerank fields; grants re-applied. Applied **surgically** (just these two functions, not a full `db:policies` re-run — raw `psql`/TCP is blocked by the sandbox, so used the `@neondatabase/serverless` HTTPS driver through the agent proxy; a full re-apply was avoided to not touch the `ops_app` role/password Hyperdrive depends on). The background cron/queue matcher now has the data it needs (rerank query + lexical query + seniority band) and no longer errors.

**Fully live now:** index `search_jobs_hybrid` (Supabase), Worker (Voyage secret + deployed code), and Neon functions are all in place and mutually consistent.

**What's next:** exercise résumé → reranked matches end-to-end via the UI (operator login) to confirm fit/guardrail chips populate; consider folding the soft seniority/comp signals into the f-136 LLM eval pass.

---

## 2026-06-26 — f-147 follow-up #3: don't regenerate a tailored résumé on re-approve

Tailored résumés are persisted in `reports.full_markdown` (Neon), keyed by `campaign_match_id`, and
the drawer shows the stored one via `GET /resume` (a reload never regenerates). But `approve`
*always* re-enqueued tailoring and `saveTailoredResume` upserts — so re-approving a match (they
reappear in the list after a reload, `action=shortlisted`) regenerated and **clobbered the stored
résumé, including operator edits**. Fix: the approve route now checks `getTailoredResume` first and
only enqueues tailoring when none exists yet; `POST /api/matches/:id/tailor` stays the explicit
"force regenerate" path. Worker `tsc` green; needs a `wrangler deploy`.

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
