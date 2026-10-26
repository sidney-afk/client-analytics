-- ef-auto-deploy-applied-when: select to_regclass('public.trial_reel_cards') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'studio_trial_versions' and column_name = 'frame_url')
--
-- Trial reels, SyncView half (session Trials, 2026-10-27; plan docs/features/TRIAL_REELS_PLAN.md, approved as #2352).
--
-- 1. SyncView's columns on the studio's log table studio_trial_versions (created by
--    20261026200000_studio_trial_versions.sql, #2349). One row per version stays the one store: the card and the
--    Production sub-issue both read a version's Frame.io link from frame_url, and the trial-reels Edge Function is
--    the only writer of every column added here except post_id and deliverable_id, which the studio's log fills.
--    All of them are nullable or defaulted, so the rows the studio has already logged stay valid.
-- 2. trial_reel_cards: the "Trial reels" switch of one calendar card, and the winner's letter once picked.
--
-- The functions held by this file (trial-reels) deploy once the line at the top answers true. Apply this file only
-- after 20261026200000_studio_trial_versions.sql; it stops with a plain error if that table is missing.
--
-- Access: no browser key and no signed-in role reads or writes either table. Supabase grants every new table to
-- anon, authenticated and service_role by default, so all four roles are named in each revoke, and the service role
-- (the Edge Functions) gets back exactly SELECT, INSERT, UPDATE. studio_trial_versions keeps #2349's grants.
--
-- Rollback: drop table public.trial_reel_cards; and drop the added columns of public.studio_trial_versions
-- (post_id, deliverable_id, frame_url, smm_ok_at, kasper_ok_at, client_ok_at, change_by, change_note, change_at,
-- revision, trial_ends_at) and the index studio_trial_versions_post_idx.
begin;

do $first$
begin
  if to_regclass('public.studio_trial_versions') is null then
    raise exception 'Apply supabase/migrations/20261026200000_studio_trial_versions.sql first: public.studio_trial_versions does not exist yet.';
  end if;
end
$first$;

alter table public.studio_trial_versions
  add column if not exists post_id text check (post_id is null or length(post_id) between 1 and 120),
  add column if not exists deliverable_id uuid,
  add column if not exists frame_url text check (frame_url is null or (frame_url ~ '^https://' and length(frame_url) <= 2048)),
  add column if not exists smm_ok_at timestamptz,
  add column if not exists kasper_ok_at timestamptz,
  add column if not exists client_ok_at timestamptz,
  add column if not exists change_by text check (change_by is null or change_by in ('smm', 'kasper', 'client')),
  add column if not exists change_note text check (change_note is null or length(change_note) <= 4000),
  add column if not exists change_at timestamptz,
  add column if not exists revision integer not null default 0 check (revision >= 0),
  add column if not exists trial_ends_at timestamptz;

create index if not exists studio_trial_versions_post_idx on public.studio_trial_versions (lower(client), post_id);

create table if not exists public.trial_reel_cards (
  client text not null check (length(client) between 1 and 80),
  post_id text not null check (length(post_id) between 1 and 120),
  enabled boolean not null default false,
  winner_letter text check (winner_letter is null or winner_letter ~ '^[A-G]$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text check (updated_by is null or length(updated_by) <= 80),
  primary key (client, post_id)
);

alter table public.trial_reel_cards enable row level security;

revoke all on table public.trial_reel_cards from public, anon, authenticated, service_role;
grant select, insert, update on table public.trial_reel_cards to service_role;

comment on table public.trial_reel_cards is
  'Trial reels: the switch of one calendar card and its winner. Read and written only by the trial-reels Edge Function (service role).';

-- Read back what each role holds on both tables, so "revoked" is measured, not assumed.
do $assert$
declare n int; sr text; t text;
begin
  foreach t in array array['trial_reel_cards', 'studio_trial_versions'] loop
    select count(*) into n
    from pg_class c join pg_namespace s on s.oid = c.relnamespace, aclexplode(c.relacl) a
    where s.nspname = 'public' and c.relname = t
      and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid, 0::oid);
    if n <> 0 then raise exception '%: a browser role holds privileges', t; end if;
    select string_agg(a.privilege_type, ',' order by a.privilege_type) into sr
    from pg_class c join pg_namespace s on s.oid = c.relnamespace, aclexplode(c.relacl) a
    where s.nspname = 'public' and c.relname = t and a.grantee = 'service_role'::regrole::oid;
    if sr is distinct from 'INSERT,SELECT,UPDATE' then
      raise exception '%: service_role holds % (expected INSERT,SELECT,UPDATE)', t, sr;
    end if;
  end loop;
end
$assert$;

commit;
