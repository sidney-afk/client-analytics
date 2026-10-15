-- Synchro connector activity log (supabase/functions/higgsfield-mcp).
--
-- One row per tools/call on the connector, success or failure: which link was
-- used (member_name), on the shared team link the first name the person gave
-- (who), the tool, the client as passed, Claude's one-line summary of what the
-- person asked (at most 200 characters), whether it worked, and a short error.
-- Written fire and forget after the reply: a row that cannot be written never
-- fails or slows the tool.
--
-- Access: no browser key and no signed-in role reads or writes it. Only the
-- higgsfield-mcp Edge Function (service role) inserts rows. Supabase grants
-- every new table to anon, authenticated and service_role by default, so all
-- four roles are named in the revoke.
--
-- Rollback: drop table public.hf_activity;
-- Written by session Lighthouse 2026-10-15; applied by Lighthouse after merge.
begin;

create table if not exists public.hf_activity (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  member_name text not null check (length(member_name) between 1 and 80),
  who text check (who is null or length(who) between 1 and 40),
  tool text not null check (length(tool) between 1 and 60),
  client text check (client is null or length(client) between 1 and 120),
  summary text check (summary is null or length(summary) between 1 and 200),
  ok boolean not null,
  error text check (error is null or length(error) between 1 and 300)
);

create index if not exists hf_activity_created_idx on public.hf_activity (created_at desc);

alter table public.hf_activity enable row level security;

revoke all on table public.hf_activity from public, anon, authenticated, service_role;
grant select, insert on table public.hf_activity to service_role;

comment on table public.hf_activity is
  'Synchro connector activity log: one row per tool call (link owner, team first name, tool, client, summary, ok, error). Written only by higgsfield-mcp (service role).';

-- Assert: no browser role holds anything, service_role holds exactly INSERT and SELECT.
do $assert$
declare n int; sr text;
begin
  select count(*) into n
  from pg_class c join pg_namespace s on s.oid = c.relnamespace, aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname = 'hf_activity'
    and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid, 0::oid);
  if n <> 0 then raise exception 'hf_activity: a browser role holds privileges'; end if;
  select string_agg(a.privilege_type, ',' order by a.privilege_type) into sr
  from pg_class c join pg_namespace s on s.oid = c.relnamespace, aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname = 'hf_activity' and a.grantee = 'service_role'::regrole::oid;
  if sr is distinct from 'INSERT,SELECT' then
    raise exception 'hf_activity: service_role holds % (expected INSERT,SELECT)', sr;
  end if;
end
$assert$;

commit;
