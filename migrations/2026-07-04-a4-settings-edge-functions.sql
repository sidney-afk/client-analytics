-- A4 settings Edge Functions: templates + caption prompts leave Google Sheets.
-- Additive-only. Old n8n/Sheets paths remain live as fallback.

create table if not exists public.templates (
  client_slug text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone not null default now(),
  updated_by text
);

alter table public.templates enable row level security;

drop policy if exists "anon read templates" on public.templates;
create policy "anon read templates"
  on public.templates
  as permissive
  for select
  to anon, authenticated
  using (true);

grant select on table public.templates to anon;
grant select on table public.templates to authenticated;
grant select, insert, update, delete on table public.templates to service_role;

alter table public.templates replica identity full;

create table if not exists public.caption_prompts (
  client_slug text primary key,
  prompt text not null default '',
  updated_at timestamp with time zone not null default now(),
  updated_by text
);

alter table public.caption_prompts enable row level security;

drop policy if exists "anon read caption_prompts" on public.caption_prompts;
create policy "anon read caption_prompts"
  on public.caption_prompts
  as permissive
  for select
  to anon, authenticated
  using (true);

grant select on table public.caption_prompts to anon;
grant select on table public.caption_prompts to authenticated;
grant select, insert, update, delete on table public.caption_prompts to service_role;

alter table public.caption_prompts replica identity full;

insert into public.syncview_runtime_flags (key, value, updated_by)
values ('settings_ef_clients', '{"clients":[]}'::jsonb, 'a4-migration')
on conflict (key) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'templates'
  ) then
    alter publication supabase_realtime add table public.templates;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'caption_prompts'
  ) then
    alter publication supabase_realtime add table public.caption_prompts;
  end if;
end $$;
