-- ============================================================
-- NOT YET APPLIED. Written 2026-10-14 for the Calendar's caption dialog (call to action, platform, a note, title
-- ideas, hashtags, redo with a note). Lighthouse applies it with the owner's go, BEFORE the three functions are
-- deployed (caption-jobs, caption-prompts-save, caption-generate; see the PR).
--
-- 1. public.caption_cta_options: one row per client holding that client's own list of calls to action (short
--    keywords). Read and written by the caption-prompts-save function (staff editor) and read by caption-generate,
--    both with service_role. No browser role holds anything, so the list is not readable with the publishable key.
-- 2. public.caption_jobs.extras: the title ideas, the best title, the hashtags and the call to action the model used
--    for one job. The page reads them through caption-jobs, like the rest of the row. No caption text, note or
--    transcript goes in it.
-- 3. Seed: a client whose caption prompt has a "CTAs" section naming the six keywords below gets them as its list.
--    Clients with no list simply have none (the dialog then shows only the note box). No client is named here.
--
-- Supabase grants service_role, anon and authenticated full rights on every new object by default, so the revoke
-- names all four and service_role is then given back only what the functions need.
--
-- Rollback: alter table public.caption_jobs drop column if exists extras;  drop table public.caption_cta_options;
-- ============================================================
begin;
set local lock_timeout = '5s';

create table if not exists public.caption_cta_options (
  client_slug text primary key check (char_length(client_slug) between 1 and 120),
  options     jsonb not null default '[]'::jsonb
              check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) <= 12 and pg_column_size(options) <= 2000),
  updated_at  timestamptz not null default now(),
  updated_by  text not null default ''
);
alter table public.caption_cta_options enable row level security;
revoke all on table public.caption_cta_options from public, anon, authenticated, service_role;
grant select, insert, update on table public.caption_cta_options to service_role;

alter table public.caption_jobs
  add column if not exists extras jsonb not null default '{}'::jsonb
  check (jsonb_typeof(extras) = 'object' and pg_column_size(extras) <= 8000);

-- Seed from the CTA section of the caption prompt (keywords in the order the section lists them).
insert into public.caption_cta_options (client_slug, options, updated_by)
select p.client_slug, '["REVIVAL","BACK","BUILD","LEARN","RESHAPE","NOTIFY"]'::jsonb, 'seed'
from public.caption_prompts p
where p.prompt like '%CTAs (%'
  and p.prompt ~ 'REVIVAL' and p.prompt ~ 'BACK' and p.prompt ~ 'BUILD'
  and p.prompt ~ 'LEARN' and p.prompt ~ 'RESHAPE' and p.prompt ~ 'NOTIFY'
on conflict (client_slug) do nothing;

-- Assert: no browser role holds anything on the new table, service_role holds exactly INSERT, SELECT, UPDATE.
do $assert$
declare n int; sr text;
begin
  select count(*) into n
  from pg_class c join pg_namespace s on s.oid = c.relnamespace,
       aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname = 'caption_cta_options'
    and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid, 0::oid);
  if n <> 0 then raise exception 'caption_cta_options: a browser role holds privileges'; end if;

  select string_agg(a.privilege_type, ',' order by a.privilege_type) into sr
  from pg_class c join pg_namespace s on s.oid = c.relnamespace,
       aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname = 'caption_cta_options' and a.grantee = 'service_role'::regrole::oid;
  if sr is distinct from 'INSERT,SELECT,UPDATE' then
    raise exception 'caption_cta_options: service_role holds % (expected INSERT,SELECT,UPDATE)', sr;
  end if;
end
$assert$;

commit;
