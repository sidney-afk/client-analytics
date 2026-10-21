-- ef-auto-deploy-applied-when: select to_regclass('public.hf_tools') is not null
--
-- Shared team tools (supabase/functions/higgsfield-mcp, studio_action actions
-- tool_save, tool_list, tool_get).
--
-- One row per tool name: a client kit or a tool a session made, saved once so
-- every teammate's Claude gets the latest. bundle is the text made by the
-- editor's kit bundler (the function refuses more than 20,000 characters and
-- anything that looks like a key before it writes). The same name saved again
-- by the same member replaces the row; another member's name is refused.
-- status is new, joined or flagged.
--
-- Access: no browser key and no signed-in role reads or writes it. Only the
-- higgsfield-mcp Edge Function (service role) reads and writes rows. Supabase
-- grants every new table to anon, authenticated and service_role by default,
-- so all four roles are named in the revoke.
--
-- Rollback: drop table public.hf_tools;
-- Written by the Connector lane 2026-10-21.
begin;

create table if not exists public.hf_tools (
  name text primary key check (name ~ '^[a-z0-9][a-z0-9._-]{0,59}$'),
  what text not null check (length(what) between 1 and 300),
  use text not null check (length(use) between 1 and 600),
  client text check (client is null or length(client) between 1 and 80),
  bundle text not null check (length(bundle) between 1 and 20000),
  member text not null check (length(member) between 1 and 80),
  status text not null default 'new' check (status in ('new', 'joined', 'flagged')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hf_tools_updated_idx on public.hf_tools (updated_at desc);

alter table public.hf_tools enable row level security;

revoke all on table public.hf_tools from public, anon, authenticated, service_role;
grant select, insert, update on table public.hf_tools to service_role;

comment on table public.hf_tools is
  'Shared team tools and client kits (bundle text, one row per name). Read and written only by higgsfield-mcp (service role).';

-- Assert: no browser role holds anything, service_role holds exactly INSERT, SELECT and UPDATE.
do $assert$
declare n int; sr text;
begin
  select count(*) into n
  from pg_class c join pg_namespace s on s.oid = c.relnamespace, aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname = 'hf_tools'
    and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid, 0::oid);
  if n <> 0 then raise exception 'hf_tools: a browser role holds privileges'; end if;
  select string_agg(a.privilege_type, ',' order by a.privilege_type) into sr
  from pg_class c join pg_namespace s on s.oid = c.relnamespace, aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname = 'hf_tools' and a.grantee = 'service_role'::regrole::oid;
  if sr is distinct from 'INSERT,SELECT,UPDATE' then
    raise exception 'hf_tools: service_role holds % (expected INSERT,SELECT,UPDATE)', sr;
  end if;
end
$assert$;

commit;
