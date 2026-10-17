-- ef-auto-deploy-applied-when: select to_regclass('public.fp_feedback_notes') is not null and to_regprocedure('public.fp_pass_use(text)') is not null
--
-- Filming pipeline passes and file store (item 1, PR 1; session Passkey,
-- 2026-10-16). Used by two Edge Functions:
--   higgsfield-mcp   the "pipeline_pass" tool makes a 6-hour pass for one
--                    person, one client and one target (test or client).
--   pipeline-google  accepts that pass in the x-pipeline-pass header, beside
--                    the old pipeline password, and limits it to that
--                    client's own files and to tabs made through a pass.
--
-- Tables (all service role only):
--   fp_publishers     who may make a pass for real client files. Seeded with
--                     nothing here (the repo is public); a supervisor inserts
--                     the rows by hand.
--   fp_settings       small settings, e.g. key 'test_sheet' = the TEST Sheet
--                     id. Seeded with nothing.
--   fp_passes         one row per pass. Only the SHA-256 of the token is kept,
--                     never the token.
--   fp_pass_tabs      every Doc or Sheet tab created through a pass; a pass
--                     may write only inside these.
--   fp_files          the pipeline's per-client files (config.json and the
--                     rest), current version; fp_file_history keeps every
--                     version. Written only through fp_file_save, which
--                     refuses a stale version.
--   fp_batch_counter  the next idea batch number per client; fp_take_batch
--                     hands one out atomically.
--   fp_feedback_notes feedback notes from a chat or the ideas Sheet.
--
-- Access: no browser key and no signed-in role reads, writes or executes any
-- of it. Supabase grants every new table to anon, authenticated and
-- service_role by default, and every new function to PUBLIC, so all four roles
-- are named in each revoke, and service_role gets back exactly what is listed
-- below (the assert at the end checks it):
--   fp_publishers, fp_settings, fp_passes, fp_batch_counter
--                         SELECT, INSERT, UPDATE, DELETE
--   fp_pass_tabs          SELECT, INSERT, DELETE
--   fp_files              SELECT only (writes go through fp_file_save, so no
--                         version can skip the history)
--   fp_file_history       SELECT only (written by fp_file_save; never changed)
--   fp_feedback_notes     SELECT, INSERT
--   fp_file_save, fp_take_batch, fp_pass_use   EXECUTE
--
-- The functions are SECURITY DEFINER (owner postgres) with a fixed
-- search_path, so they write fp_files and fp_file_history although
-- service_role cannot.
--
-- Rollback:
--   drop function if exists public.fp_pass_use(text);
--   drop function if exists public.fp_take_batch(text);
--   drop function if exists public.fp_file_save(text, text, integer, text, text);
--   drop table if exists public.fp_feedback_notes, public.fp_batch_counter,
--     public.fp_file_history, public.fp_files, public.fp_pass_tabs,
--     public.fp_passes, public.fp_settings, public.fp_publishers;
-- Written by session Passkey 2026-10-16; applied by Lighthouse.
begin;

create table if not exists public.fp_publishers (
  member text primary key check (length(member) between 1 and 80),
  added_at timestamptz not null default now(),
  note text check (note is null or length(note) <= 300)
);

create table if not exists public.fp_settings (
  key text primary key check (key ~ '^[a-z0-9][a-z0-9_]{0,59}$'),
  value jsonb not null
);

create table if not exists public.fp_passes (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  member text not null check (length(member) between 1 and 80),
  via text not null check (via in ('personal', 'team')),
  client_slug text not null check (client_slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  target text not null check (target in ('test', 'client')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '6 hours',
  last_used_at timestamptz,
  uses integer not null default 0 check (uses >= 0),
  -- A shared team link's name is self-declared, so it never reaches client files.
  constraint fp_passes_client_needs_personal check (target = 'test' or via = 'personal')
);

create index if not exists fp_passes_client_idx on public.fp_passes (client_slug, created_at desc);

create table if not exists public.fp_pass_tabs (
  file_id text not null check (file_id ~ '^[A-Za-z0-9_-]{10,100}$'),
  tab_id text not null check (length(tab_id) between 1 and 100),
  client_slug text not null check (client_slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  pass_id uuid references public.fp_passes(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (file_id, tab_id)
);

create table if not exists public.fp_files (
  client_slug text not null check (client_slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  name text not null check (name ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$' and name !~ '\.\.'),
  version integer not null check (version >= 1),
  body text not null check (length(body) <= 2000000),
  updated_by text not null check (length(updated_by) between 1 and 80),
  updated_at timestamptz not null default now(),
  primary key (client_slug, name)
);

create table if not exists public.fp_file_history (
  client_slug text not null,
  name text not null,
  version integer not null check (version >= 1),
  body text not null,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (client_slug, name, version)
);

create table if not exists public.fp_batch_counter (
  client_slug text primary key check (client_slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  next integer not null default 1 check (next >= 1)
);

create table if not exists public.fp_feedback_notes (
  id uuid primary key default gen_random_uuid(),
  client_slug text check (client_slug is null or client_slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  title text not null check (length(title) between 1 and 200),
  body text not null check (length(body) between 1 and 20000),
  source text not null check (source in ('chat', 'sheet')),
  follows uuid references public.fp_feedback_notes(id),
  member text not null check (length(member) between 1 and 80),
  created_at timestamptz not null default now()
);

create index if not exists fp_feedback_notes_created_idx on public.fp_feedback_notes (created_at desc);

-- Save one file: refuses unless expected_version is the current version (0 for
-- a file that does not exist yet), then bumps the version and writes the
-- history row, in one transaction. Answers saved, the new version, and the
-- current version (so a refused caller knows what to re-read).
create or replace function public.fp_file_save(
  p_client text, p_name text, p_expected_version integer, p_body text, p_member text)
returns table (saved boolean, new_version integer, current_version integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  cur integer;
  nv integer;
begin
  if p_body is null or coalesce(trim(p_member), '') = '' then
    raise exception 'fp_file_save: body and member are required';
  end if;
  select f.version into cur from public.fp_files f
   where f.client_slug = p_client and f.name = p_name for update;
  if not found then
    if coalesce(p_expected_version, 0) <> 0 then
      return query select false, null::integer, 0;
      return;
    end if;
    begin
      insert into public.fp_files (client_slug, name, version, body, updated_by, updated_at)
      values (p_client, p_name, 1, p_body, p_member, now());
    exception when unique_violation then
      -- Someone saved the first version a moment earlier.
      select f.version into cur from public.fp_files f where f.client_slug = p_client and f.name = p_name;
      return query select false, null::integer, cur;
      return;
    end;
    nv := 1;
  else
    if p_expected_version is distinct from cur then
      return query select false, null::integer, cur;
      return;
    end if;
    nv := cur + 1;
    update public.fp_files f
       set version = nv, body = p_body, updated_by = p_member, updated_at = now()
     where f.client_slug = p_client and f.name = p_name;
  end if;
  insert into public.fp_file_history (client_slug, name, version, body, updated_by, updated_at)
  values (p_client, p_name, nv, p_body, p_member, now());
  return query select true, nv, nv;
end
$fn$;

-- The next batch number for a client, handed out once (1 for a client with
-- no row; a supervisor may seed a row to continue an existing count).
create or replace function public.fp_take_batch(p_client text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare taken integer;
begin
  insert into public.fp_batch_counter as c (client_slug, next)
  values (p_client, 2)
  on conflict (client_slug) do update set next = c.next + 1
  returning c.next - 1 into taken;
  return taken;
end
$fn$;

-- Look up a pass by the hash of its token. A pass that has not expired is
-- counted (uses + 1, last_used_at now) in the same statement; an expired one
-- is returned with expired = true and left alone. No row: no such pass.
create or replace function public.fp_pass_use(p_token_hash text)
returns table (pass_id uuid, member text, via text, client_slug text, target text, expires_at timestamptz, expired boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
#variable_conflict use_column
begin
  return query
    update public.fp_passes p
       set uses = p.uses + 1, last_used_at = now()
     where p.token_hash = p_token_hash and p.expires_at > now()
    returning p.id, p.member, p.via, p.client_slug, p.target, p.expires_at, false;
  if not found then
    return query
      select p.id, p.member, p.via, p.client_slug, p.target, p.expires_at, true
        from public.fp_passes p where p.token_hash = p_token_hash;
  end if;
end
$fn$;

alter table public.fp_publishers enable row level security;
alter table public.fp_settings enable row level security;
alter table public.fp_passes enable row level security;
alter table public.fp_pass_tabs enable row level security;
alter table public.fp_files enable row level security;
alter table public.fp_file_history enable row level security;
alter table public.fp_batch_counter enable row level security;
alter table public.fp_feedback_notes enable row level security;

revoke all on table public.fp_publishers, public.fp_settings, public.fp_passes, public.fp_pass_tabs,
  public.fp_files, public.fp_file_history, public.fp_batch_counter, public.fp_feedback_notes
  from public, anon, authenticated, service_role;

grant select, insert, update, delete on table public.fp_publishers, public.fp_settings,
  public.fp_passes, public.fp_batch_counter to service_role;
grant select, insert, delete on table public.fp_pass_tabs to service_role;
grant select on table public.fp_files, public.fp_file_history to service_role;
grant select, insert on table public.fp_feedback_notes to service_role;

revoke all on function public.fp_file_save(text, text, integer, text, text) from public, anon, authenticated, service_role;
revoke all on function public.fp_take_batch(text) from public, anon, authenticated, service_role;
revoke all on function public.fp_pass_use(text) from public, anon, authenticated, service_role;
grant execute on function public.fp_file_save(text, text, integer, text, text) to service_role;
grant execute on function public.fp_take_batch(text) to service_role;
grant execute on function public.fp_pass_use(text) to service_role;

comment on table public.fp_publishers is 'Filming pipeline: connector members who may make a pass for real client files. Service role only; rows added by a supervisor.';
comment on table public.fp_settings is 'Filming pipeline settings (e.g. test_sheet). Service role only.';
comment on table public.fp_passes is 'Filming pipeline passes: SHA-256 of each token, never the token. Made by higgsfield-mcp pipeline_pass, checked by pipeline-google.';
comment on table public.fp_pass_tabs is 'Doc and Sheet tabs created through a pass; a pass writes only inside these.';
comment on table public.fp_files is 'Filming pipeline per-client files, current version. Written only through fp_file_save.';
comment on table public.fp_file_history is 'Every saved version of every fp_files file.';
comment on table public.fp_batch_counter is 'Next idea batch number per client; fp_take_batch hands one out.';
comment on table public.fp_feedback_notes is 'Filming pipeline feedback notes from a chat or the ideas Sheet.';

-- Assert: no browser role holds anything, and service_role holds exactly what
-- the header says, on every table and function.
do $assert$
declare
  n int;
  got text;
  want record;
begin
  select count(*) into n
  from pg_class c join pg_namespace s on s.oid = c.relnamespace, aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname like 'fp\_%'
    and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid, 0::oid);
  if n <> 0 then raise exception 'fp_ tables: a browser role holds privileges'; end if;

  for want in select * from (values
    ('fp_publishers', 'DELETE,INSERT,SELECT,UPDATE'),
    ('fp_settings', 'DELETE,INSERT,SELECT,UPDATE'),
    ('fp_passes', 'DELETE,INSERT,SELECT,UPDATE'),
    ('fp_batch_counter', 'DELETE,INSERT,SELECT,UPDATE'),
    ('fp_pass_tabs', 'DELETE,INSERT,SELECT'),
    ('fp_files', 'SELECT'),
    ('fp_file_history', 'SELECT'),
    ('fp_feedback_notes', 'INSERT,SELECT')) as t(rel, privs)
  loop
    select string_agg(a.privilege_type, ',' order by a.privilege_type) into got
    from pg_class c join pg_namespace s on s.oid = c.relnamespace, aclexplode(c.relacl) a
    where s.nspname = 'public' and c.relname = want.rel and a.grantee = 'service_role'::regrole::oid;
    if got is distinct from want.privs then
      raise exception '%: service_role holds % (expected %)', want.rel, got, want.privs;
    end if;
  end loop;

  select count(*) into n
  from pg_proc p join pg_namespace s on s.oid = p.pronamespace, aclexplode(p.proacl) a
  where s.nspname = 'public' and p.proname in ('fp_file_save', 'fp_take_batch', 'fp_pass_use')
    and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid, 0::oid);
  if n <> 0 then raise exception 'fp_ functions: a browser role or PUBLIC can execute'; end if;

  select count(*) into n
  from pg_proc p join pg_namespace s on s.oid = p.pronamespace, aclexplode(p.proacl) a
  where s.nspname = 'public' and p.proname in ('fp_file_save', 'fp_take_batch', 'fp_pass_use')
    and a.grantee = 'service_role'::regrole::oid and a.privilege_type = 'EXECUTE';
  if n <> 3 then raise exception 'fp_ functions: service_role can execute % of 3', n; end if;
end
$assert$;

commit;
