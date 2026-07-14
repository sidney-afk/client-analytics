-- Thumbnail revision v2: protected compare reads and server-authoritative
-- cross-viewer refresh tokens.
--
-- Additive schema delta. The feature is seeded OFF. One-step behavior kill:
--   update public.syncview_runtime_flags
--   set value = '{"mode":"off","clients":[]}'::jsonb,
--       updated_at = now(), updated_by = '<operator>'
--   where key = 'thumbnail_revision_v2';
--
-- `mode='test'` permits only normalized slugs in `clients`; `mode='on'`
-- permits all clients. The Edge reader/scanner and these triggers share that
-- contract, so a single flag reversal stops every v2 behavior.

insert into public.syncview_runtime_flags (key, value, updated_by)
values ('thumbnail_revision_v2', '{"mode":"off","clients":[]}'::jsonb, 'migration')
on conflict (key) do nothing;

-- The raw table includes private Storage paths, Drive metadata, requester
-- attribution, and internal errors. Browser reads now go only through the
-- principal- and card-scoped thumbnail-revision-read Edge Function.
revoke select on table public.thumbnail_media_revisions from anon;
revoke select on table public.thumbnail_media_revisions from authenticated;

-- Calendar accepts AVIF thumbnails, so the private evidence bucket must accept
-- the same image family or a valid replacement would fail before thumb_rev can
-- advance for other viewers.
update storage.buckets
set allowed_mime_types = array[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'
]
where id = 'syncview-thumbnail-revisions';

create or replace function public.syncview_base36(p_value bigint)
returns text
language plpgsql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
declare
  alphabet constant text := '0123456789abcdefghijklmnopqrstuvwxyz';
  value bigint := p_value;
  encoded text := '';
begin
  if value = 0 then return '0'; end if;
  if value < 0 then raise exception 'base36 value must be non-negative'; end if;
  while value > 0 loop
    encoded := substr(alphabet, (value % 36)::integer + 1, 1) || encoded;
    value := value / 36;
  end loop;
  return encoded;
end;
$$;

create or replace function public.syncview_thumbnail_revision_v2_enabled(p_client text)
returns boolean
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  config jsonb := '{}'::jsonb;
  mode text := 'off';
  slug text := regexp_replace(lower(coalesce(p_client, '')), '[^a-z0-9&]+', '', 'g');
begin
  select value into config
  from public.syncview_runtime_flags
  where key = 'thumbnail_revision_v2';

  mode := lower(coalesce(config ->> 'mode', 'off'));
  if mode not in ('test', 'on') then return false; end if;
  if not exists (
    select 1 from public.clients
    where slug = p_client and active = true
  ) then
    return false;
  end if;
  if mode = 'on' then return true; end if;
  if slug = '' then return false; end if;

  return exists (
    select 1
    from jsonb_array_elements_text(
      case when jsonb_typeof(config -> 'clients') = 'array'
        then config -> 'clients'
        else '[]'::jsonb
      end
    ) as allowed(client)
    where regexp_replace(lower(allowed.client), '[^a-z0-9&]+', '', 'g') = slug
  );
end;
$$;

create or replace function public.syncview_thumbnail_drive_file_id(p_url text)
returns text
language plpgsql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
declare
  matched text[];
  value text := btrim(p_url);
begin
  if value = '' then return null; end if;
  if value ~ '^[A-Za-z0-9_-]{20,}$' then return value; end if;
  if value !~* '^(https?://)?([A-Za-z0-9-]+\.)*(drive|docs)\.google\.com/' then
    return null;
  end if;
  if value ~* 'drive\.google\.com/(drive/)?(u/[0-9]+/)?folders/'
    or value ~* 'drive\.google\.com/folderview\?'
  then
    return null;
  end if;

  matched := regexp_match(value, '(?i)/file/d/([A-Za-z0-9_-]+)');
  if matched is not null then return matched[1]; end if;
  matched := regexp_match(value, '(?i)/(document|spreadsheets|presentation|drawings|forms)/d/([A-Za-z0-9_-]+)');
  if matched is not null then return matched[2]; end if;
  matched := regexp_match(value, '(?i)[?&]id=([A-Za-z0-9_-]{20,})');
  if matched is not null then return matched[1]; end if;
  return null;
end;
$$;

create or replace function public.syncview_thumbnail_thumb_rev_before_write()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  token text;
  now_ts timestamptz := clock_timestamp();
  parsed_ts timestamptz;
  old_status text := '';
  new_status text := '';
  source_surface text;
  drive_file_id text;
  should_mint boolean := false;
begin
  if not public.syncview_thumbnail_revision_v2_enabled(new.client) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    should_mint := nullif(btrim(coalesce(new.thumbnail_url, '')), '') is not null
      or nullif(btrim(coalesce(new.asset_url, '')), '') is not null;
  elsif tg_argv[0] = 'media' then
    -- UPDATE OF fires even when a same-link assignment retains the same value.
    -- That distinction is deliberate: it is how non-browser callers signal an
    -- in-place Drive replacement without inventing a new URL.
    should_mint := true;
  elsif tg_argv[0] = 'status' then
    old_status := regexp_replace(lower(btrim(coalesce(old.graphic_status, ''))), '[_ -]+', ' ', 'g');
    new_status := regexp_replace(lower(btrim(coalesce(new.graphic_status, ''))), '[_ -]+', ' ', 'g');
    should_mint := old_status = 'tweaks needed' and new_status <> 'tweaks needed';
  end if;

  -- Every enabled write path leaves behind a lightweight pending watcher for
  -- a single Drive thumbnail. On A -> B link changes the existing A watcher is
  -- deliberately preserved so the scanner can archive A as Previous.
  drive_file_id := public.syncview_thumbnail_drive_file_id(new.thumbnail_url);
  if drive_file_id is not null then
    source_surface := case tg_table_name
      when 'calendar_posts' then 'calendar'
      when 'sample_reviews' then 'samples'
      else null
    end;
    if source_surface is not null then
      insert into public.thumbnail_media_revisions (
        surface, client, source_id, component, status, reason,
        thumbnail_url, drive_file_id, requested_at, requested_by,
        request_role
      ) values (
        source_surface, new.client, new.id, 'graphic', 'pending',
        'continuous_watch', new.thumbnail_url, drive_file_id, now_ts,
        'database-trigger', 'system'
      )
      on conflict (surface, client, source_id, reason)
        where status = 'pending'
      do nothing;
    end if;
  end if;

  if should_mint then
    -- Source updated_at is text on both tables. Choose a value strictly newer
    -- than the stored row and no older than either the server clock or a valid
    -- newer caller timestamp. Open viewers use this ordering to decide whether
    -- to adopt the persisted thumb_rev, so timestamp regression would recreate
    -- the hard-refresh-only failure.
    if tg_op = 'UPDATE' then
      begin
        parsed_ts := old.updated_at::timestamptz;
        now_ts := greatest(now_ts, parsed_ts + interval '1 millisecond');
      exception when others then
        parsed_ts := null;
      end;
    end if;
    if new.updated_at is not null then
      begin
        parsed_ts := new.updated_at::timestamptz;
        now_ts := greatest(now_ts, parsed_ts);
      exception when others then
        parsed_ts := null;
      end;
    end if;
    new.updated_at := to_char(
      now_ts at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    );
    token := public.syncview_base36(floor(extract(epoch from now_ts) * 1000)::bigint);
    if tg_op = 'UPDATE' then
      if token = coalesce(old.thumb_rev, '') then
        token := public.syncview_base36(floor(extract(epoch from now_ts) * 1000)::bigint + 1);
      end if;
    end if;
    new.thumb_rev := token;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'calendar_thumbnail_revision_v2_insert'
      and tgrelid = 'public.calendar_posts'::regclass
      and not tgisinternal
  ) then
    create trigger calendar_thumbnail_revision_v2_insert
      before insert on public.calendar_posts
      for each row execute function public.syncview_thumbnail_thumb_rev_before_write('insert');
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'calendar_thumbnail_revision_v2_media'
      and tgrelid = 'public.calendar_posts'::regclass
      and not tgisinternal
  ) then
    create trigger calendar_thumbnail_revision_v2_media
      before update of thumbnail_url, asset_url on public.calendar_posts
      for each row execute function public.syncview_thumbnail_thumb_rev_before_write('media');
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'calendar_thumbnail_revision_v2_status'
      and tgrelid = 'public.calendar_posts'::regclass
      and not tgisinternal
  ) then
    create trigger calendar_thumbnail_revision_v2_status
      before update of graphic_status on public.calendar_posts
      for each row execute function public.syncview_thumbnail_thumb_rev_before_write('status');
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'samples_thumbnail_revision_v2_insert'
      and tgrelid = 'public.sample_reviews'::regclass
      and not tgisinternal
  ) then
    create trigger samples_thumbnail_revision_v2_insert
      before insert on public.sample_reviews
      for each row execute function public.syncview_thumbnail_thumb_rev_before_write('insert');
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'samples_thumbnail_revision_v2_media'
      and tgrelid = 'public.sample_reviews'::regclass
      and not tgisinternal
  ) then
    create trigger samples_thumbnail_revision_v2_media
      before update of thumbnail_url, asset_url on public.sample_reviews
      for each row execute function public.syncview_thumbnail_thumb_rev_before_write('media');
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'samples_thumbnail_revision_v2_status'
      and tgrelid = 'public.sample_reviews'::regclass
      and not tgisinternal
  ) then
    create trigger samples_thumbnail_revision_v2_status
      before update of graphic_status on public.sample_reviews
      for each row execute function public.syncview_thumbnail_thumb_rev_before_write('status');
  end if;
end;
$$;

-- Seed lightweight watchers for every currently active single-file Drive
-- thumbnail. Snapshot bytes are captured lazily by the bounded scanner.
with source_thumbnails as (
  select 'calendar'::text as surface, p.client, p.id as source_id,
         p.thumbnail_url,
         public.syncview_thumbnail_drive_file_id(p.thumbnail_url) as drive_file_id
  from public.calendar_posts p
  join public.clients c on c.slug = p.client and c.active = true
  where lower(btrim(coalesce(p.status, ''))) <> 'archived'
  union all
  select 'samples'::text as surface, p.client, p.id as source_id,
         p.thumbnail_url,
         public.syncview_thumbnail_drive_file_id(p.thumbnail_url) as drive_file_id
  from public.sample_reviews p
  join public.clients c on c.slug = p.client and c.active = true
  where lower(btrim(coalesce(p.status, ''))) <> 'archived'
)
insert into public.thumbnail_media_revisions (
  surface, client, source_id, component, status, reason,
  thumbnail_url, drive_file_id, requested_by, request_role
)
select surface, client, source_id, 'graphic', 'pending',
       'continuous_watch', thumbnail_url, drive_file_id,
       'migration-backfill', 'system'
from source_thumbnails
where drive_file_id is not null
on conflict (surface, client, source_id, reason)
  where status = 'pending'
do nothing;

create or replace function public.syncview_thumbnail_revision_backfill(
  p_surface text default null,
  p_client text default null,
  p_source_id text default null,
  p_limit integer default 25
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  inserted_count integer := 0;
  bounded_limit integer := least(greatest(coalesce(p_limit, 25), 1), 50);
  flag_mode text := 'off';
begin
  select lower(coalesce(value ->> 'mode', 'off')) into flag_mode
  from public.syncview_runtime_flags
  where key = 'thumbnail_revision_v2';
  if flag_mode not in ('test', 'on') then return 0; end if;
  -- TEST scans must be explicitly client-scoped. This prevents a one-card
  -- rollout drill from silently enrolling every allowlisted client.
  if flag_mode = 'test' and nullif(btrim(coalesce(p_client, '')), '') is null then
    return 0;
  end if;

  with source_thumbnails as (
    select 'calendar'::text as surface, p.client, p.id as source_id,
           p.thumbnail_url,
           public.syncview_thumbnail_drive_file_id(p.thumbnail_url) as drive_file_id
    from public.calendar_posts p
    join public.clients c on c.slug = p.client and c.active = true
    where (p_surface is null or p_surface = '' or p_surface = 'calendar')
      and lower(btrim(coalesce(p.status, ''))) <> 'archived'
    union all
    select 'samples'::text as surface, p.client, p.id as source_id,
           p.thumbnail_url,
           public.syncview_thumbnail_drive_file_id(p.thumbnail_url) as drive_file_id
    from public.sample_reviews p
    join public.clients c on c.slug = p.client and c.active = true
    where (p_surface is null or p_surface = '' or p_surface = 'samples')
      and lower(btrim(coalesce(p.status, ''))) <> 'archived'
  ), candidates as (
    select s.*
    from source_thumbnails s
    where s.drive_file_id is not null
      and public.syncview_thumbnail_revision_v2_enabled(s.client)
      and (
        p_client is null or p_client = '' or
        regexp_replace(lower(s.client), '[^a-z0-9&]+', '', 'g') =
          regexp_replace(lower(p_client), '[^a-z0-9&]+', '', 'g')
      )
      and (p_source_id is null or p_source_id = '' or s.source_id = p_source_id)
      and not exists (
        select 1
        from public.thumbnail_media_revisions r
        where r.surface = s.surface
          and r.client = s.client
          and r.source_id = s.source_id
          and r.reason = 'continuous_watch'
          and r.status = 'pending'
      )
    order by s.surface, s.client, s.source_id
    limit bounded_limit
  )
  insert into public.thumbnail_media_revisions (
    surface, client, source_id, component, status, reason,
    thumbnail_url, drive_file_id, requested_by, request_role
  )
  select surface, client, source_id, 'graphic', 'pending',
         'continuous_watch', thumbnail_url, drive_file_id,
         'scheduled-backfill', 'system'
  from candidates
  on conflict (surface, client, source_id, reason)
    where status = 'pending'
  do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.syncview_thumbnail_revision_rotate(
  p_watch_id uuid,
  p_surface text,
  p_client text,
  p_source_id text,
  p_expected_thumbnail_url text,
  p_expected_drive_file_id text,
  p_latest_file_name text,
  p_latest_mime_type text,
  p_latest_revision_id text,
  p_latest_md5 text,
  p_latest_modified_time timestamptz,
  p_latest_storage_path text,
  p_latest_bytes integer
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  watch_row public.thumbnail_media_revisions%rowtype;
  current_url text;
  current_thumb_rev text;
  current_status text;
  current_updated_at text;
  now_ts timestamptz;
  now_text text;
  token text;
  current_file_id text;
begin
  if p_surface is null or p_surface not in ('calendar', 'samples')
    or nullif(btrim(coalesce(p_client, '')), '') is null
    or nullif(btrim(coalesce(p_source_id, '')), '') is null
    or nullif(btrim(coalesce(p_latest_storage_path, '')), '') is null
  then
    return null;
  end if;
  if not public.syncview_thumbnail_revision_v2_enabled(p_client) then
    return null;
  end if;

  -- Lock the source first. clock_timestamp() is intentionally taken only
  -- after this lock, so a concurrent user write can never be followed by an
  -- older updated_at value from the scanner.
  if p_surface = 'calendar' then
    select thumbnail_url, thumb_rev, status, updated_at
      into current_url, current_thumb_rev, current_status, current_updated_at
    from public.calendar_posts
    where client = p_client and id = p_source_id
    for update;
  else
    select thumbnail_url, thumb_rev, status, updated_at
      into current_url, current_thumb_rev, current_status, current_updated_at
    from public.sample_reviews
    where client = p_client and id = p_source_id
    for update;
  end if;
  if not found then return null; end if;
  if lower(btrim(coalesce(current_status, ''))) = 'archived' then return null; end if;

  current_file_id := public.syncview_thumbnail_drive_file_id(current_url);
  if btrim(coalesce(current_url, '')) <> btrim(coalesce(p_expected_thumbnail_url, ''))
    or coalesce(current_file_id, '') <> coalesce(p_expected_drive_file_id, '')
  then
    return null;
  end if;

  select * into watch_row
  from public.thumbnail_media_revisions
  where id = p_watch_id
    and surface = p_surface
    and client = p_client
    and source_id = p_source_id
    and reason = 'continuous_watch'
    and status = 'pending'
  for update;
  if not found or watch_row.baseline_storage_path is null then return null; end if;

  now_ts := clock_timestamp();
  begin
    now_ts := greatest(now_ts, current_updated_at::timestamptz + interval '1 millisecond');
  exception when others then
    -- Invalid legacy text cannot be trusted for ordering; server time remains
    -- authoritative and is normalized below.
  end;
  now_text := to_char(now_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  token := public.syncview_base36(floor(extract(epoch from now_ts) * 1000)::bigint);
  if token = coalesce(current_thumb_rev, '') then
    token := public.syncview_base36(floor(extract(epoch from now_ts) * 1000)::bigint + 1);
  end if;

  update public.thumbnail_media_revisions
  set status = 'changed',
      latest_revision_id = nullif(btrim(coalesce(p_latest_revision_id, '')), ''),
      latest_md5 = nullif(btrim(coalesce(p_latest_md5, '')), ''),
      latest_modified_time = p_latest_modified_time,
      latest_storage_path = p_latest_storage_path,
      latest_bytes = p_latest_bytes,
      changed_at = coalesce(p_latest_modified_time, now_ts),
      detected_at = now_ts,
      last_checked_at = now_ts,
      error = null,
      updated_at = now_ts
  where id = watch_row.id;

  -- A Tweaks Needed cycle may have captured its own baseline. Close that cycle
  -- to the same verified Current without creating a second source bump.
  update public.thumbnail_media_revisions
  set status = 'changed',
      latest_revision_id = nullif(btrim(coalesce(p_latest_revision_id, '')), ''),
      latest_md5 = nullif(btrim(coalesce(p_latest_md5, '')), ''),
      latest_modified_time = p_latest_modified_time,
      latest_storage_path = p_latest_storage_path,
      latest_bytes = p_latest_bytes,
      changed_at = coalesce(p_latest_modified_time, now_ts),
      detected_at = now_ts,
      last_checked_at = now_ts,
      error = null,
      updated_at = now_ts
  where surface = p_surface
    and client = p_client
    and source_id = p_source_id
    and reason = 'graphic_tweaks_needed'
    and status = 'pending'
    and baseline_storage_path is not null;

  if p_surface = 'calendar' then
    update public.calendar_posts
    set thumb_rev = token, updated_at = now_text
    where client = p_client and id = p_source_id
      and btrim(coalesce(thumbnail_url, '')) = btrim(p_expected_thumbnail_url)
      and public.syncview_thumbnail_drive_file_id(thumbnail_url) = p_expected_drive_file_id;
  else
    update public.sample_reviews
    set thumb_rev = token, updated_at = now_text
    where client = p_client and id = p_source_id
      and btrim(coalesce(thumbnail_url, '')) = btrim(p_expected_thumbnail_url)
      and public.syncview_thumbnail_drive_file_id(thumbnail_url) = p_expected_drive_file_id;
  end if;
  if not found then raise exception 'thumbnail source CAS failed'; end if;

  insert into public.thumbnail_media_revisions (
    surface, client, source_id, component, status, reason,
    thumbnail_url, drive_file_id, drive_file_name, drive_mime_type,
    baseline_revision_id, baseline_md5, baseline_modified_time,
    baseline_storage_path, baseline_bytes, requested_at, requested_by,
    request_role, last_checked_at
  ) values (
    p_surface, p_client, p_source_id, 'graphic', 'pending',
    'continuous_watch', p_expected_thumbnail_url, p_expected_drive_file_id,
    nullif(btrim(coalesce(p_latest_file_name, '')), ''),
    nullif(btrim(coalesce(p_latest_mime_type, '')), ''),
    nullif(btrim(coalesce(p_latest_revision_id, '')), ''),
    nullif(btrim(coalesce(p_latest_md5, '')), ''),
    p_latest_modified_time, p_latest_storage_path, p_latest_bytes,
    now_ts, 'continuous-scanner', 'system', now_ts
  );

  return token;
end;
$$;

revoke all on function public.syncview_thumbnail_revision_backfill(text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.syncview_thumbnail_revision_backfill(text, text, text, integer)
  to service_role;
revoke all on function public.syncview_thumbnail_revision_rotate(
  uuid, text, text, text, text, text, text, text, text, text, timestamptz, text, integer
) from public, anon, authenticated;
grant execute on function public.syncview_thumbnail_revision_rotate(
  uuid, text, text, text, text, text, text, text, text, text, timestamptz, text, integer
) to service_role;

comment on function public.syncview_thumbnail_revision_v2_enabled(text) is
  'Returns true only for an active client when thumbnail_revision_v2 is on or that client is enrolled in test mode.';
comment on function public.syncview_thumbnail_thumb_rev_before_write() is
  'Mints epoch-millisecond base36 thumb_rev tokens for enrolled Calendar/Samples media writes and graphic tweak resolution.';
comment on function public.syncview_thumbnail_revision_backfill(text, text, text, integer) is
  'Boundedly enrolls active single-file Drive thumbnails into continuous revision watching.';
comment on function public.syncview_thumbnail_revision_rotate(uuid, text, text, text, text, text, text, text, text, text, timestamptz, text, integer) is
  'Atomically verifies source media, closes Previous-to-Current history, bumps thumb_rev, and rotates the continuous baseline.';
