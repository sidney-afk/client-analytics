\set ON_ERROR_STOP on

-- Disposable PostgreSQL-only fixture for scripts/f27-drill-runner.js.
-- The runner refuses the psql transport unless this marker exists in the
-- explicitly confirmed database. No object here is suitable for production.
create schema rollback_operator_fixture;
create table rollback_operator_fixture.identity (
  singleton boolean primary key check (singleton = true),
  marker text not null check (marker = 'ROLLBACK_DISPOSABLE_OPERATOR_FIXTURE')
);
insert into rollback_operator_fixture.identity(singleton, marker)
values (true, 'ROLLBACK_DISPOSABLE_OPERATOR_FIXTURE');

create schema extensions;
create extension if not exists pgcrypto with schema extensions;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end
$roles$;

create table public.clients (
  slug text primary key,
  active boolean not null,
  kind text not null
);
insert into public.clients(slug, active, kind)
values ('f27-disposable-fixture', true, 'test');

create table public.syncview_runtime_flags (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table public.flag_flips (
  id bigint generated always as identity primary key,
  key text not null,
  old_value jsonb,
  new_value jsonb,
  ts timestamptz not null default now(),
  actor text
);

create function public.rollback_fixture_log_flip()
returns trigger language plpgsql as $fn$
begin
  insert into public.flag_flips(key, old_value, new_value, actor)
  values (new.key, old.value, new.value, new.updated_by);
  new.updated_at := now();
  return new;
end
$fn$;

create trigger rollback_fixture_log_flip
before update on public.syncview_runtime_flags
for each row execute function public.rollback_fixture_log_flip();

create table public.mirror_outbox (
  id bigint generated always as identity primary key,
  deliverable_id text,
  op text,
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  next_retry_at timestamptz,
  entity text not null,
  entity_id text not null,
  batch_id text,
  comment_id text,
  operation text not null,
  client_slug text not null,
  team text not null,
  dedup_key text not null unique,
  source_edited_at timestamptz not null,
  status text not null,
  linear_result jsonb,
  shadow_actual jsonb,
  actor text,
  role text,
  depends_on_id bigint,
  locked_at timestamptz,
  lock_token uuid,
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  test_only boolean not null default false,
  last_error text,
  legacy_parity boolean not null default false,
  constraint mirror_outbox_status_fixture_check check (
    status in ('pending', 'shadow_ok', 'written', 'failed', 'skipped', 'stale')
  )
);

create or replace function public.mirror_outbox_requeue(p_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_count integer;
begin
  update public.mirror_outbox
  set status = 'pending', attempts = 0, last_error = null,
      processed_at = null, next_retry_at = now(),
      lock_token = null, locked_at = null, updated_at = now()
  where id = p_id
    and operation = 'comment'
    and status in ('written', 'skipped', 'failed', 'stale');
  get diagnostics v_count = row_count;
  return v_count = 1;
end
$fn$;

create or replace function public.mirror_outbox_enqueue(
  p_entity text,
  p_entity_id text,
  p_operation text,
  p_payload jsonb,
  p_dedup_key text,
  p_source_edited_at timestamptz,
  p_client_slug text,
  p_team text,
  p_actor text default null,
  p_role text default null,
  p_deliverable_id text default null,
  p_batch_id text default null,
  p_comment_id text default null,
  p_depends_on_id bigint default null,
  p_test_only boolean default false
) returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
begin
  return 1;
end;
$fn$;

revoke all on function public.mirror_outbox_enqueue(
  text, text, text, jsonb, text, timestamp with time zone, text, text,
  text, text, text, text, text, bigint, boolean
) from public, anon, authenticated;
grant execute on function public.mirror_outbox_enqueue(
  text, text, text, jsonb, text, timestamp with time zone, text, text,
  text, text, text, text, text, bigint, boolean
) to service_role;

-- Model the real pre-F27 writer posture: this gateway definition has been live
-- since the applied 2026-07-12 migration. F27 later replaces it only to add
-- the outbox lock, so the preinstall gate must require and preserve this exact
-- source/metadata/grant boundary.
create or replace function public.production_assert_authority(
  p_client_slug text,
  p_team text,
  p_test_only boolean,
  p_legacy_parity boolean
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_value jsonb;
  v_parity_value jsonb;
  v_authority text;
  v_test_ok boolean;
begin
  if p_test_only then
    select exists(
      select 1 from public.clients c
      where c.slug = p_client_slug and c.active = true and c.kind = 'test'
    ) into v_test_ok;
    if not v_test_ok then raise exception 'test_client_scope_required'; end if;
    return;
  end if;
  if p_team is null or p_team not in ('video', 'graphics') then
    raise exception 'authority_unavailable';
  end if;
  if p_legacy_parity then
    select f.value into v_parity_value
    from public.syncview_runtime_flags f
    where f.key = 'linear_legacy_parity_enabled'
    for share;
    if not found
       or jsonb_typeof(v_parity_value) <> 'object'
       or v_parity_value->'enabled' is distinct from 'true'::jsonb then
      raise exception 'legacy_parity_gate_unavailable';
    end if;
  end if;
  select f.value into v_value
  from public.syncview_runtime_flags f
  where f.key = 'prod_authority'
  for share;
  if not found or jsonb_typeof(v_value) <> 'object' then
    raise exception 'authority_unavailable';
  end if;
  v_authority := lower(nullif(v_value->>p_team, ''));
  if p_legacy_parity and v_authority is distinct from 'linear' then
    raise exception 'legacy_parity_not_allowed';
  elsif not p_legacy_parity and v_authority is distinct from 'syncview' then
    raise exception 'team_is_linear_authoritative';
  end if;
end;
$fn$;

revoke all on function public.production_assert_authority(
  text, text, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.production_assert_authority(
  text, text, boolean, boolean
) to service_role;

create function public.production_legacy_authority_probe(
  p_client_slug text,
  p_team text
) returns void
language plpgsql
set search_path = public
as $fn$
begin
  perform public.production_assert_authority(
    p_client_slug,
    p_team,
    false,
    false
  );
end;
$fn$;

insert into public.syncview_runtime_flags(key, value, updated_by) values
  ('prod_authority', '{"video":"linear","graphics":"linear"}', 'f27-disposable-fixture'),
  ('linear_outbound_enabled', '{"mode":"off"}', 'f27-disposable-fixture'),
  ('linear_legacy_parity_enabled', '{"enabled":false}', 'f27-disposable-fixture');

-- Synthetic rows on both real team labels prove the reserved drill never
-- binds or mutates either real-team lane. They contain no production data.
insert into public.mirror_outbox(
  payload, entity, entity_id, operation, client_slug, team, dedup_key,
  source_edited_at, status, test_only, legacy_parity
) values
  ('{"value":"fixture-video"}', 'deliverable', 'fixture-video', 'status',
   'f27-disposable-fixture', 'video', 'f27-fixture:video', now(), 'pending', true, false),
  ('{"value":"fixture-graphics"}', 'deliverable', 'fixture-graphics', 'comment',
   'f27-disposable-fixture', 'graphics', 'f27-fixture:graphics', now(), 'failed', true, false);

\ir ../migrations/2026-07-28-f27-write-authorization-only.sql

-- Browser SQL-editor pastes on Windows store CRLF in prosrc. Recreate both
-- reviewed functions from PostgreSQL's own definitions with CRLF so the hosted
-- positive proof exercises newline-normalized predicates, not only LF input.
do $f27_crlf_fixture$
begin
  execute replace(
    pg_get_functiondef(
      'public.track_b_f27_write_authorization(text)'::regprocedure
    ),
    E'\n',
    E'\r\n'
  );
  execute replace(
    pg_get_functiondef(
      'public.production_assert_authority(text,text,boolean,boolean)'::regprocedure
    ),
    E'\n',
    E'\r\n'
  );
end
$f27_crlf_fixture$;

\if :{?f27_preinstall_only}
\quit
\endif

\ir ../migrations/2026-07-20-f27-team-rollback.sql

do $proof$
begin
  if (select count(*) from public.mirror_outbox where team in ('video', 'graphics')) <> 2 then
    raise exception 'f27_fixture_migration_row_count_changed';
  end if;
  if exists (
    select 1 from public.mirror_outbox
    where entity_id = 'f27-migration-test'
       or dedup_key like 'f27-migration-test:%'
  ) then
    raise exception 'f27_fixture_migration_probe_not_rolled_back';
  end if;
  if exists (select 1 from public.track_b_team_rollbacks) then
    raise exception 'f27_fixture_not_dormant';
  end if;
end
$proof$;
