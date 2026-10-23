-- ef-auto-deploy: functions-cope-without-this
-- ef-auto-deploy-applied-when: select to_regclass('public.thumbnail_title_runs') is not null and to_regprocedure('public.thumbnail_title_manual_apply(text,text,text,text,text,text,text)') is not null
-- Thumbnail title buttons in Production (session Titlecard, 2026-10-23, OPEN_REPAIRS 476). Plan and owner
-- decisions: docs/syncview-design/mockups/thumbnail-titles/PLAN.md.
--
-- A staff member (admin or SMM) presses "Thumbnail titles" on a post, or "Write title" on one thumbnail
-- sub-issue. The thumbnail-titles function then runs on the server, so closing the tab does not stop it.
-- This file adds what that run needs; it changes nothing that exists, and the background writer keeps
-- working exactly as before without it.
--
--   thumbnail_title_runs        one row per press. One ACTIVE run per post (run_key) at a time: a second
--                               press, from anyone, follows the run already going. Holds the plan tab used,
--                               the tabs offered, who pressed it, and the real AI token counts.
--   thumbnail_title_run_items   one row per thumbnail in a run: its state on screen (waiting, building,
--                               done, review, skipped, failed, kept), the title, and the description it
--                               replaced (for Undo).
--   thumbnail_title_manual_apply(...)  writes one description ONLY if it is still exactly the text the run
--                               saw (compare and set, under a row lock), and records it in the issue's
--                               history (deliverable_events) under the person who pressed.
--   thumbnail_titles_tick_needed()     also wakes the per-minute timer for a run whose worker died
--                               (lease expired), so a run always finishes.
--
-- Service role only, like the other thumbnail_titles_* objects. Supabase grants anon, authenticated and
-- service_role full rights on new objects by default, so every revoke below names all four.
begin;

create table if not exists public.thumbnail_title_runs (
  id text primary key default ('ttr_' || replace(gen_random_uuid()::text, '-', '')),
  run_key text not null,
  client_slug text not null,
  scope text not null default 'post' check (scope in ('post', 'item')),
  state text not null default 'queued' check (state in ('queued', 'running', 'ask', 'done', 'error', 'cancelled')),
  stage text not null default 'reading' check (stage in ('reading', 'finding', 'writing', 'finished')),
  requested_by text not null default '',
  requested_role text not null default '',
  tab_id text,
  tab_name text,
  tab_choices jsonb not null default '[]'::jsonb,
  error text,
  attempts integer not null default 0,
  lease_until timestamptz,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists thumbnail_title_runs_one_active
  on public.thumbnail_title_runs (run_key) where state in ('queued', 'running', 'ask');
create index if not exists thumbnail_title_runs_key_recent on public.thumbnail_title_runs (run_key, created_at desc);

create table if not exists public.thumbnail_title_run_items (
  run_id text not null references public.thumbnail_title_runs (id) on delete cascade,
  deliverable_id text not null,
  position integer not null default 0,
  state text not null default 'waiting'
    check (state in ('waiting', 'building', 'done', 'review', 'skipped', 'failed', 'kept')),
  outcome text,
  message text,
  video_number integer,
  title text,
  proposed_text text,
  previous_brief text,
  written_text text,
  last_error text,
  decided_by text,
  updated_at timestamptz not null default now(),
  primary key (run_id, deliverable_id)
);
create index if not exists thumbnail_title_run_items_deliverable on public.thumbnail_title_run_items (deliverable_id);

alter table public.thumbnail_title_runs enable row level security;
alter table public.thumbnail_title_run_items enable row level security;
revoke all on table public.thumbnail_title_runs from public, anon, authenticated, service_role;
revoke all on table public.thumbnail_title_run_items from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.thumbnail_title_runs to service_role;
grant select, insert, update, delete on table public.thumbnail_title_run_items to service_role;

-- Write one description, only when it is still exactly p_expected (empty and null are the same). Returns
-- 'written', 'changed' (someone edited it meanwhile: nothing written), 'gone' (not a live thumbnail),
-- 'authority' (the thumbnail's team is not SyncView-authoritative in prod_authority, or that flag is missing
-- or unreadable: the same fail-closed rule as production-write's authorityFor) or 'stopped' (an automatic
-- 'write' whose run is no longer running: a Cancel or "Use another tab" wins over a write already on its way).
-- p_action: write | replace | above | use_new | undo, recorded in the history row.
create or replace function public.thumbnail_title_manual_apply(
  p_deliverable_id text, p_expected text, p_text text, p_actor text, p_role text, p_run_id text, p_action text)
returns text language plpgsql set search_path = public, pg_catalog as $$
declare d public.deliverables%rowtype; v_team text; v_authority text; v_run_state text;
begin
  if p_action not in ('write', 'replace', 'above', 'use_new', 'undo') or length(coalesce(p_text, '')) > 100000 then
    raise exception 'thumbnail_title_manual_apply_invalid';
  end if;
  select * into d from public.deliverables where id = p_deliverable_id for update;
  if not found or d.kind <> 'thumbnail' or d.status in ('canceled', 'duplicate') then
    return 'gone';
  end if;
  v_team := case lower(coalesce(d.team, '')) when 'graphics' then 'graphics' when 'gra' then 'graphics' when 'thumbnail' then 'graphics'
                                               when 'video' then 'video' when 'vid' then 'video' else '' end;
  select lower(coalesce(f.value ->> v_team, '')) into v_authority
    from public.syncview_runtime_flags f where f.key = 'prod_authority' and jsonb_typeof(f.value) = 'object';
  if v_team = '' or coalesce(v_authority, '') <> 'syncview' then
    return 'authority';
  end if;
  if p_action = 'write' then
    -- Fence: the run row is locked, so a Cancel waits for this write or this write sees the Cancel.
    select r.state into v_run_state from public.thumbnail_title_runs r where r.id = p_run_id for update;
    if coalesce(v_run_state, '') <> 'running' then
      return 'stopped';
    end if;
  end if;
  if coalesce(d.brief, '') is distinct from coalesce(p_expected, '') then
    return 'changed';
  end if;
  perform set_config('app.event_written', '1', true);
  update public.deliverables set brief = coalesce(p_text, '') where id = d.id;
  insert into public.deliverable_events (deliverable_id, batch_id, client_slug, actor, role, action, from_status, to_status, source, payload)
  values (d.id, d.batch_id, d.client_slug, left(coalesce(nullif(btrim(p_actor), ''), 'SyncView thumbnail titles'), 120),
          left(coalesce(nullif(btrim(p_role), ''), 'staff'), 40), 'description_change', d.status, d.status, 'ui',
          jsonb_build_object('surface', 'thumbnail_titles_manual', 'action', p_action, 'run_id', p_run_id,
                             'description_length', length(coalesce(p_text, ''))));
  perform set_config('app.event_written', '', true);
  return 'written';
end $$;

-- The timer also wakes for a manual run whose worker stopped (its lease ran out), so every run finishes:
-- resumed while tries remain, ended as failed after the third.
create or replace function public.thumbnail_titles_tick_needed()
returns boolean language sql stable set search_path = public, pg_catalog as $$
  select exists (select 1 from public.thumbnail_title_runs r
                  where r.state in ('queued', 'running') and r.lease_until < now())
      or (exists (select 1 from public.syncview_runtime_flags f
                  where f.key = 'thumbnail_titles' and jsonb_array_length(coalesce(f.value -> 'clients', '[]'::jsonb)) > 0)
     and (exists (select 1 from public.thumbnail_title_queue q
                   where q.state = 'pending' or (q.state = 'running' and q.lease_until < now()))
          or exists (select 1 from public.deliverables d
                      where d.kind = 'thumbnail' and d.team = 'graphics' and d.origin = 'calendar' and d.card_id is not null
                        and d.created_at > now() - interval '2 days'
                        and d.created_at >= public.thumbnail_titles_since()
                        and coalesce(btrim(d.brief), '') = ''
                        and d.status not in ('canceled', 'duplicate')
                        and public.thumbnail_titles_client_on(d.client_slug)
                        and not exists (select 1 from public.thumbnail_title_queue q2 where q2.deliverable_id = d.id))))
$$;

revoke all on function public.thumbnail_title_manual_apply(text, text, text, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.thumbnail_title_manual_apply(text, text, text, text, text, text, text) to service_role;
revoke all on function public.thumbnail_titles_tick_needed() from public, anon, authenticated, service_role;
-- thumbnail_titles_tick_needed stays database owner only (pg_cron), as before.

commit;

-- VERIFY (read only):
--   select to_regclass('public.thumbnail_title_runs') is not null and to_regclass('public.thumbnail_title_run_items') is not null;   -- true
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name in ('thumbnail_title_runs', 'thumbnail_title_run_items') order by 1, 2;                                     -- service_role only
--   select public.thumbnail_titles_tick_needed();                                                                                  -- runs, no error
--
-- ROLLBACK (descriptions already written stay; the background writer is unaffected):
--   create or replace function public.thumbnail_titles_tick_needed() ... (the body in 2026-10-09-thumbnail-titles.sql)
--   drop function if exists public.thumbnail_title_manual_apply(text, text, text, text, text, text, text);
--   drop table if exists public.thumbnail_title_run_items, public.thumbnail_title_runs;
