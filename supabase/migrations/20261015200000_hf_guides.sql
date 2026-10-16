-- Synchro connector team guides (supabase/functions/higgsfield-mcp, the
-- "guide" tool).
--
-- One row per version of a playbook: topic (lowercase, dashes) and the text
-- Claude follows for that kind of task. A change is a new row, never an
-- update, so the newest row per topic is live and the older ones are its
-- history. Rows are written by a maintainer with SQL; a change reaches every
-- teammate on their next call, with no skill reinstall and no deploy.
--
-- Access: no browser key and no signed-in role reads or writes it. The
-- higgsfield-mcp Edge Function (service role) only reads. Supabase grants every
-- new table to anon, authenticated and service_role by default, so all four
-- roles are named in the revoke.
--
-- Rollback: drop table public.hf_guides;
-- Written by session Lighthouse 2026-10-15; applied by Lighthouse after merge.
begin;

create table if not exists public.hf_guides (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  topic text not null check (topic ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  body text not null check (length(body) between 1 and 20000),
  written_by text not null check (length(written_by) between 1 and 80)
);

create index if not exists hf_guides_topic_idx on public.hf_guides (topic, created_at desc);

alter table public.hf_guides enable row level security;

revoke all on table public.hf_guides from public, anon, authenticated, service_role;
grant select on table public.hf_guides to service_role;

comment on table public.hf_guides is
  'Synchro connector team guides: newest row per topic is the live playbook, older rows are history. Read only by higgsfield-mcp (service role).';

-- Assert: no browser role holds anything, service_role holds exactly SELECT.
do $assert$
declare n int; sr text;
begin
  select count(*) into n
  from pg_class c join pg_namespace s on s.oid = c.relnamespace, aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname = 'hf_guides'
    and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid, 0::oid);
  if n <> 0 then raise exception 'hf_guides: a browser role holds privileges'; end if;
  select string_agg(a.privilege_type, ',' order by a.privilege_type) into sr
  from pg_class c join pg_namespace s on s.oid = c.relnamespace, aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname = 'hf_guides' and a.grantee = 'service_role'::regrole::oid;
  if sr is distinct from 'SELECT' then
    raise exception 'hf_guides: service_role holds % (expected SELECT)', sr;
  end if;
end
$assert$;

commit;
