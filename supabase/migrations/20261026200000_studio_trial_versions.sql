-- ef-auto-deploy: functions-cope-without-this
-- ef-auto-deploy-applied-when: select to_regclass('public.studio_trial_versions') is not null
--
-- Trial reels log (supabase/functions/higgsfield-mcp, studio_action "trial_reels").
-- One row per version of a video (video numbers repeat across batches, so batch is part of its identity): letter A to G, its hook, hook family, the one
-- other change, status, when it went on trial and the 24 hour numbers the SMM
-- types in. higgsfield-mcp copes without the table: the action answers "not
-- switched on yet" until this is applied.
--
-- Access: no browser key and no signed-in role reads or writes it. Only the
-- higgsfield-mcp Edge Function (service role). Supabase grants every new table to
-- anon, authenticated and service_role by default, so all four are named below.
-- The SyncView lane may read it later for the card's versions; it gets its own grant then.
--
-- Rollback: drop table public.studio_trial_versions;
-- Written by the AI editor lane 2026-10-26.
begin;

create table if not exists public.studio_trial_versions (
  id uuid primary key default gen_random_uuid(),
  client text not null check (length(client) between 1 and 80),
  batch text not null default '' check (length(batch) <= 80),
  video text not null check (length(video) between 1 and 40),
  letter text not null check (letter ~ '^[A-G]$'),
  hook text check (hook is null or length(hook) between 1 and 300),
  hook_type text check (hook_type is null or length(hook_type) <= 80),
  other_change text check (other_change is null or length(other_change) <= 200),
  status text not null default 'waiting' check (status in ('waiting', 'approved', 'change asked', 'dropped', 'on trial', 'winner', 'lost', 'no clear winner')),
  posted_at timestamptz,
  views integer check (views >= 0),
  watch_time_s integer check (watch_time_s >= 0),
  shares integer check (shares >= 0),
  saves integer check (saves >= 0),
  follows integer check (follows >= 0),
  member text not null check (length(member) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client, batch, video, letter)
);

create index if not exists studio_trial_versions_client_idx on public.studio_trial_versions (lower(client), batch, video);

alter table public.studio_trial_versions enable row level security;

revoke all on table public.studio_trial_versions from public, anon, authenticated, service_role;
grant select, insert, update on table public.studio_trial_versions to service_role;

comment on table public.studio_trial_versions is
  'Trial reels log, one row per version. Read and written only by higgsfield-mcp (service role).';

do $assert$
declare n int; sr text;
begin
  select count(*) into n
  from pg_class c join pg_namespace s on s.oid = c.relnamespace, aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname = 'studio_trial_versions'
    and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid, 0::oid);
  if n <> 0 then raise exception 'studio_trial_versions: a browser role holds privileges'; end if;
  select string_agg(a.privilege_type, ',' order by a.privilege_type) into sr
  from pg_class c join pg_namespace s on s.oid = c.relnamespace, aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname = 'studio_trial_versions' and a.grantee = 'service_role'::regrole::oid;
  if sr is distinct from 'INSERT,SELECT,UPDATE' then
    raise exception 'studio_trial_versions: service_role holds % (expected INSERT,SELECT,UPDATE)', sr;
  end if;
end
$assert$;

commit;
