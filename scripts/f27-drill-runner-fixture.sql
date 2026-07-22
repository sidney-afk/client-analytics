\set ON_ERROR_STOP on

-- Disposable PostgreSQL-only fixture for scripts/f27-drill-runner.js.
-- The runner refuses the psql transport unless this marker exists in the
-- explicitly confirmed database. No object here is suitable for production.
create schema f27_operator_fixture;
create table f27_operator_fixture.identity (
  singleton boolean primary key check (singleton = true),
  marker text not null check (marker = 'F27_DISPOSABLE_OPERATOR_FIXTURE')
);
insert into f27_operator_fixture.identity(singleton, marker)
values (true, 'F27_DISPOSABLE_OPERATOR_FIXTURE');

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

create function public.f27_fixture_log_flip()
returns trigger language plpgsql as $fn$
begin
  insert into public.flag_flips(key, old_value, new_value, actor)
  values (new.key, old.value, new.value, new.updated_by);
  new.updated_at := now();
  return new;
end
$fn$;

create trigger f27_fixture_log_flip
before update on public.syncview_runtime_flags
for each row execute function public.f27_fixture_log_flip();

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
