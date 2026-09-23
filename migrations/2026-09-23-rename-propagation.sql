-- ============================================================
-- Card <-> sub-issue rename propagation (docs/ops/RENAME_PLAN.md).
--
-- NOT APPLIED. Lighthouse reviews and applies. Idempotent (create or replace /
-- if not exists), so re-running it is safe.
--
-- Owner rules (2026-09-23):
--   1. Renaming a card renames its linked sub-issues, and the reverse, always.
--   2. No backfill: old mismatches stay until one side is renamed; that rename
--      then overwrites the other side.
--   3. Nothing may break: a rename never blocks, delays or rolls back any other
--      save -- approving and requesting changes above all.
--   4. Titles without our number just take the new name; never invent a number.
--   5. Samples are included (release 2).
--   6. Renames made inside Linear do not spread.
--   7. Release 1 = card -> sub-issue (this migration, no Edge deploy).
--      Release 2 = sub-issue -> card (needs the production-write `title` op).
--
-- HOW RULE 3 IS KEPT.
--   * A save only RECORDS that a name changed: an AFTER trigger inserts one
--     row into rename_propagation_outbox inside BEGIN/EXCEPTION, so a failure
--     to record is a WARNING, never an error, and never rolls the save back. It
--     takes no lock on the other side.
--   * A separate drain applies the name to the other side, in its own
--     transaction, one subtransaction per row, with retries and backoff.
--   * The drain's title write does NOT move deliverables.updated_at. SyncLinear
--     status writes (approve / request changes) are compare-and-swap on that
--     column (production-write assertCas, surface=production), so a propagated
--     rename landing between a page load and an Approve click would otherwise
--     fail the approval with write_conflict. The cost: an open SyncLinear tab
--     shows the old title until it reloads (its watermark refresh reads
--     updated_at); Workload's realtime subscription still sees the row change.
--   * No approval column is ever written (owner decision 2).
--
-- NO LOOPS. The drain sets `syncview.rename_origin = 'propagation'` for its
-- transaction and the record trigger ignores writes made under it; and a
-- rename whose result equals the current title is a no-op.
--
-- IN-FLIGHT APPENDS. production_intake_append, component fill and the f203
-- create replay compare the FULL title of rows they created. A sub-issue
-- created less than DEFER_WINDOW ago is deferred, never renamed under a
-- possible retry.
--
-- LINEAR (rule 6). linear-inbound rewrites `linear_raw` in the same update as
-- a Linear title, so a title change that arrives with a linear_raw change is
-- recorded as origin 'linear' and never propagated. Propagated titles are not
-- mirrored to Linear.
--
-- The name rule below is a copy of supabase/functions/_shared/title-name-rule.mjs;
-- test/title-name-rule-drift.js fails if the two drift.
-- ============================================================

begin;

-- ── The name rule (SQL copy) ────────────────────────────────────────────────
-- SYNC_TITLE_RULE_SQL BEGIN
create or replace function public.syncview_title_trim(p text)
returns text language sql immutable parallel safe
set search_path = pg_catalog
as $fn$
  select regexp_replace(coalesce(p, ''),
    '^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
    '', 'g')
$fn$;

create or replace function public.syncview_title_clean_name(p text)
returns text language sql immutable parallel safe
set search_path = pg_catalog
as $fn$
  select public.syncview_title_trim(regexp_replace(coalesce(p, ''),
    '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'))
$fn$;

create or replace function public.syncview_title_parts(p text)
returns jsonb language plpgsql immutable parallel safe
set search_path = pg_catalog
as $fn$
declare
  m text[];
begin
  m := regexp_match(public.syncview_title_trim(p),
    '^(Sample )?(Video|Thumbnail) ([1-9][0-9]*)(?: — ([^\n\r\u2028\u2029]+))?$');
  if m is null then return null; end if;
  return jsonb_build_object(
    'sample', m[1] is not null,
    'kind', m[2],
    'ordinal', m[3]::numeric,
    'digits', m[3],
    'name', public.syncview_title_trim(coalesce(m[4], '')));
end
$fn$;

create or replace function public.syncview_title_name_of(p text)
returns text language sql immutable parallel safe
set search_path = pg_catalog
as $fn$
  select coalesce(public.syncview_title_parts(p)->>'name', public.syncview_title_trim(p))
$fn$;

create or replace function public.syncview_rename_title(p_old text, p_name text)
returns jsonb language plpgsql immutable parallel safe
set search_path = pg_catalog
as $fn$
declare
  v_name text := public.syncview_title_clean_name(p_name);
  v_before text := public.syncview_title_trim(p_old);
  v_parts jsonb := public.syncview_title_parts(v_before);
  v_title text;
begin
  if char_length(v_name) > 160 then
    return jsonb_build_object('ok', false, 'reason', 'name_too_long');
  end if;
  if v_parts is not null then
    v_title := case when (v_parts->>'sample')::boolean then 'Sample ' else '' end
      || (v_parts->>'kind') || ' ' || (v_parts->>'digits')
      || case when v_name <> '' then ' — ' || v_name else '' end;
  else
    if v_name = '' then
      return jsonb_build_object('ok', false, 'reason', 'empty_name_not_propagated');
    end if;
    if public.syncview_title_parts(v_name) is not null then
      return jsonb_build_object('ok', false, 'reason', 'name_would_look_numbered');
    end if;
    v_title := v_name;
  end if;
  return jsonb_build_object('ok', true, 'title', v_title, 'changed', v_title <> v_before);
end
$fn$;
-- SYNC_TITLE_RULE_SQL END

-- ── Outbox ──────────────────────────────────────────────────────────────────
create table if not exists public.rename_propagation_outbox (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  source_kind text not null check (source_kind in ('card', 'sample_card', 'deliverable')),
  source_id text not null,
  client text not null,
  new_value text not null,
  origin text not null check (origin in ('user', 'linear')),
  state text not null default 'pending' check (state in (
    'pending', 'deferred', 'done', 'noop', 'skipped', 'superseded',
    'dormant', 'ignored_linear', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default clock_timestamp(),
  detail jsonb not null default '{}'::jsonb
);

create index if not exists rename_propagation_outbox_due
  on public.rename_propagation_outbox (next_attempt_at, id)
  where state in ('pending', 'deferred');
create index if not exists rename_propagation_outbox_source
  on public.rename_propagation_outbox (source_kind, source_id, id);

alter table public.rename_propagation_outbox enable row level security;
revoke all on public.rename_propagation_outbox from public, anon, authenticated, service_role;
grant select on public.rename_propagation_outbox to service_role;

-- ── Flags (all dormant until Lighthouse turns a direction on) ──────────────
insert into public.syncview_runtime_flags (key, value, updated_by)
values ('rename_propagation',
        '{"card_to_subissue": false, "subissue_to_card": false, "samples": false}'::jsonb,
        'migration:2026-09-23-rename-propagation')
on conflict (key) do nothing;

-- ── Record: a save only writes a row here, and can never fail because of it ─
create or replace function public.rename_propagation_record()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_origin text := 'user';
begin
  if coalesce(current_setting('syncview.rename_origin', true), '') = 'propagation' then
    return null;
  end if;
  begin
    if tg_table_name = 'deliverables' then
      if new.linear_raw is distinct from old.linear_raw then v_origin := 'linear'; end if;
      insert into public.rename_propagation_outbox (source_kind, source_id, client, new_value, origin, state)
      values ('deliverable', new.id, new.client_slug, new.title, v_origin,
              case when v_origin = 'linear' then 'ignored_linear' else 'pending' end);
    elsif tg_table_name = 'calendar_posts' then
      insert into public.rename_propagation_outbox (source_kind, source_id, client, new_value, origin)
      values ('card', new.id, new.client, coalesce(new.name, ''), 'user');
    elsif tg_table_name = 'sample_reviews' then
      insert into public.rename_propagation_outbox (source_kind, source_id, client, new_value, origin)
      values ('sample_card', new.id, new.client, coalesce(new.name, ''), 'user');
    end if;
  exception when others then
    raise warning 'rename_propagation_record_failed: % %', sqlstate, sqlerrm;
  end;
  return null;
end
$fn$;
revoke all on function public.rename_propagation_record() from public, anon, authenticated, service_role;

drop trigger if exists zzz_rename_propagation_record on public.calendar_posts;
create trigger zzz_rename_propagation_record
  after update of name on public.calendar_posts
  for each row
  when (old.name is distinct from new.name
        and (new.video_deliverable_id is not null or new.graphic_deliverable_id is not null))
  execute function public.rename_propagation_record();

drop trigger if exists zzz_rename_propagation_record on public.sample_reviews;
create trigger zzz_rename_propagation_record
  after update of name on public.sample_reviews
  for each row
  when (old.name is distinct from new.name
        and (new.video_deliverable_id is not null or new.graphic_deliverable_id is not null))
  execute function public.rename_propagation_record();

drop trigger if exists zzz_rename_propagation_record on public.deliverables;
create trigger zzz_rename_propagation_record
  after update of title on public.deliverables
  for each row
  when (old.title is distinct from new.title and new.card_id is not null)
  execute function public.rename_propagation_record();

-- ── The propagated title write leaves updated_at alone (see header) ─────────
-- Live definition as of 2026-09-23 plus the one propagation branch.
create or replace function public.track_b_deliverable_touch_timestamps()
returns trigger language plpgsql
as $function$
begin
  if tg_op = 'UPDATE'
     and coalesce(current_setting('syncview.rename_origin', true), '') = 'propagation' then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  if tg_op = 'INSERT' and new.status_at is null then
    new.status_at := now();
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.status_at := now();
  end if;
  return new;
end;
$function$;

-- ── Logbook (WR-101): never silent, and never able to break the drain ──────
create or replace function public.rename_propagation_logbook(
  p_surface text, p_code_status integer, p_id text, p_card text, p_client text)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_ids jsonb := '{}'::jsonb;
begin
  if coalesce(p_id, '') <> '' then
    v_ids := v_ids || jsonb_build_object('id', encode(sha256(convert_to(p_id, 'UTF8')), 'hex'));
  end if;
  if coalesce(p_card, '') <> '' then
    v_ids := v_ids || jsonb_build_object('card', encode(sha256(convert_to(p_card, 'UTF8')), 'hex'));
  end if;
  if coalesce(p_client, '') <> '' then
    v_ids := v_ids || jsonb_build_object('client_slug', encode(sha256(convert_to(p_client, 'UTF8')), 'hex'));
  end if;
  perform public.production_write_refusal_record_v1(jsonb_build_object(
    'attempt_id', gen_random_uuid(),
    'origin', 'gateway',
    'surface', p_surface,
    'operation', 'update',
    'code', 'write_refused',
    'status', p_code_status,
    'principal_kind', 'unverified',
    'member_id', null,
    'identifiers', v_ids));
exception when others then
  raise warning 'rename_propagation_logbook_failed: % %', sqlstate, sqlerrm;
end
$fn$;
revoke all on function public.rename_propagation_logbook(text, integer, text, text, text)
  from public, anon, authenticated, service_role;

-- ── Apply one name to one sub-issue ─────────────────────────────────────────
-- Returns one of: done, noop, deferred, superseded, ambiguous_link,
-- name_too_long, empty_name_not_propagated, name_would_look_numbered.
-- Raises (so the caller retries) only when the write itself fails.
create or replace function public.rename_propagation_apply_deliverable(
  p_outbox_id bigint, p_created_at timestamptz, p_card_table text, p_card_id text,
  p_deliverable_id text, p_name text)
returns text language plpgsql security definer
set search_path = pg_catalog, public
as $fn$
declare
  d public.deliverables%rowtype;
  v_claims integer;
  v_result jsonb;
  v_defer interval := interval '15 minutes';
begin
  select * into d from public.deliverables where id = p_deliverable_id for update;
  if not found or d.card_id is distinct from p_card_id then return 'ambiguous_link'; end if;
  -- Two cards naming the same sub-issue in a slot (8 live rows on 2026-09-23):
  -- refuse to guess.
  select count(*) into v_claims from (
    select id from public.calendar_posts
     where video_deliverable_id = p_deliverable_id or graphic_deliverable_id = p_deliverable_id
    union all
    select id from public.sample_reviews
     where video_deliverable_id = p_deliverable_id or graphic_deliverable_id = p_deliverable_id
  ) c;
  if v_claims <> 1 then return 'ambiguous_link'; end if;
  -- The sub-issue's own rename is newer: it wins, on both sides.
  if exists (select 1 from public.rename_propagation_outbox o
              where o.source_kind = 'deliverable' and o.source_id = p_deliverable_id
                and o.origin = 'user' and o.created_at > p_created_at) then
    return 'superseded';
  end if;
  if d.created_at > clock_timestamp() - v_defer then return 'deferred'; end if;
  v_result := public.syncview_rename_title(d.title, p_name);
  if not (v_result->>'ok')::boolean then return v_result->>'reason'; end if;
  if not (v_result->>'changed')::boolean or d.title = v_result->>'title' then return 'noop'; end if;
  perform set_config('app.event_written', '1', true);
  update public.deliverables set title = v_result->>'title'
   where id = p_deliverable_id and title = d.title;
  if not found then raise exception 'rename_target_changed'; end if;
  insert into public.deliverable_events (
    deliverable_id, batch_id, client_slug, actor, role, action, from_status, to_status,
    source, payload, event_assignee_attribution)
  values (
    d.id, d.batch_id, d.client_slug, null, null, 'update', null, null, 'system',
    jsonb_build_object('reason', 'rename_propagation', 'outbox_id', p_outbox_id,
                       'card_table', p_card_table, 'card_id', p_card_id,
                       'from_title', d.title, 'to_title', v_result->>'title'),
    'unknown');
  perform set_config('app.event_written', '', true);
  return 'done';
end
$fn$;
revoke all on function public.rename_propagation_apply_deliverable(bigint, timestamptz, text, text, text, text)
  from public, anon, authenticated, service_role;

-- ── Process one outbox row; returns {state, detail} ─────────────────────────
create or replace function public.rename_propagation_process(r public.rename_propagation_outbox)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_flags jsonb;
  v_card_table text;
  v_card_id text;
  v_name text;
  v_video text;
  v_graphic text;
  v_exclude text;
  v_target text;
  v_outcome text;
  v_outcomes jsonb := '{}'::jsonb;
  v_d public.deliverables%rowtype;
  v_row_found boolean;
begin
  select value into v_flags from public.syncview_runtime_flags where key = 'rename_propagation';
  v_flags := coalesce(v_flags, '{}'::jsonb);

  -- A newer rename of the same source carries the latest name.
  if exists (select 1 from public.rename_propagation_outbox o
              where o.source_kind = r.source_kind and o.source_id = r.source_id
                and o.id > r.id and o.state in ('pending', 'deferred')) then
    return jsonb_build_object('state', 'superseded');
  end if;

  if r.source_kind = 'card' or r.source_kind = 'sample_card' then
    if r.source_kind = 'card' and coalesce((v_flags->>'card_to_subissue')::boolean, false) is not true then
      return jsonb_build_object('state', 'dormant');
    end if;
    if r.source_kind = 'sample_card' and not (coalesce((v_flags->>'card_to_subissue')::boolean, false)
        and coalesce((v_flags->>'samples')::boolean, false)) then
      return jsonb_build_object('state', 'dormant');
    end if;
    v_card_table := case when r.source_kind = 'card' then 'calendar_posts' else 'sample_reviews' end;
    v_card_id := r.source_id;
    v_name := r.new_value;
    if v_card_table = 'calendar_posts' then
      select video_deliverable_id, graphic_deliverable_id into v_video, v_graphic
        from public.calendar_posts where id = r.source_id and client = r.client;
    else
      select video_deliverable_id, graphic_deliverable_id into v_video, v_graphic
        from public.sample_reviews where id = r.source_id and client = r.client;
    end if;
    v_row_found := found;
    if not v_row_found then
      return jsonb_build_object('state', 'skipped', 'detail', jsonb_build_object('reason', 'card_missing'));
    end if;
  else
    -- Sub-issue -> card (release 2).
    if coalesce((v_flags->>'subissue_to_card')::boolean, false) is not true then
      return jsonb_build_object('state', 'dormant');
    end if;
    select * into v_d from public.deliverables where id = r.source_id;
    if not found or v_d.card_id is null then
      return jsonb_build_object('state', 'skipped', 'detail', jsonb_build_object('reason', 'no_card'));
    end if;
    v_card_table := case when v_d.origin = 'samples' then 'sample_reviews' else 'calendar_posts' end;
    if v_card_table = 'sample_reviews' and coalesce((v_flags->>'samples')::boolean, false) is not true then
      return jsonb_build_object('state', 'dormant');
    end if;
    v_card_id := v_d.card_id;
    v_name := public.syncview_title_name_of(r.new_value);
    if v_card_table = 'calendar_posts' then
      select video_deliverable_id, graphic_deliverable_id into v_video, v_graphic
        from public.calendar_posts where id = v_card_id and client = v_d.client_slug for update;
    else
      select video_deliverable_id, graphic_deliverable_id into v_video, v_graphic
        from public.sample_reviews where id = v_card_id and client = v_d.client_slug for update;
    end if;
    if not found or r.source_id not in (coalesce(v_video, ''), coalesce(v_graphic, '')) then
      return jsonb_build_object('state', 'skipped', 'detail', jsonb_build_object('reason', 'ambiguous_link'));
    end if;
    if exists (select 1 from public.rename_propagation_outbox o
                where o.source_kind in ('card', 'sample_card') and o.source_id = v_card_id
                  and o.created_at > r.created_at) then
      return jsonb_build_object('state', 'superseded');
    end if;
    -- The card takes the name; approvals are never touched (owner decision 2).
    if v_card_table = 'calendar_posts' then
      update public.calendar_posts set name = v_name
       where id = v_card_id and name is distinct from v_name;
    else
      update public.sample_reviews set name = v_name
       where id = v_card_id and name is distinct from v_name;
    end if;
    v_outcomes := v_outcomes || jsonb_build_object('card', case when found then 'done' else 'noop' end);
    v_exclude := r.source_id;
  end if;

  -- Every sub-issue in the card's slots (the sibling follows through the card).
  foreach v_target in array array[v_video, v_graphic] loop
    continue when v_target is null or v_target = coalesce(v_exclude, '');
    v_outcome := public.rename_propagation_apply_deliverable(
      r.id, r.created_at, v_card_table, v_card_id, v_target, v_name);
    v_outcomes := v_outcomes || jsonb_build_object(v_target, v_outcome);
  end loop;

  if exists (select 1 from jsonb_each_text(v_outcomes) e where e.value = 'deferred') then
    return jsonb_build_object('state', 'deferred', 'detail', v_outcomes);
  end if;
  if exists (select 1 from jsonb_each_text(v_outcomes) e
              where e.value not in ('done', 'noop', 'superseded')) then
    return jsonb_build_object('state', 'skipped', 'detail', v_outcomes);
  end if;
  if exists (select 1 from jsonb_each_text(v_outcomes) e where e.value = 'done') then
    return jsonb_build_object('state', 'done', 'detail', v_outcomes);
  end if;
  return jsonb_build_object('state', 'noop', 'detail', v_outcomes);
end
$fn$;
revoke all on function public.rename_propagation_process(public.rename_propagation_outbox)
  from public, anon, authenticated, service_role;

-- ── Drain ───────────────────────────────────────────────────────────────────
-- Backoff 1, 2, 5, 15, 60 minutes; the sixth failure gives up, marks the row
-- `failed` and writes the logbook. Run by .github/workflows/rename-propagation-drain.yml
-- and poked by the browser after a rename.
create or replace function public.rename_propagation_drain(p_limit integer default 50)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $fn$
declare
  r public.rename_propagation_outbox%rowtype;
  v jsonb;
  v_state text;
  v_counts jsonb := '{}'::jsonb;
  v_backoff interval[] := array[interval '1 minute', interval '2 minutes', interval '5 minutes',
                                interval '15 minutes', interval '60 minutes'];
  v_surface text;
  v_logged boolean;
begin
  perform set_config('syncview.rename_origin', 'propagation', true);
  for r in
    select * from public.rename_propagation_outbox
     where state in ('pending', 'deferred') and next_attempt_at <= clock_timestamp()
     order by id
     limit greatest(1, least(coalesce(p_limit, 50), 200))
     for update skip locked
  loop
    v_surface := case when r.source_kind = 'deliverable' then 'production' else 'calendar' end;
    begin
      v := public.rename_propagation_process(r);
      v_state := v->>'state';
      v_logged := false;
      if v_state = 'skipped' then
        perform public.rename_propagation_logbook(v_surface, 409,
          case when r.source_kind = 'deliverable' then r.source_id else null end,
          case when r.source_kind = 'deliverable' then null else r.source_id end, r.client);
        v_logged := true;
      end if;
      update public.rename_propagation_outbox
         set state = v_state,
             attempts = attempts + 1,
             updated_at = clock_timestamp(),
             next_attempt_at = case when v_state = 'deferred'
                                    then clock_timestamp() + interval '5 minutes'
                                    else next_attempt_at end,
             detail = coalesce(v->'detail', '{}'::jsonb)
                      || jsonb_build_object('logged', v_logged)
       where id = r.id;
    exception when others then
      update public.rename_propagation_outbox
         set attempts = attempts + 1,
             updated_at = clock_timestamp(),
             state = case when attempts + 1 >= 6 then 'failed' else 'pending' end,
             next_attempt_at = clock_timestamp()
                               + v_backoff[least(attempts + 1, array_length(v_backoff, 1))],
             detail = jsonb_build_object('error', sqlstate, 'message', left(sqlerrm, 200))
       where id = r.id
       returning state into v_state;
      if v_state = 'failed' then
        perform public.rename_propagation_logbook(v_surface, 503,
          case when r.source_kind = 'deliverable' then r.source_id else null end,
          case when r.source_kind = 'deliverable' then null else r.source_id end, r.client);
      end if;
    end;
    v_counts := v_counts || jsonb_build_object(v_state, coalesce((v_counts->>v_state)::integer, 0) + 1);
  end loop;
  -- Settled rows are kept 30 days as the record, then trimmed.
  delete from public.rename_propagation_outbox
   where id in (select id from public.rename_propagation_outbox
                 where state not in ('pending', 'deferred', 'failed')
                   and updated_at < clock_timestamp() - interval '30 days'
                 limit 500);
  perform set_config('syncview.rename_origin', '', true);
  return v_counts;
end
$fn$;
revoke all on function public.rename_propagation_drain(integer) from public, anon, authenticated, service_role;
grant execute on function public.rename_propagation_drain(integer) to service_role;

-- ── Browser: poke, retry, and the "name syncing" marker ─────────────────────
-- Poke drains a small bounded batch; anyone may ask, because it only applies
-- renames that were already recorded by an authorized save.
create or replace function public.rename_propagation_poke()
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $fn$
begin
  return public.rename_propagation_drain(20);
end
$fn$;
revoke all on function public.rename_propagation_poke() from public, anon, authenticated, service_role;
grant execute on function public.rename_propagation_poke() to anon, authenticated, service_role;

-- Retry a row that gave up. Only `failed` rows move; nothing else can be
-- changed through this.
create or replace function public.rename_propagation_retry(p_id bigint)
returns boolean language plpgsql security definer
set search_path = pg_catalog, public
as $fn$
begin
  update public.rename_propagation_outbox
     set state = 'pending', attempts = 0, next_attempt_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where id = p_id and state = 'failed';
  return found;
end
$fn$;
revoke all on function public.rename_propagation_retry(bigint) from public, anon, authenticated, service_role;
grant execute on function public.rename_propagation_retry(bigint) to anon, authenticated, service_role;

-- The marker reads the latest row per source: ids and state only, no names.
create or replace view public.rename_propagation_status_v1 as
select distinct on (o.source_kind, o.source_id)
       o.id, o.source_kind, o.source_id, o.client, o.state, o.updated_at
  from public.rename_propagation_outbox o
 where o.created_at > clock_timestamp() - interval '2 days'
   and o.state not in ('dormant', 'ignored_linear')
 order by o.source_kind, o.source_id, o.id desc;
revoke all on public.rename_propagation_status_v1 from public, anon, authenticated, service_role;
grant select on public.rename_propagation_status_v1 to anon, authenticated, service_role;

commit;
