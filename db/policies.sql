-- ============================================================================
-- Ops-console RLS — f-131 security core (Neon Postgres)
-- ============================================================================
-- Apply AFTER the Drizzle migration creates the tables (drizzle-kit migrate),
-- on every deploy. Idempotent.
--
-- Tenant isolation is enforced here, not in app code. The Cloudflare Worker
-- authenticates the request (Better Auth), resolves the principal, and stamps
-- the transaction with per-request GUCs:
--
--   set local app.user_id   = '<better-auth user id>';
--   set local app.principal = 'staff' | 'client';
--   set local app.org_id    = '<uuid>';
--   set local app.role      = 'admin' | 'operator' | 'viewer';   -- staff only
--   set local app.client_id = '<uuid>';                          -- client only
--
-- The Worker connects as `ops_app` (LOGIN, NOT superuser, NOT BYPASSRLS), so RLS
-- is actually enforced. Forgetting a SET LOCAL fails CLOSED (GUC null -> every
-- policy denies). Do NOT `force row level security` — the SECURITY DEFINER
-- helpers below must read `clients` as the table owner (RLS-exempt) to avoid
-- recursive policy evaluation.
-- ============================================================================

create schema if not exists app;

-- ── claim readers (per-request GUCs) ──────────────────────────────────
create or replace function app.current_user_id() returns text
  language sql stable as $$ select nullif(current_setting('app.user_id', true), '') $$;

create or replace function app.current_org_id() returns uuid
  language sql stable as $$ select nullif(current_setting('app.org_id', true), '')::uuid $$;

create or replace function app.current_principal() returns text
  language sql stable as $$ select nullif(current_setting('app.principal', true), '') $$;

create or replace function app.current_role() returns text
  language sql stable as $$ select nullif(current_setting('app.role', true), '') $$;

create or replace function app.current_client_id() returns uuid
  language sql stable as $$ select nullif(current_setting('app.client_id', true), '')::uuid $$;

-- ── access helpers (SECURITY DEFINER: read clients RLS-exempt as owner) ─
-- Staff path: admin/viewer see every client in their org; operators see only
-- clients assigned to them. Centralized so child-table policies stay one-liners,
-- and so reassigning a client (one column on `clients`) instantly re-gates all
-- of that client's profiles/campaigns/matches/placements/feedback.
create or replace function app.can_access_client(p_client_id uuid)
  returns boolean language plpgsql stable security definer
  set search_path = public, pg_temp as $$
declare r record;
begin
  if app.current_principal() is distinct from 'staff' then return false; end if;
  select org_id, assigned_operator_id into r from public.clients where id = p_client_id;
  if not found then return false; end if;
  if r.org_id is distinct from app.current_org_id() then return false; end if;
  if app.current_role() in ('admin', 'viewer') then return true; end if;
  if app.current_role() = 'operator' then
    return r.assigned_operator_id is not distinct from app.current_user_id();
  end if;
  return false;
end $$;

-- Client portal path: the client may view their OWN client row's data, and only
-- while the operator has portal access enabled.
create or replace function app.can_view_as_client(p_client_id uuid)
  returns boolean language plpgsql stable security definer
  set search_path = public, pg_temp as $$
declare r record;
begin
  if app.current_principal() is distinct from 'client' then return false; end if;
  if p_client_id is distinct from app.current_client_id() then return false; end if;
  select org_id, portal_enabled into r from public.clients where id = p_client_id;
  if not found then return false; end if;
  return coalesce(r.portal_enabled, false) and r.org_id is not distinct from app.current_org_id();
end $$;

-- ── enable RLS ────────────────────────────────────────────────────────
alter table public.organizations    enable row level security;
alter table public.memberships      enable row level security;
alter table public.clients          enable row level security;
alter table public.client_profiles  enable row level security;
alter table public.campaigns        enable row level security;
alter table public.campaign_matches enable row level security;
alter table public.reports          enable row level security;
alter table public.placements       enable row level security;
alter table public.feedback         enable row level security;
alter table public.resume_documents enable row level security;
alter table public.activity_state   enable row level security;
alter table public.audit_log        enable row level security;

-- ── Better Auth tables (user / session / account / verification) ──────────
-- These are touched ONLY by the Worker as `ops_app` via Better Auth — never by
-- end-users directly, and never by the Neon Data API. Neon's Data API enables
-- RLS across the entire public schema; with RLS ON and NO policy these tables
-- fail CLOSED, so `ops_app` (non-BYPASSRLS) sees ZERO rows. That silently breaks
-- auth: sign-in reads `account` → 0 rows → "Invalid email or password" even when
-- the password is correct, and sign-up's INSERT into `user` is denied →
-- FAILED_TO_CREATE_USER. Fix: keep RLS ENABLED (so the Data API roles anon/
-- authenticated stay denied — they get no policy here, so the password hashes in
-- `account` are never exposed over REST) and grant full row access to `ops_app`
-- only. `with check (true)` so Better Auth's inserts/updates pass too.
alter table public."user"        enable row level security;
alter table public.session       enable row level security;
alter table public.account       enable row level security;
alter table public.verification  enable row level security;

drop policy if exists auth_user_ops_app          on public."user";
drop policy if exists auth_session_ops_app        on public.session;
drop policy if exists auth_account_ops_app        on public.account;
drop policy if exists auth_verification_ops_app   on public.verification;

create policy auth_user_ops_app          on public."user"        for all to ops_app using (true) with check (true);
create policy auth_session_ops_app        on public.session       for all to ops_app using (true) with check (true);
create policy auth_account_ops_app        on public.account       for all to ops_app using (true) with check (true);
create policy auth_verification_ops_app   on public.verification  for all to ops_app using (true) with check (true);

-- ── organizations ─────────────────────────────────────────────────────
drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations for select
  using (id = app.current_org_id());

drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations for update
  using (id = app.current_org_id() and app.current_role() = 'admin')
  with check (id = app.current_org_id() and app.current_role() = 'admin');

-- ── memberships (staff read own org; admin writes) ────────────────────
drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships for select
  using (org_id = app.current_org_id() and app.current_principal() = 'staff');

drop policy if exists memberships_admin_write on public.memberships;
create policy memberships_admin_write on public.memberships for all
  using (org_id = app.current_org_id() and app.current_role() = 'admin')
  with check (org_id = app.current_org_id() and app.current_role() = 'admin');

-- ── clients ───────────────────────────────────────────────────────────
drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients for select
  using ((app.current_principal() = 'staff' and app.can_access_client(id))
         or app.can_view_as_client(id));

drop policy if exists clients_insert on public.clients;
create policy clients_insert on public.clients for insert
  with check (
    app.current_principal() = 'staff'
    and org_id = app.current_org_id()
    and app.current_role() in ('admin', 'operator')
    and (app.current_role() = 'admin' or assigned_operator_id = app.current_user_id())
  );

drop policy if exists clients_update on public.clients;
create policy clients_update on public.clients for update
  using (app.current_role() in ('admin', 'operator') and app.can_access_client(id))
  with check (org_id = app.current_org_id());

drop policy if exists clients_delete on public.clients;
create policy clients_delete on public.clients for delete
  using (org_id = app.current_org_id() and app.current_role() = 'admin');

-- ── child tables that BOTH staff and the client can read ──────────────
-- client_profiles, campaigns, campaign_matches, placements: visible to staff
-- (via can_access_client) and to the client portal (via can_view_as_client);
-- writable only by admin/operator staff for accessible clients.
do $$
declare tbl text;
begin
  foreach tbl in array array['client_profiles','campaigns','campaign_matches','placements']
  loop
    execute format('drop policy if exists %1$s_select on public.%1$s', tbl);
    execute format($f$
      create policy %1$s_select on public.%1$s for select
        using (org_id = app.current_org_id()
               and (app.can_access_client(client_id) or app.can_view_as_client(client_id)))
    $f$, tbl);

    execute format('drop policy if exists %1$s_staff_write on public.%1$s', tbl);
    execute format($f$
      create policy %1$s_staff_write on public.%1$s for all
        using (org_id = app.current_org_id()
               and app.current_principal() = 'staff'
               and app.current_role() in ('admin','operator')
               and app.can_access_client(client_id))
        with check (org_id = app.current_org_id()
               and app.current_principal() = 'staff'
               and app.current_role() in ('admin','operator')
               and app.can_access_client(client_id))
    $f$, tbl);
  end loop;
end $$;

-- ── reports (staff-only; not exposed to the client portal) ────────────
drop policy if exists reports_staff_select on public.reports;
create policy reports_staff_select on public.reports for select
  using (app.current_principal() = 'staff' and app.can_access_client(client_id));

drop policy if exists reports_staff_write on public.reports;
create policy reports_staff_write on public.reports for all
  using (app.current_principal() = 'staff'
         and app.current_role() in ('admin','operator')
         and app.can_access_client(client_id))
  with check (app.current_principal() = 'staff'
         and app.current_role() in ('admin','operator')
         and app.can_access_client(client_id));

-- ── resume_documents (Write library, f-156) — staff-only ──────────────
-- client_id is NULLABLE (an org-wide draft), so the usual can_access_client
-- one-liner gets an "or client_id is null" escape: any staff seat in the org
-- may read org-wide drafts; candidate-scoped docs follow the same
-- operator-book gating as every other client child table. Never exposed to
-- the client portal (like reports — these are working documents).
drop policy if exists resume_documents_select on public.resume_documents;
create policy resume_documents_select on public.resume_documents for select
  using (org_id = app.current_org_id()
         and app.current_principal() = 'staff'
         and (client_id is null or app.can_access_client(client_id)));

drop policy if exists resume_documents_staff_write on public.resume_documents;
create policy resume_documents_staff_write on public.resume_documents for all
  using (org_id = app.current_org_id()
         and app.current_principal() = 'staff'
         and app.current_role() in ('admin','operator')
         and (client_id is null or app.can_access_client(client_id)))
  with check (org_id = app.current_org_id()
         and app.current_principal() = 'staff'
         and app.current_role() in ('admin','operator')
         and (client_id is null or app.can_access_client(client_id)));

-- ── feedback (staff + client read; client OR staff insert, immutable) ─
drop policy if exists feedback_select on public.feedback;
create policy feedback_select on public.feedback for select
  using (org_id = app.current_org_id()
         and (app.can_access_client(client_id) or app.can_view_as_client(client_id)));

drop policy if exists feedback_client_insert on public.feedback;
create policy feedback_client_insert on public.feedback for insert
  with check (
    app.current_principal() = 'client'
    and client_id = app.current_client_id()
    and org_id = app.current_org_id()
    and app.can_view_as_client(client_id)
  );

-- Operators/admins may also log feedback on a candidate they can access (f-146
-- activity feedback panel). Additive to the client-insert path; still no update/
-- delete policy, so feedback stays insert-only/immutable for everyone.
drop policy if exists feedback_staff_insert on public.feedback;
create policy feedback_staff_insert on public.feedback for insert
  with check (
    app.current_principal() = 'staff'
    and app.current_role() in ('admin', 'operator')
    and org_id = app.current_org_id()
    and app.can_access_client(client_id)
  );

-- ── activity_state (worklist done-state, f-157) — staff-only ──────────
-- Org-scoped operator to-do bookkeeping. The task_key values reference
-- matches/placements whose own RLS gates the underlying data; the keys
-- themselves are opaque, so a plain org+staff policy suffices. Viewers can
-- read (the worklist renders for them) but not write.
drop policy if exists activity_state_select on public.activity_state;
create policy activity_state_select on public.activity_state for select
  using (org_id = app.current_org_id() and app.current_principal() = 'staff');

drop policy if exists activity_state_staff_write on public.activity_state;
create policy activity_state_staff_write on public.activity_state for all
  using (org_id = app.current_org_id()
         and app.current_principal() = 'staff'
         and app.current_role() in ('admin','operator'))
  with check (org_id = app.current_org_id()
         and app.current_principal() = 'staff'
         and app.current_role() in ('admin','operator'));

-- ── audit_log (admin read; staff insert) ──────────────────────────────
drop policy if exists audit_log_admin_select on public.audit_log;
create policy audit_log_admin_select on public.audit_log for select
  using (org_id = app.current_org_id() and app.current_role() = 'admin');

drop policy if exists audit_log_staff_insert on public.audit_log;
create policy audit_log_staff_insert on public.audit_log for insert
  with check (org_id = app.current_org_id() and app.current_principal() = 'staff');

-- ============================================================================
-- App role — the Worker connects as this (NOT owner, NOT superuser, NO BYPASSRLS)
-- ============================================================================
-- Set the password out of band (Neon role page) or:  alter role ops_app with password '...';
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ops_app') then
    create role ops_app login;
  end if;
end $$;

grant usage on schema public, app to ops_app;
grant select, insert, update, delete on all tables in schema public to ops_app;
grant execute on all functions in schema app to ops_app;
alter default privileges in schema public
  grant select, insert, update, delete on tables to ops_app;

-- Sanity: ops_app must NOT bypass RLS.
do $$
begin
  if (select rolbypassrls from pg_roles where rolname = 'ops_app') then
    raise exception 'ops_app must not have BYPASSRLS';
  end if;
end $$;

-- ============================================================================
-- No separate matcher role (ops_system is retired).
-- ============================================================================
-- The background matcher (cron/queue) connects as the same non-BYPASSRLS
-- ops_app role; its cross-tenant steps go through the SECURITY DEFINER
-- functions in this file (app.list_active_campaigns / app.get_campaign_for_match
-- / app.record_campaign_run), each scoped to a single campaign's data. An
-- earlier design used a BYPASSRLS `ops_system` role, but Neon's owner role
-- cannot grant BYPASSRLS via SQL, so it never actually worked and is no longer
-- created here. If a vestigial `ops_system` role exists in your Neon project,
-- remove it manually:  drop owned by ops_system; drop role if exists ops_system;


-- ============================================================================
-- Principal resolution + signup bootstrap (f-133)
-- ============================================================================
-- The Worker authenticates a request with Better Auth (which yields only a
-- user id), then must resolve WHICH org/role/client that user is — a read of
-- memberships/clients that RLS itself gates on a principal already being set
-- (chicken-and-egg). These SECURITY DEFINER helpers run as the table owner
-- (RLS-exempt) but only ever return rows for the *passed* user id, which the
-- Worker has cryptographically verified — so a caller cannot resolve another
-- user's principal. ops_app may execute them but still cannot read the tables
-- directly. Keep these the ONLY privileged read path off the request thread.

create or replace function app.resolve_staff_memberships(p_user_id text)
  returns table (org_id uuid, role text, org_name text)
  language sql stable security definer set search_path = public, pg_temp as $$
  select m.org_id, m.role::text, o.name
  from public.memberships m
  join public.organizations o on o.id = m.org_id
  where m.user_id = p_user_id and m.status = 'active'
  order by o.created_at
$$;

create or replace function app.resolve_client_principal(p_user_id text)
  returns table (client_id uuid, org_id uuid)
  language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, c.org_id
  from public.clients c
  where c.auth_user_id = p_user_id and c.portal_enabled = true
$$;

-- Signup bootstrap: a brand-new staff user gets their own org + admin membership
-- atomically. Idempotent — returns the user's existing org if they already have
-- an active membership (so a retried signup hook can't double-create). Called
-- from Better Auth's user.create.after databaseHook (see src/auth.ts).
create or replace function app.bootstrap_org_for_user(p_user_id text, p_org_name text)
  returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  select org_id into v_org from public.memberships
   where user_id = p_user_id and status = 'active'
   order by created_at limit 1;
  if v_org is not null then return v_org; end if;

  insert into public.organizations (name)
       values (coalesce(nullif(p_org_name, ''), 'My workspace'))
    returning id into v_org;
  insert into public.memberships (org_id, user_id, role, status)
       values (v_org, p_user_id, 'admin', 'active');
  return v_org;
end $$;

-- These are defined AFTER the blanket grant above, so grant them explicitly.
grant execute on function app.resolve_staff_memberships(text) to ops_app;
grant execute on function app.resolve_client_principal(text)  to ops_app;
grant execute on function app.bootstrap_org_for_user(text, text) to ops_app;


-- ============================================================================
-- Continuous matcher (f-135)
-- ============================================================================
-- The background matcher (cron + queue Worker) legitimately spans all orgs and
-- writes campaign_matches WITHOUT a request principal — work RLS denies for
-- ops_app, and which a synthetic principal can't satisfy (no real membership /
-- can_access_client). Rather than a BYPASSRLS role (Neon's owner role can't
-- grant BYPASSRLS via SQL), the matcher runs on the SAME ops_app connection and
-- goes through these SECURITY DEFINER functions (owner = table owner, RLS-exempt,
-- same trick as the resolvers above). They are the matcher's ONLY privileged
-- path; ops_app still cannot touch the tables directly. Every write is scoped to
-- one campaign — org_id/client_id are derived from the (verified) campaign id
-- inside the function, never trusted from the caller — so a caller cannot write
-- into another tenant. Only the id-listing spans orgs.

create or replace function app.list_active_campaigns()
  returns table (id uuid, org_id uuid)
  language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, c.org_id from public.campaigns c where c.status = 'active'
$$;

-- One campaign's matching inputs: its 1:1 profile's embedding (as text — pgvector
-- has no driver mapping over a raw RPC; the Worker JSON.parses it) + filters +
-- the incremental watermark. f-149 added resume_text + parsed_profile so the
-- background matcher can build the rerank query (parsed_profile.summary), the
-- lexical-arm query (parsed_profile.candidate.skills) and the seniority band —
-- inputs the request-path callers already have in hand but the matcher didn't.
-- Adding OUT columns changes the return type, which create-or-replace can't do,
-- hence drop-then-create (idempotent; re-applied every deploy).
drop function if exists app.get_campaign_for_match(uuid);
create or replace function app.get_campaign_for_match(p_campaign_id uuid)
  returns table (
    campaign_id uuid, org_id uuid, client_id uuid,
    last_run_at timestamptz, embedding text, target_filters jsonb,
    resume_text text, parsed_profile jsonb
  )
  language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, c.org_id, c.client_id, c.last_run_at,
         p.embedding::text, p.target_filters,
         p.resume_text, p.parsed_profile
  from public.campaigns c
  join public.client_profiles p on p.id = c.profile_id
  where c.id = p_campaign_id
$$;

-- Surface a run's matches and advance the watermark atomically. p_matches is a
-- jsonb array of {jobId, companyId, score, rank} and OPTIONALLY {fitScore,
-- confidence, guardrails} (f-149 Voyage rerank + soft signals); org_id/client_id
-- come from the campaign, not the payload. Dedup on (campaign_id, job_id). Always
-- bumps last_run_at, so an empty run still advances the incremental window.
create or replace function app.record_campaign_run(p_campaign_id uuid, p_matches jsonb)
  returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_client uuid;
begin
  select org_id, client_id into v_org, v_client
    from public.campaigns where id = p_campaign_id;
  if not found then return; end if;

  if jsonb_array_length(coalesce(p_matches, '[]'::jsonb)) > 0 then
    -- fit_score + confidence: use the reranker's values when the caller supplies
    -- them (f-149), else fall back to the cosine-derived band (0..1 → 0..100;
    -- 0.82/0.64 thresholds) — so older/dense-only callers behave exactly as
    -- before. guardrails (soft seniority/comp notes) land in the guardrails
    -- text[]; rationale + skill breakdown stay null until the f-136 LLM pass.
    insert into public.campaign_matches
      (org_id, client_id, campaign_id, job_id, company_id, score, rank, fit_score, confidence, guardrails)
    select v_org, v_client, p_campaign_id,
           (m->>'jobId')::uuid, (m->>'companyId')::uuid,
           (m->>'score')::double precision, (m->>'rank')::int,
           coalesce(
             (m->>'fitScore')::int,
             greatest(0, least(100, round(coalesce((m->>'score')::double precision, 0) * 100)))::int
           )::smallint,
           coalesce(
             nullif(m->>'confidence', '')::public.match_confidence,
             (case
                when coalesce((m->>'score')::double precision, 0) >= 0.82 then 'high'
                when coalesce((m->>'score')::double precision, 0) >= 0.64 then 'medium'
                else 'low'
              end)::public.match_confidence
           ),
           case when jsonb_typeof(m->'guardrails') = 'array'
                then array(select jsonb_array_elements_text(m->'guardrails'))
                else null end
    from jsonb_array_elements(p_matches) as m
    on conflict (campaign_id, job_id) do nothing;
  end if;

  update public.campaigns set last_run_at = now() where id = p_campaign_id;
end $$;

grant execute on function app.list_active_campaigns()           to ops_app;
grant execute on function app.get_campaign_for_match(uuid)      to ops_app;
grant execute on function app.record_campaign_run(uuid, jsonb)  to ops_app;

-- f-141: a UI "campaign" = a client_profiles row + its 1:1 campaigns row. The
-- request role can't INSERT/UPDATE campaigns directly (no write policy on the
-- table), so creating/activating one goes through this SECURITY DEFINER helper,
-- which derives org_id/client_id from the profile inside the DB (never trusted
-- from the caller) — same trust model as record_campaign_run. Idempotent:
-- ensures the row exists, and only flips status to 'active' when asked.
create or replace function app.upsert_campaign_for_profile(
  p_profile_id uuid, p_activate boolean, p_created_by text)
  returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_client uuid; v_campaign uuid;
begin
  select org_id, client_id into v_org, v_client
    from public.client_profiles where id = p_profile_id;
  if not found then return null; end if;

  select id into v_campaign from public.campaigns where profile_id = p_profile_id;
  if v_campaign is null then
    insert into public.campaigns (org_id, client_id, profile_id, name, status, created_by)
    values (v_org, v_client, p_profile_id, 'Campaign',
            case when p_activate then 'active'::public.campaign_status else 'draft'::public.campaign_status end,
            p_created_by)
    returning id into v_campaign;
  elsif p_activate then
    update public.campaigns set status = 'active', updated_at = now()
      where id = v_campaign and status <> 'active';
  end if;
  return v_campaign;
end $$;

grant execute on function app.upsert_campaign_for_profile(uuid, boolean, text) to ops_app;


-- ============================================================================
-- Operator dashboard analytics (f-139 dashboard)
-- ============================================================================
-- The dashboard shows ORG-WIDE rollups (KPIs, funnel, a per-operator
-- leaderboard, 30-day trends, an activity feed). These legitimately span every
-- client/operator in the org — which the request-path role (operator) cannot
-- read directly, because `can_access_client` limits an operator to their own
-- book, and `audit_log` is admin-select-only. So, exactly like the resolvers /
-- matcher above, these run as SECURITY DEFINER (owner, RLS-exempt) but are
-- pinned to the CALLER'S org via the `app.org_id` GUC and gated to staff via
-- `app.current_principal()`. A non-staff caller (or a missing GUC) yields zero
-- rows. They never read another tenant's data: org_id comes from the verified
-- principal's GUC, never from a parameter.

-- Headline KPIs (single row). placements_mtd = placements that reached 'placed'
-- this month; response_rate = % of applied placements that advanced to an
-- interview-or-better stage; live_applications = in-flight placements;
-- awaiting_review = new (unactioned) campaign matches.
create or replace function app.org_kpis()
  returns table (placements_mtd int, response_rate int, live_applications int, awaiting_review int)
  language sql stable security definer set search_path = public, pg_temp as $$
  select
    (select count(*) from public.placements p
       where p.org_id = app.current_org_id()
         and p.status = 'placed'
         and p.updated_at >= date_trunc('month', now()))::int,
    (select coalesce(round(100.0
        * count(*) filter (where status in ('interview','offer','placed'))
        / nullif(count(*) filter (where status in ('applied','screening','interview','offer','placed')), 0)), 0)
       from public.placements where org_id = app.current_org_id())::int,
    (select count(*) from public.placements
       where org_id = app.current_org_id() and status in ('applied','screening','interview','offer'))::int,
    (select count(*) from public.campaign_matches
       where org_id = app.current_org_id() and action = 'new')::int
  where app.current_principal() = 'staff'
$$;

-- Conversion funnel (ordered). Counts flow from surfaced matches → reviewed →
-- applied → responded → interview → placed.
create or replace function app.org_funnel()
  returns table (label text, value int, ord int)
  language sql stable security definer set search_path = public, pg_temp as $$
  select * from (values
    ('Matches surfaced', (select count(*) from public.campaign_matches where org_id = app.current_org_id())::int, 1),
    ('Reviewed',         (select count(*) from public.campaign_matches where org_id = app.current_org_id() and action <> 'new')::int, 2),
    ('Applied',          (select count(*) from public.placements where org_id = app.current_org_id() and applied_at is not null)::int, 3),
    ('Responded',        (select count(*) from public.placements where org_id = app.current_org_id() and status in ('screening','interview','offer','placed'))::int, 4),
    ('Interview',        (select count(*) from public.placements where org_id = app.current_org_id() and status in ('interview','offer','placed'))::int, 5),
    ('Placed',           (select count(*) from public.placements where org_id = app.current_org_id() and status = 'placed')::int, 6)
  ) as f(label, value, ord)
  where app.current_principal() = 'staff'
$$;

-- Per-operator leaderboard for the org (admin + operator seats). All counts are
-- scoped to clients assigned to that operator.
create or replace function app.operator_stats()
  returns table (
    user_id text, name text, email text,
    candidate_count int, matches_awaiting int, applications_week int,
    response_rate int, placements_mtd int
  )
  language sql stable security definer set search_path = public, pg_temp as $$
  select
    m.user_id, u.name, u.email,
    (select count(*) from public.clients c
       where c.org_id = m.org_id and c.assigned_operator_id = m.user_id)::int,
    (select count(*) from public.campaign_matches cm
       join public.clients c on c.id = cm.client_id
       where cm.org_id = m.org_id and c.assigned_operator_id = m.user_id and cm.action = 'new')::int,
    (select count(*) from public.placements p
       join public.clients c on c.id = p.client_id
       where p.org_id = m.org_id and c.assigned_operator_id = m.user_id
         and p.applied_at >= now() - interval '7 days')::int,
    (select coalesce(round(100.0
        * count(*) filter (where p.status in ('interview','offer','placed'))
        / nullif(count(*) filter (where p.status in ('applied','screening','interview','offer','placed')), 0)), 0)
       from public.placements p join public.clients c on c.id = p.client_id
       where p.org_id = m.org_id and c.assigned_operator_id = m.user_id)::int,
    (select count(*) from public.placements p
       join public.clients c on c.id = p.client_id
       where p.org_id = m.org_id and c.assigned_operator_id = m.user_id
         and p.status = 'placed' and p.updated_at >= date_trunc('month', now()))::int
  from public.memberships m
  left join public."user" u on u.id = m.user_id
  where m.org_id = app.current_org_id()
    and m.status = 'active'
    and m.role in ('admin','operator')
    and app.current_principal() = 'staff'
  order by 8 desc, 4 desc
$$;

-- 30-day daily series for applications / responses / placements, computed from
-- live placement timestamps (no rollup table needed). Zero-filled per day.
create or replace function app.org_trends()
  returns table (day date, applications int, responses int, placements int)
  language sql stable security definer set search_path = public, pg_temp as $$
  with days as (
    select generate_series(
      date_trunc('day', now()) - interval '29 days',
      date_trunc('day', now()), interval '1 day')::date as d
  )
  select d.d,
    (select count(*) from public.placements p
       where p.org_id = app.current_org_id() and p.applied_at::date = d.d)::int,
    (select count(*) from public.placements p
       where p.org_id = app.current_org_id()
         and p.status in ('screening','interview','offer','placed') and p.updated_at::date = d.d)::int,
    (select count(*) from public.placements p
       where p.org_id = app.current_org_id() and p.status = 'placed' and p.updated_at::date = d.d)::int
  from days d
  where app.current_principal() = 'staff'
  order by d.d
$$;

-- Recent activity feed from the audit log (admin-select-only via RLS, so read it
-- here for any staff seat, org-scoped).
create or replace function app.org_activity(p_limit int default 12)
  returns table (
    id uuid, action text, entity_type text,
    actor_user_id text, actor_name text, metadata jsonb, created_at timestamptz
  )
  language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, a.action, a.entity_type, a.actor_user_id, u.name, a.metadata, a.created_at
  from public.audit_log a
  left join public."user" u on u.id = a.actor_user_id
  where a.org_id = app.current_org_id()
    and app.current_principal() = 'staff'
  order by a.created_at desc
  limit greatest(1, least(coalesce(p_limit, 12), 50))
$$;

-- Defined after the blanket grant above — grant explicitly. Request-path only.
grant execute on function app.org_kpis()        to ops_app;
grant execute on function app.org_funnel()      to ops_app;
grant execute on function app.operator_stats()  to ops_app;
grant execute on function app.org_trends()      to ops_app;
grant execute on function app.org_activity(int) to ops_app;
