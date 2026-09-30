-- ============================================================
-- NOT APPLIED. Written 2026-09-30 by Anvil for the caption-jobs Edge Function
-- (docs/plans/2026-09-30-n8n-exit-phase-2.md, step B). Lighthouse applies it with
-- the owner's go, then the function is deployed.
--
-- Progress of a caption generation: one row per job, written by the Generate
-- Caption workflow (through the function) and read by the Calendar page (through
-- the function). It replaces the n8n data table of the same name. The function
-- reads and writes it with service_role only; no browser role holds anything.
--
-- Supabase grants service_role, anon and authenticated full rights on every new
-- object by default, so the revoke names all four and service_role is then given
-- back only what the function needs (select, insert, update, delete for pruning).
--
-- Rollback: drop table public.caption_jobs;  (progress rows only; a finished
-- caption is saved to the card by the workflow, not kept here)
-- ============================================================
begin;
set local lock_timeout = '5s';

create table if not exists public.caption_jobs (
  job_id           text primary key check (char_length(job_id) between 1 and 120),
  client           text not null default '',
  post_id          text not null default '',
  status           text not null default '',
  stage            text not null default '',
  caption          text not null default '' check (char_length(caption) <= 5000),
  error            text not null default '' check (char_length(error) <= 600),
  cancel_requested boolean not null default false,
  started_at       timestamptz,
  updated_at       timestamptz not null default now()
);
create index if not exists caption_jobs_client_updated_idx on public.caption_jobs (client, updated_at desc);
create index if not exists caption_jobs_updated_idx on public.caption_jobs (updated_at);

alter table public.caption_jobs enable row level security;

revoke all on table public.caption_jobs from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.caption_jobs to service_role;

-- Assert: no browser role holds anything, service_role holds exactly select, insert, update and delete.
do $assert$
declare n int; sr text;
begin
  select count(*) into n
  from pg_class c join pg_namespace s on s.oid = c.relnamespace,
       aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname = 'caption_jobs'
    and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid, 0::oid);
  if n <> 0 then raise exception 'caption_jobs: a browser role holds privileges'; end if;

  select string_agg(a.privilege_type, ',' order by a.privilege_type) into sr
  from pg_class c join pg_namespace s on s.oid = c.relnamespace,
       aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname = 'caption_jobs' and a.grantee = 'service_role'::regrole::oid;
  if sr is distinct from 'DELETE,INSERT,SELECT,UPDATE' then
    raise exception 'caption_jobs: service_role holds % (expected DELETE,INSERT,SELECT,UPDATE)', sr;
  end if;
end
$assert$;

commit;
