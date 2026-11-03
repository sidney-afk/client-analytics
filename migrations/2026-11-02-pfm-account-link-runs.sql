-- ef-auto-deploy: functions-cope-without-this
-- ============================================================
-- 2026-11-02 -- The run log of the automatic Post for Me account link (L1 of
--   docs/plans/2026-11-trial-and-posting/combined.md, Sidney's D4). Written by session Lbuild. OPEN_REPAIRS 666.
--
-- client-profile-write's pfm_accounts_sync (the hourly timer, or an admin's "Check Post for Me accounts") links
-- an account to a client only on an exact, unique handle match, and lists everything else as "needs a person".
-- Each run is recorded here so the supervisor's watcher can read what needs a person and ask Sidney.
--
-- WHAT IT ADDS:
--   public.pfm_account_link_runs  one row per run: ran_at, trigger ('timer' | 'admin'), dry_run, ok, error,
--       counts, and two lists. Each list entry keeps ONLY account_id, network, username, reason, slug and
--       candidates (client slugs); any other key, at any depth, is dropped by the record function, so a token
--       can never be stored. Kept 30 days.
--   public.pfm_account_link_run_record(jsonb)       security definer; inserts one run, deletes rows older than 30 days.
--   public.pfm_account_link_runs_read(timestamptz)  security definer; the runs since a time, newest first.
--   public.pfm_account_link_key_ok(text)  security definer; true only when the text equals the Vault secret
--       pfm_account_link_key (at least 32 characters), compared as sha256 digests. VAULT IS THE ONLY COPY of the
--       hourly timer's key: client-profile-write asks this function and holds no secret of its own, so the
--       value is created inside the database (gen_random_bytes) and never appears in a transcript or a file.
--   No role may touch the table or its sequence (public, anon, authenticated and service_role all revoked);
--   service_role may only EXECUTE the three functions.
--
-- WHY THE FUNCTIONS COPE WITHOUT IT (the marker on line 1):
--   client-profile-write records each run best effort: until this is applied the record call fails, is
--   logged by name only, and the run still answers (the button shows its result; links are made as without it).
--   Without pfm_account_link_key_ok the timer's key check fails, so only the timer is refused (401); the admin
--   button, which signs with the admin key, is unaffected.
--
-- WATCHER'S READ (as owner, or as service_role):
--   select ran_at, trigger, dry_run, ok, error, linked_count, needs_person_count, needs_person
--   from public.pfm_account_link_runs_read(now() - interval '2 hours');
--
-- HOW TO TELL IT IS APPLIED (expect true):
--   select to_regprocedure('public.pfm_account_link_run_record(jsonb)') is not null
--     and to_regprocedure('public.pfm_account_link_runs_read(timestamptz)') is not null
--     and to_regprocedure('public.pfm_account_link_key_ok(text)') is not null
--     and to_regclass('public.pfm_account_link_runs') is not null as applied;
--
-- ROLLBACK: drop function if exists public.pfm_account_link_key_ok(text);
--   drop function if exists public.pfm_account_link_runs_read(timestamptz);
--   drop function if exists public.pfm_account_link_run_record(jsonb);
--   drop table if exists public.pfm_account_link_runs;
--   (unschedule 2026-11-02-pfm-account-link-schedule.sql first if it was applied).
-- ============================================================
begin;
set local lock_timeout = '5s';

create table if not exists public.pfm_account_link_runs (
  id bigserial primary key,
  ran_at timestamptz not null default now(),
  trigger text not null check (trigger in ('timer', 'admin')),
  dry_run boolean not null default false,
  ok boolean not null,
  error text,
  accounts integer not null default 0,
  already_linked integer not null default 0,
  linked_count integer not null default 0,
  needs_person_count integer not null default 0,
  linked jsonb not null default '[]'::jsonb,
  needs_person jsonb not null default '[]'::jsonb
);
create index if not exists pfm_account_link_runs_ran_at on public.pfm_account_link_runs (ran_at desc);
alter table public.pfm_account_link_runs enable row level security;
revoke all on table public.pfm_account_link_runs from public, anon, authenticated, service_role;
revoke all on sequence public.pfm_account_link_runs_id_seq from public, anon, authenticated, service_role;

-- One list entry: the named keys only (text, or a list of text for candidates).
create or replace function public.pfm_account_link_entries(p jsonb) returns jsonb
language sql immutable
set search_path = public, pg_temp
as $fn$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'account_id', left(e ->> 'account_id', 100),
      'network', left(e ->> 'network', 40),
      'username', left(e ->> 'username', 200),
      'reason', left(e ->> 'reason', 100),
      'slug', left(e ->> 'slug', 100),
      'candidates', case when jsonb_typeof(e -> 'candidates') = 'array'
        then (select jsonb_agg(left(c, 100)) from jsonb_array_elements_text(e -> 'candidates') c) end))), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) e
  where jsonb_typeof(e) = 'object'
$fn$;

create or replace function public.pfm_account_link_run_record(p_run jsonb) returns bigint
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  new_id bigint;
  l jsonb := public.pfm_account_link_entries(p_run -> 'linked');
  n jsonb := public.pfm_account_link_entries(p_run -> 'needs_person');
begin
  delete from public.pfm_account_link_runs where ran_at < now() - interval '30 days';
  insert into public.pfm_account_link_runs
    (trigger, dry_run, ok, error, accounts, already_linked, linked_count, needs_person_count, linked, needs_person)
  values (
    p_run ->> 'trigger',
    coalesce((p_run ->> 'dry_run')::boolean, false),
    coalesce((p_run ->> 'ok')::boolean, false),
    left(p_run ->> 'error', 200),
    coalesce((p_run ->> 'accounts')::integer, 0),
    coalesce((p_run ->> 'already_linked')::integer, 0),
    jsonb_array_length(l), jsonb_array_length(n), l, n)
  returning id into new_id;
  return new_id;
end
$fn$;

create or replace function public.pfm_account_link_runs_read(p_since timestamptz)
returns setof public.pfm_account_link_runs
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  select * from public.pfm_account_link_runs where ran_at >= p_since order by ran_at desc, id desc
$fn$;

-- The hourly timer's key, checked against the only copy in Vault. sha256 digests are compared, so the time taken
-- does not depend on how much of the secret a guess gets right.
create or replace function public.pfm_account_link_key_ok(p_key text) returns boolean
language plpgsql stable security definer
set search_path = public, pg_temp
as $fn$
declare
  v text;
begin
  if p_key is null or length(p_key) < 32 then return false; end if;
  select decrypted_secret into v from vault.decrypted_secrets where name = 'pfm_account_link_key' limit 1;
  if v is null or length(v) < 32 then return false; end if;
  return sha256(convert_to(p_key, 'UTF8')) = sha256(convert_to(v, 'UTF8'));
end
$fn$;

revoke all on function public.pfm_account_link_entries(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.pfm_account_link_key_ok(text) from public, anon, authenticated, service_role;
revoke all on function public.pfm_account_link_run_record(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.pfm_account_link_runs_read(timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.pfm_account_link_run_record(jsonb) to service_role;
grant execute on function public.pfm_account_link_runs_read(timestamptz) to service_role;
grant execute on function public.pfm_account_link_key_ok(text) to service_role;

commit;
