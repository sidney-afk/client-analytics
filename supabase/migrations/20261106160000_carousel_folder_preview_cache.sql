-- ef-auto-deploy: functions-cope-without-this
-- ef-auto-deploy-applied-when: select to_regclass('public.carousel_folder_preview_cache') is not null
--
-- Carousel preview (session Carouselbuild, 2026-11-06, OPEN_REPAIRS 710; Sidney's go: "I need a real sample").
-- A card whose thumbnail is a Google Drive FOLDER of images (a carousel) shows the folder's first image by name,
-- a "Carousel · N images" badge and "Open in Drive", instead of the dark "Open folder" card. The page asks
-- thumbnail-folder-resolve (action folder_preview), which lists the folder with the Drive API key only and caches
-- the answer here so one folder is read at most once per few minutes however many people look.
--
-- What this migration holds: ONE table, carousel_folder_preview_cache, one row per Drive folder id (the id is
-- in the Drive link, not a secret; no file name, no image bytes and no token is stored: the first image's file id,
-- the image count, whether a video is also inside, and the state ok / empty / no_images / not_shared).
--
-- The switch itself is NOT created here. It is the runtime flag carousel_preview_v1: "clients" holds ONLY the
-- test client; "viewers" lists staff members (roster NAME and id, as in public.team_members) who see the new behaviour
-- on EVERY client, including a client link opened in a browser that holds their signed-in staff session (key-verify
-- confirms it; the server needs a real staff role key and the listed name). Real clients on their own devices keep
-- today's page. Lighthouse sets it, as the owner, with the owner's own name and id (never written in this repo):
--   select id, name, role from public.team_members where name ilike '%<first name>%';   -- read them here
--   insert into public.syncview_runtime_flags (key, value)
--   values ('carousel_preview_v1', jsonb_build_object('clients', jsonb_build_array('sidneylaruel'),
--           'viewers', jsonb_build_array('<member id>', '<member full name>')))
--   on conflict (key) do update set value = excluded.value;
-- Put BOTH the id and the full name: the page matches either, the server matches the name.
-- Without the row, the function answers { enabled: false } for every client and the page is exactly as it was.
--
-- Why the functions cope without it: the function reads this table best effort (an unreadable cache is a cache
-- miss) and ignores a failed write; with no table every look reads Drive once. Nothing else uses it.
--
-- Access: service role only. Supabase grants every new object to anon, authenticated and service_role by default,
-- so the revoke names all four roles (public, anon, authenticated, service_role) and then grants service_role back
-- the three rights it uses. The block at the end reads back what each role holds and stops if anyone but
-- service_role can touch the table.
--
-- How to tell it is applied: the applied-when line above answers true.
--
-- Rollback: drop table if exists public.carousel_folder_preview_cache; (it is only a cache; every look reads Drive
-- again.) The flag row, if it was set, is deleted separately: delete from public.syncview_runtime_flags
-- where key = 'carousel_preview_v1';
begin;

create table if not exists public.carousel_folder_preview_cache (
  folder_id     text primary key check (folder_id ~ '^[A-Za-z0-9_-]{15,200}$'),
  client        text not null,
  state         text not null check (state in ('ok', 'empty', 'no_images', 'not_shared')),
  image_count   integer not null default 0 check (image_count >= 0),
  has_video     boolean not null default false,
  first_file_id text not null default '' check (first_file_id = '' or first_file_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  checked_at    timestamptz not null default now()
);

alter table public.carousel_folder_preview_cache enable row level security;

revoke all on table public.carousel_folder_preview_cache from public, anon, authenticated, service_role;
grant select, insert, update on table public.carousel_folder_preview_cache to service_role;

do $check$
declare
  r text;
  leaked int;
begin
  foreach r in array array['anon', 'authenticated'] loop
    select count(*) into leaked
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'carousel_folder_preview_cache' and grantee = r;
    if leaked > 0 then
      raise exception 'carousel_folder_preview_cache: role % still holds % privilege(s)', r, leaked;
    end if;
  end loop;
  if has_table_privilege('public', 'public.carousel_folder_preview_cache', 'select') then
    raise exception 'carousel_folder_preview_cache: PUBLIC can still select';
  end if;
  if not (has_table_privilege('service_role', 'public.carousel_folder_preview_cache', 'select')
          and has_table_privilege('service_role', 'public.carousel_folder_preview_cache', 'insert')
          and has_table_privilege('service_role', 'public.carousel_folder_preview_cache', 'update')) then
    raise exception 'carousel_folder_preview_cache: service_role lost a right it needs';
  end if;
  if has_table_privilege('service_role', 'public.carousel_folder_preview_cache', 'delete') then
    raise exception 'carousel_folder_preview_cache: service_role holds delete it should not';
  end if;
end
$check$;

commit;
