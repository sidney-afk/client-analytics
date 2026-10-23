-- ef-auto-deploy: functions-cope-without-this
-- ============================================================
-- 2026-10-23 -- Caption history on Calendar cards: every version of a card's caption, kept.
-- Written by session Versions, 2026-10-23 21:15 UTC (date -u). Design: docs/syncview-design/mockups/caption-history/.
--
-- WHAT IT ADDS (additive, nothing existing changes):
--   public.caption_versions   append-only: one row each time a card's caption (or second-platform caption) really
--       changes: the new text, how it changed (kind), the redo note, the version it was put back from, and who
--       (the display name and role the staff page sent). Nothing is ever updated or deleted.
--   public.caption_versions_capture()   AFTER INSERT/UPDATE trigger on calendar_posts that writes those rows.
--       IT NEVER BLOCKS OR SLOWS A CAPTION SAVE: all its work is inside one exception block, so any error in it
--       (a bad header, the table missing, a full disk on this one insert) is caught, logged as a WARNING
--       ("caption_versions_capture skipped: <sqlstate>") and the card save goes on. It does one small insert
--       only when the caption text is different; every other card save returns at the first comparison.
--   public.caption_versions_refuse_change()   refuses UPDATE, DELETE and TRUNCATE on the table.
--
-- HOW A ROW LEARNS HOW THE CAPTION CHANGED (kind):
--   calendar-card-write (every staff save) sends the header x-syncview-caption-origin, base64 of
--   {"k": typed|redo|restored, "n": note, "f": version id, "a": actor, "r": role}, on its write to the table;
--   PostgREST hands it to this trigger as request.headers. A write that came through the API without that header
--   (calendar-upsert: client review links, and caption-generate's first caption) is "generated" when it equals the
--   caption a caption job just produced for that card, else "saved" (the read in caption-generate then labels it a
--   client edit when the client wrote about the caption in the same minutes). A write with no API request at all
--   (SQL, a repair script) is "outside".
--
-- WHY THE FUNCTIONS COPE WITHOUT IT (the marker on line 1):
--   calendar-card-write only adds a header, which nothing reads until this trigger exists. caption-generate's two
--   history reads answer { ok: true, available: false } when the table is missing, and the page then shows no
--   history icon. The visible part is also behind the runtime switch caption_history_staff (absent = off).
--
-- HOW TO TELL IT IS APPLIED (expect true, true, true):
--   select to_regclass('public.caption_versions') is not null as table_exists,
--          exists (select 1 from pg_trigger where tgrelid = 'public.calendar_posts'::regclass
--                    and tgname = 'zz_caption_versions_capture' and not tgisinternal) as trigger_exists,
--          case when to_regclass('public.caption_versions') is null then false
--               else not has_table_privilege('anon', 'public.caption_versions', 'select') end as browser_closed;
--
-- Supabase grants service_role, anon and authenticated full rights on every new object by default, so every
-- revoke below names all four roles (public, anon, authenticated, service_role), and service_role is then given
-- back only SELECT on the table (caption-generate reads it). The trigger functions run as their owner, so the
-- trigger needs no grant to any role, and no role may EXECUTE them directly.
--
-- Retention: kept forever (about 3,000 saves a month at under 1 kB each).
-- Backfill of the changes since 2026-09-17: a separate file applied by hand,
--   scripts/caption-versions-backfill.sql (not part of this migration).
--
-- Rollback: drop trigger if exists zz_caption_versions_capture on public.calendar_posts;
--           drop function if exists public.caption_versions_capture();
--           (the table can stay; drop table public.caption_versions only if its history is not wanted)
-- ============================================================
begin;
set local lock_timeout = '5s';

create table if not exists public.caption_versions (
  id            bigint generated always as identity primary key,
  client        text not null check (char_length(client) between 1 and 120),
  post_id       text not null check (char_length(post_id) between 1 and 200),
  field         text not null check (field in ('caption', 'caption_alt')),
  text          text not null default '',
  kind          text not null check (kind in ('typed', 'generated', 'redo', 'restored', 'saved', 'outside', 'backfill')),
  note          text check (note is null or char_length(note) <= 500),
  restored_from bigint,
  actor         text check (actor is null or char_length(actor) <= 120),
  actor_role    text check (actor_role is null or char_length(actor_role) <= 40),
  created_at    timestamptz not null default clock_timestamp()
);
create index if not exists caption_versions_card_idx on public.caption_versions (client, post_id, id);

alter table public.caption_versions enable row level security;
revoke all on table public.caption_versions from public, anon, authenticated, service_role;
grant select on table public.caption_versions to service_role;
do $seq$
declare s text := pg_get_serial_sequence('public.caption_versions', 'id');
begin
  if s is not null then
    execute format('revoke all on sequence %s from public, anon, authenticated, service_role', s);
  end if;
end
$seq$;

-- Append-only: no update, delete or truncate, by anyone the table's owner has not explicitly let through.
create or replace function public.caption_versions_refuse_change()
returns trigger
language plpgsql
set search_path to 'pg_catalog'
as $fn$
begin
  raise exception 'caption_versions is append-only (% refused)', tg_op using errcode = '42501';
end
$fn$;
revoke all on function public.caption_versions_refuse_change() from public, anon, authenticated, service_role;

drop trigger if exists caption_versions_append_only on public.caption_versions;
create trigger caption_versions_append_only
  before update or delete on public.caption_versions
  for each row execute function public.caption_versions_refuse_change();
drop trigger if exists caption_versions_no_truncate on public.caption_versions;
create trigger caption_versions_no_truncate
  before truncate on public.caption_versions
  for each statement execute function public.caption_versions_refuse_change();

create or replace function public.caption_versions_capture()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $fn$
declare
  v_changed text[] := array[]::text[];
  v_field   text;
  v_text    text;
  v_headers jsonb;
  v_origin  jsonb;
  v_raw     text;
  v_kind    text;
  v_note    text;
  v_from    bigint;
  v_actor   text;
  v_role    text;
begin
  -- The calendar's own settings row keeps JSON in its caption column; it is not a caption.
  if new.id = 'p_cal_settings' or coalesce(new.name, '') = '__cal_settings__' then return null; end if;
  if tg_op = 'INSERT' then
    if coalesce(new.caption, '') <> '' then v_changed := v_changed || 'caption'::text; end if;
    if coalesce(new.caption_alt, '') <> '' then v_changed := v_changed || 'caption_alt'::text; end if;
  else
    if new.caption is distinct from old.caption then v_changed := v_changed || 'caption'::text; end if;
    if new.caption_alt is distinct from old.caption_alt then v_changed := v_changed || 'caption_alt'::text; end if;
  end if;
  if cardinality(v_changed) = 0 then return null; end if;

  -- Everything that can fail is in here. A failure is logged and the card save goes on.
  begin
    begin
      v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
    exception when others then
      v_headers := '{}'::jsonb;   -- an API request whose headers could not be read: still an API request
    end;
    if v_headers is null then
      v_kind := 'outside';
    else
      v_raw := v_headers ->> 'x-syncview-caption-origin';
      if v_raw is not null and char_length(v_raw) <= 4000 then
        begin
          v_origin := convert_from(decode(v_raw, 'base64'), 'UTF8')::jsonb;
        exception when others then
          v_origin := null;
        end;
      end if;
      if jsonb_typeof(v_origin) = 'object' then
        v_kind := case when v_origin ->> 'k' in ('typed', 'redo', 'restored', 'generated') then v_origin ->> 'k' else 'saved' end;
        v_note := nullif(left(btrim(coalesce(v_origin ->> 'n', '')), 500), '');
        v_actor := nullif(left(btrim(coalesce(v_origin ->> 'a', '')), 120), '');
        v_role := nullif(left(btrim(coalesce(v_origin ->> 'r', '')), 40), '');
        if v_kind = 'restored' and coalesce(v_origin ->> 'f', '') ~ '^[0-9]{1,18}$' then v_from := (v_origin ->> 'f')::bigint; end if;
        if v_kind <> 'redo' then v_note := null; end if;
      else
        v_kind := 'saved';
      end if;
    end if;

    foreach v_field in array v_changed loop
      v_text := coalesce(case when v_field = 'caption' then new.caption else new.caption_alt end, '');
      if v_kind = 'saved' and v_field = 'caption' and v_text <> '' then
        -- caption-generate saves a first caption through calendar-upsert, which sends no origin: it is the text a
        -- caption job for this card produced in the last hour.
        begin
          if exists (select 1 from public.caption_jobs j
                     where j.client = new.client and j.post_id = new.id and j.caption = v_text
                       and j.updated_at > now() - interval '1 hour') then
            v_kind := 'generated';
          end if;
        exception when others then
          null;   -- no caption_jobs table here: the row stays "saved"
        end;
      end if;
      insert into public.caption_versions (client, post_id, field, text, kind, note, restored_from, actor, actor_role)
      values (new.client, new.id, v_field, v_text, v_kind,
              case when v_field = 'caption' then v_note end, v_from, v_actor, v_role);
    end loop;
  exception when others then
    raise warning 'caption_versions_capture skipped: %', sqlstate;
  end;
  return null;
end
$fn$;
revoke all on function public.caption_versions_capture() from public, anon, authenticated, service_role;

drop trigger if exists zz_caption_versions_capture on public.calendar_posts;
create trigger zz_caption_versions_capture
  after insert or update of caption, caption_alt on public.calendar_posts
  for each row execute function public.caption_versions_capture();

-- Assert: no browser role holds anything on the table, service_role holds exactly SELECT, and no role but the
-- owner may run either function.
do $assert$
declare n int; sr text;
begin
  select count(*) into n
  from pg_class c join pg_namespace s on s.oid = c.relnamespace, aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname = 'caption_versions'
    and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid, 0::oid);
  if n <> 0 then raise exception 'caption_versions: a browser role holds privileges'; end if;
  select string_agg(a.privilege_type, ',' order by a.privilege_type) into sr
  from pg_class c join pg_namespace s on s.oid = c.relnamespace, aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname = 'caption_versions' and a.grantee = 'service_role'::regrole::oid;
  if sr is distinct from 'SELECT' then raise exception 'caption_versions: service_role holds % (expected SELECT)', sr; end if;
  if has_function_privilege('anon', 'public.caption_versions_capture()', 'execute')
     or has_function_privilege('authenticated', 'public.caption_versions_capture()', 'execute')
     or has_function_privilege('service_role', 'public.caption_versions_capture()', 'execute') then
    raise exception 'caption_versions_capture: a role other than the owner may execute it';
  end if;
end
$assert$;

commit;
