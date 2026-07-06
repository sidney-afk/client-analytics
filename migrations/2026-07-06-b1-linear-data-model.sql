-- Track B B1: production data model for Linear replacement.
-- Additive-only. This creates empty tables/columns only; Linear backfill rows are gated.

create extension if not exists pgcrypto;

create table if not exists public.batches (
  id text primary key,
  client_slug text not null references public.clients(slug),
  team text check (team in ('video','graphics')),
  name text not null,
  description text,
  filming_doc_url text,
  footage_folder_url text,
  delivery_folder_url text,
  color text,
  status text not null default 'active' check (status in ('active','done','archived')),
  comments text,
  sort_key numeric,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  linear_parent_ids jsonb
);

create index if not exists batches_client_status_idx
  on public.batches (client_slug, status);
create index if not exists batches_team_status_idx
  on public.batches (team, status);

create table if not exists public.deliverables (
  id text primary key,
  identifier text unique,
  batch_id text not null references public.batches(id),
  client_slug text not null references public.clients(slug),
  team text not null check (team in ('video','graphics')),
  kind text not null check (kind in ('video','thumbnail','other')),
  title text not null,
  brief text,
  status text not null default 'in_progress' check (status in
    ('triage','backlog','todo','in_progress','smm_approval','kasper_approval',
     'client_approval','tweak','approved','scheduled','posted','canceled','duplicate')),
  status_at timestamptz,
  assignee_id uuid references public.team_members(id),
  due_date date,
  priority smallint,
  file_url text,
  comments text,
  origin text not null default 'manual' check (origin in ('calendar','samples','manual')),
  card_id text,
  sort_key numeric,
  sync_state text not null default 'clean' check (sync_state in ('clean','pending','error')),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  linear_issue_uuid text,
  linear_identifier text,
  linear_issue_url text,
  linear_aliases jsonb,
  linear_raw jsonb
);

create index if not exists deliverables_client_status_idx
  on public.deliverables (client_slug, status);
create index if not exists deliverables_assignee_due_idx
  on public.deliverables (assignee_id, due_date);
create index if not exists deliverables_batch_idx
  on public.deliverables (batch_id);
create index if not exists deliverables_team_status_idx
  on public.deliverables (team, status);
create index if not exists deliverables_card_lookup_idx
  on public.deliverables (client_slug, origin, card_id, kind)
  where card_id is not null;

create unique index if not exists deliverables_linear_uuid_live
  on public.deliverables (linear_issue_uuid)
  where linear_issue_uuid is not null;

comment on column public.deliverables.linear_issue_uuid is
  'Canonical Linear issue id/UUID join key for Track B; this is the spec linear_issue_id equivalent.';

-- Two-slot card linkage: resolve via client_slug + origin + card_id + kind.
-- A single deliverable_id is intentionally insufficient because cards have video + graphic slots.
create unique index if not exists deliverables_card_slot_unique
  on public.deliverables (client_slug, origin, card_id, kind)
  where card_id is not null and origin in ('calendar','samples');

create table if not exists public.deliverable_events (
  id bigint generated always as identity primary key,
  deliverable_id text,
  batch_id text,
  client_slug text not null,
  ts timestamptz not null default now(),
  actor text,
  role text,
  action text not null,
  from_status text,
  to_status text,
  source text not null default 'ui' check (source in ('ui','mirror','reconcile','backfill','system')),
  payload jsonb
);

create index if not exists deliverable_events_deliverable_ts_idx
  on public.deliverable_events (deliverable_id, ts desc);
create index if not exists deliverable_events_client_ts_idx
  on public.deliverable_events (client_slug, ts desc);
create index if not exists deliverable_events_source_ts_idx
  on public.deliverable_events (source, ts desc);
create index if not exists deliverable_events_batch_ts_idx
  on public.deliverable_events (batch_id, ts desc);

create table if not exists public.mirror_outbox (
  id bigint generated always as identity primary key,
  deliverable_id text not null,
  op text not null check (op in ('create','update_state','update_fields','comment','archive')),
  payload jsonb not null,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  next_retry_at timestamptz
);

create index if not exists mirror_outbox_next_retry_idx
  on public.mirror_outbox (next_retry_at, created_at);
create index if not exists mirror_outbox_deliverable_idx
  on public.mirror_outbox (deliverable_id);

create table if not exists public.linear_archive (
  linear_uuid text primary key,
  identifier text,
  aliases jsonb,
  team text,
  client_slug text,
  parent_uuid text,
  parent_identifier text,
  title text,
  state text,
  assignee_name text,
  assignee_email text,
  due_date date,
  priority smallint,
  created_at timestamptz,
  completed_at timestamptz,
  archived_at timestamptz,
  comments jsonb,
  raw jsonb
);

create index if not exists linear_archive_client_idx
  on public.linear_archive (client_slug);
create index if not exists linear_archive_identifier_idx
  on public.linear_archive (identifier);

alter table public.calendar_posts
  add column if not exists video_deliverable_id text,
  add column if not exists graphic_deliverable_id text;

alter table public.sample_reviews
  add column if not exists video_deliverable_id text,
  add column if not exists graphic_deliverable_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'calendar_posts_video_deliverable_id_fkey'
      and conrelid = 'public.calendar_posts'::regclass
  ) then
    alter table public.calendar_posts
      add constraint calendar_posts_video_deliverable_id_fkey
      foreign key (video_deliverable_id) references public.deliverables(id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'calendar_posts_graphic_deliverable_id_fkey'
      and conrelid = 'public.calendar_posts'::regclass
  ) then
    alter table public.calendar_posts
      add constraint calendar_posts_graphic_deliverable_id_fkey
      foreign key (graphic_deliverable_id) references public.deliverables(id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'sample_reviews_video_deliverable_id_fkey'
      and conrelid = 'public.sample_reviews'::regclass
  ) then
    alter table public.sample_reviews
      add constraint sample_reviews_video_deliverable_id_fkey
      foreign key (video_deliverable_id) references public.deliverables(id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'sample_reviews_graphic_deliverable_id_fkey'
      and conrelid = 'public.sample_reviews'::regclass
  ) then
    alter table public.sample_reviews
      add constraint sample_reviews_graphic_deliverable_id_fkey
      foreign key (graphic_deliverable_id) references public.deliverables(id);
  end if;
end $$;

create or replace function public.track_b_batch_touch_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists track_b_batch_touch_updated_at_before on public.batches;
create trigger track_b_batch_touch_updated_at_before
  before insert or update on public.batches
  for each row execute function public.track_b_batch_touch_updated_at();

create or replace function public.track_b_deliverable_touch_timestamps()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' and new.status_at is null then
    new.status_at := now();
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.status_at := now();
  end if;
  return new;
end;
$fn$;

drop trigger if exists track_b_deliverable_touch_timestamps_before on public.deliverables;
create trigger track_b_deliverable_touch_timestamps_before
  before insert or update on public.deliverables
  for each row execute function public.track_b_deliverable_touch_timestamps();

create or replace function public.track_b_deliverable_ledger_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if current_setting('app.event_written', true) = '1' then
    return null;
  end if;

  insert into public.deliverable_events (
    deliverable_id,
    batch_id,
    client_slug,
    actor,
    role,
    action,
    from_status,
    to_status,
    source,
    payload
  )
  values (
    new.id,
    new.batch_id,
    new.client_slug,
    null,
    null,
    case
      when tg_op = 'INSERT' then 'create'
      when new.status is distinct from old.status then 'status_change'
      else 'update'
    end,
    case when tg_op = 'UPDATE' then old.status else null end,
    case
      when tg_op = 'INSERT' then new.status
      when new.status is distinct from old.status then new.status
      else null
    end,
    'system',
    jsonb_build_object('op', tg_op, 'reason', 'rpc_bypass_guard')
  );

  return null;
end;
$fn$;

drop trigger if exists track_b_deliverable_ledger_guard_after on public.deliverables;
create trigger track_b_deliverable_ledger_guard_after
  after insert or update on public.deliverables
  for each row execute function public.track_b_deliverable_ledger_guard();

create or replace function public.track_b_batch_ledger_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if current_setting('app.event_written', true) = '1' then
    return null;
  end if;

  insert into public.deliverable_events (
    deliverable_id,
    batch_id,
    client_slug,
    actor,
    role,
    action,
    from_status,
    to_status,
    source,
    payload
  )
  values (
    null,
    new.id,
    new.client_slug,
    null,
    null,
    case
      when tg_op = 'INSERT' then 'batch_create'
      when new.status is distinct from old.status then 'batch_status_change'
      else 'batch_change'
    end,
    case when tg_op = 'UPDATE' then old.status else null end,
    case
      when tg_op = 'INSERT' then new.status
      when new.status is distinct from old.status then new.status
      else null
    end,
    'system',
    jsonb_build_object('op', tg_op, 'reason', 'rpc_bypass_guard')
  );

  return null;
end;
$fn$;

drop trigger if exists track_b_batch_ledger_guard_after on public.batches;
create trigger track_b_batch_ledger_guard_after
  after insert or update on public.batches
  for each row execute function public.track_b_batch_ledger_guard();

create or replace function public.batch_write(p_row jsonb, p_event jsonb default '{}'::jsonb)
returns public.batches
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row jsonb := coalesce(p_row, '{}'::jsonb);
  v_event jsonb := coalesce(p_event, '{}'::jsonb);
  v_id text := nullif(v_row->>'id', '');
  v_old_status text;
  v_result public.batches%rowtype;
  v_action text;
begin
  if v_id is null then
    v_id := 'bat_' || replace(gen_random_uuid()::text, '-', '');
  end if;

  select b.status into v_old_status
    from public.batches b
   where b.id = v_id
   for update;

  perform set_config('app.event_written', '1', true);

  insert into public.batches as b (
    id,
    client_slug,
    team,
    name,
    description,
    filming_doc_url,
    footage_folder_url,
    delivery_folder_url,
    color,
    status,
    comments,
    sort_key,
    created_by,
    created_at,
    updated_at,
    linear_parent_ids
  )
  values (
    v_id,
    nullif(v_row->>'client_slug', ''),
    nullif(v_row->>'team', ''),
    coalesce(nullif(v_row->>'name', ''), 'Untitled batch'),
    nullif(v_row->>'description', ''),
    nullif(v_row->>'filming_doc_url', ''),
    nullif(v_row->>'footage_folder_url', ''),
    nullif(v_row->>'delivery_folder_url', ''),
    nullif(v_row->>'color', ''),
    coalesce(nullif(v_row->>'status', ''), 'active'),
    nullif(v_row->>'comments', ''),
    nullif(v_row->>'sort_key', '')::numeric,
    nullif(v_row->>'created_by', ''),
    coalesce(nullif(v_row->>'created_at', '')::timestamptz, now()),
    now(),
    nullif(v_row->'linear_parent_ids', 'null'::jsonb)
  )
  on conflict (id) do update set
    client_slug = case when v_row ? 'client_slug' then excluded.client_slug else b.client_slug end,
    team = case when v_row ? 'team' then excluded.team else b.team end,
    name = case when v_row ? 'name' then excluded.name else b.name end,
    description = case when v_row ? 'description' then excluded.description else b.description end,
    filming_doc_url = case when v_row ? 'filming_doc_url' then excluded.filming_doc_url else b.filming_doc_url end,
    footage_folder_url = case when v_row ? 'footage_folder_url' then excluded.footage_folder_url else b.footage_folder_url end,
    delivery_folder_url = case when v_row ? 'delivery_folder_url' then excluded.delivery_folder_url else b.delivery_folder_url end,
    color = case when v_row ? 'color' then excluded.color else b.color end,
    status = case when v_row ? 'status' then excluded.status else b.status end,
    comments = case when v_row ? 'comments' then excluded.comments else b.comments end,
    sort_key = case when v_row ? 'sort_key' then excluded.sort_key else b.sort_key end,
    created_by = case when v_row ? 'created_by' then excluded.created_by else b.created_by end,
    created_at = case when v_row ? 'created_at' then excluded.created_at else b.created_at end,
    updated_at = now(),
    linear_parent_ids = case when v_row ? 'linear_parent_ids' then excluded.linear_parent_ids else b.linear_parent_ids end
  returning * into v_result;

  v_action := coalesce(
    nullif(v_event->>'action', ''),
    case
      when v_old_status is null then 'batch_create'
      when v_old_status is distinct from v_result.status then 'batch_status_change'
      else 'batch_change'
    end
  );

  insert into public.deliverable_events (
    deliverable_id,
    batch_id,
    client_slug,
    ts,
    actor,
    role,
    action,
    from_status,
    to_status,
    source,
    payload
  )
  values (
    null,
    v_result.id,
    v_result.client_slug,
    coalesce(nullif(v_event->>'ts', '')::timestamptz, now()),
    nullif(v_event->>'actor', ''),
    nullif(v_event->>'role', ''),
    v_action,
    coalesce(nullif(v_event->>'from_status', ''), v_old_status),
    coalesce(nullif(v_event->>'to_status', ''), case when v_old_status is distinct from v_result.status then v_result.status else null end),
    coalesce(nullif(v_event->>'source', ''), 'ui'),
    v_event
  );

  return v_result;
end;
$fn$;

create or replace function public.deliverable_write(p_row jsonb, p_event jsonb default '{}'::jsonb)
returns public.deliverables
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row jsonb := coalesce(p_row, '{}'::jsonb);
  v_event jsonb := coalesce(p_event, '{}'::jsonb);
  v_id text := nullif(v_row->>'id', '');
  v_old_status text;
  v_result public.deliverables%rowtype;
  v_action text;
begin
  if v_id is null then
    v_id := 'del_' || replace(gen_random_uuid()::text, '-', '');
  end if;

  select d.status into v_old_status
    from public.deliverables d
   where d.id = v_id
   for update;

  perform set_config('app.event_written', '1', true);

  insert into public.deliverables as d (
    id,
    identifier,
    batch_id,
    client_slug,
    team,
    kind,
    title,
    brief,
    status,
    status_at,
    assignee_id,
    due_date,
    priority,
    file_url,
    comments,
    origin,
    card_id,
    sort_key,
    sync_state,
    created_by,
    created_at,
    updated_at,
    linear_issue_uuid,
    linear_identifier,
    linear_issue_url,
    linear_aliases,
    linear_raw
  )
  values (
    v_id,
    nullif(v_row->>'identifier', ''),
    nullif(v_row->>'batch_id', ''),
    nullif(v_row->>'client_slug', ''),
    nullif(v_row->>'team', ''),
    coalesce(nullif(v_row->>'kind', ''), 'video'),
    coalesce(nullif(v_row->>'title', ''), 'Untitled deliverable'),
    nullif(v_row->>'brief', ''),
    coalesce(nullif(v_row->>'status', ''), 'in_progress'),
    nullif(v_row->>'status_at', '')::timestamptz,
    nullif(v_row->>'assignee_id', '')::uuid,
    nullif(v_row->>'due_date', '')::date,
    nullif(v_row->>'priority', '')::smallint,
    nullif(v_row->>'file_url', ''),
    nullif(v_row->>'comments', ''),
    coalesce(nullif(v_row->>'origin', ''), 'manual'),
    nullif(v_row->>'card_id', ''),
    nullif(v_row->>'sort_key', '')::numeric,
    coalesce(nullif(v_row->>'sync_state', ''), 'clean'),
    nullif(v_row->>'created_by', ''),
    coalesce(nullif(v_row->>'created_at', '')::timestamptz, now()),
    now(),
    nullif(v_row->>'linear_issue_uuid', ''),
    nullif(v_row->>'linear_identifier', ''),
    nullif(v_row->>'linear_issue_url', ''),
    nullif(v_row->'linear_aliases', 'null'::jsonb),
    nullif(v_row->'linear_raw', 'null'::jsonb)
  )
  on conflict (id) do update set
    identifier = case when v_row ? 'identifier' then excluded.identifier else d.identifier end,
    batch_id = case when v_row ? 'batch_id' then excluded.batch_id else d.batch_id end,
    client_slug = case when v_row ? 'client_slug' then excluded.client_slug else d.client_slug end,
    team = case when v_row ? 'team' then excluded.team else d.team end,
    kind = case when v_row ? 'kind' then excluded.kind else d.kind end,
    title = case when v_row ? 'title' then excluded.title else d.title end,
    brief = case when v_row ? 'brief' then excluded.brief else d.brief end,
    status = case when v_row ? 'status' then excluded.status else d.status end,
    status_at = case when v_row ? 'status_at' then excluded.status_at else d.status_at end,
    assignee_id = case when v_row ? 'assignee_id' then excluded.assignee_id else d.assignee_id end,
    due_date = case when v_row ? 'due_date' then excluded.due_date else d.due_date end,
    priority = case when v_row ? 'priority' then excluded.priority else d.priority end,
    file_url = case when v_row ? 'file_url' then excluded.file_url else d.file_url end,
    comments = case when v_row ? 'comments' then excluded.comments else d.comments end,
    origin = case when v_row ? 'origin' then excluded.origin else d.origin end,
    card_id = case when v_row ? 'card_id' then excluded.card_id else d.card_id end,
    sort_key = case when v_row ? 'sort_key' then excluded.sort_key else d.sort_key end,
    sync_state = case when v_row ? 'sync_state' then excluded.sync_state else d.sync_state end,
    created_by = case when v_row ? 'created_by' then excluded.created_by else d.created_by end,
    created_at = case when v_row ? 'created_at' then excluded.created_at else d.created_at end,
    updated_at = now(),
    linear_issue_uuid = case when v_row ? 'linear_issue_uuid' then excluded.linear_issue_uuid else d.linear_issue_uuid end,
    linear_identifier = case when v_row ? 'linear_identifier' then excluded.linear_identifier else d.linear_identifier end,
    linear_issue_url = case when v_row ? 'linear_issue_url' then excluded.linear_issue_url else d.linear_issue_url end,
    linear_aliases = case when v_row ? 'linear_aliases' then excluded.linear_aliases else d.linear_aliases end,
    linear_raw = case when v_row ? 'linear_raw' then excluded.linear_raw else d.linear_raw end
  returning * into v_result;

  v_action := coalesce(
    nullif(v_event->>'action', ''),
    case
      when v_old_status is null then 'create'
      when v_old_status is distinct from v_result.status then 'status_change'
      else 'update'
    end
  );

  insert into public.deliverable_events (
    deliverable_id,
    batch_id,
    client_slug,
    ts,
    actor,
    role,
    action,
    from_status,
    to_status,
    source,
    payload
  )
  values (
    v_result.id,
    v_result.batch_id,
    v_result.client_slug,
    coalesce(nullif(v_event->>'ts', '')::timestamptz, now()),
    nullif(v_event->>'actor', ''),
    nullif(v_event->>'role', ''),
    v_action,
    coalesce(nullif(v_event->>'from_status', ''), v_old_status),
    coalesce(nullif(v_event->>'to_status', ''), case when v_old_status is distinct from v_result.status then v_result.status else null end),
    coalesce(nullif(v_event->>'source', ''), 'ui'),
    v_event
  );

  return v_result;
end;
$fn$;

create or replace function public.deliverable_merge_comments(
  p_id text,
  p_comments text default null,
  p_base text default ''
) returns setof public.deliverables
language plpgsql
security invoker
set search_path = public
as $fn$
begin
  return query
  update public.deliverables d set
    comments = case
      when p_comments is not null then public._calmerge_comment_cell(d.comments, p_comments, coalesce(p_base, ''))
      else d.comments
    end,
    updated_at = now()
  where d.id = p_id
  returning d.*;
end;
$fn$;

create or replace function public.batch_merge_comments(
  p_id text,
  p_comments text default null,
  p_base text default ''
) returns setof public.batches
language plpgsql
security invoker
set search_path = public
as $fn$
begin
  return query
  update public.batches b set
    comments = case
      when p_comments is not null then public._calmerge_comment_cell(b.comments, p_comments, coalesce(p_base, ''))
      else b.comments
    end,
    updated_at = now()
  where b.id = p_id
  returning b.*;
end;
$fn$;

alter table public.batches enable row level security;
alter table public.deliverables enable row level security;
alter table public.deliverable_events enable row level security;
alter table public.mirror_outbox enable row level security;
alter table public.linear_archive enable row level security;

drop policy if exists "anon read batches" on public.batches;
create policy "anon read batches"
  on public.batches
  as permissive
  for select
  to anon, authenticated
  using (true);

drop policy if exists "anon read deliverables" on public.deliverables;
create policy "anon read deliverables"
  on public.deliverables
  as permissive
  for select
  to anon, authenticated
  using (true);

drop policy if exists "anon read deliverable_events" on public.deliverable_events;
create policy "anon read deliverable_events"
  on public.deliverable_events
  as permissive
  for select
  to anon, authenticated
  using (true);

grant select on table public.batches to anon;
grant select on table public.batches to authenticated;
grant select, insert, update, delete on table public.batches to service_role;

grant select on table public.deliverables to anon;
grant select on table public.deliverables to authenticated;
grant select, insert, update, delete on table public.deliverables to service_role;

grant select on table public.deliverable_events to anon;
grant select on table public.deliverable_events to authenticated;
grant select, insert, update, delete on table public.deliverable_events to service_role;
grant usage, select on sequence public.deliverable_events_id_seq to service_role;

revoke all on public.mirror_outbox from anon;
revoke all on public.mirror_outbox from authenticated;
grant select, insert, update, delete on table public.mirror_outbox to service_role;
grant usage, select on sequence public.mirror_outbox_id_seq to service_role;

revoke all on public.linear_archive from anon;
revoke all on public.linear_archive from authenticated;
grant select, insert, update, delete on table public.linear_archive to service_role;

revoke all on function public.track_b_batch_touch_updated_at() from public, anon, authenticated;
revoke all on function public.track_b_deliverable_touch_timestamps() from public, anon, authenticated;
revoke all on function public.track_b_deliverable_ledger_guard() from public, anon, authenticated;
revoke all on function public.track_b_batch_ledger_guard() from public, anon, authenticated;
revoke all on function public.batch_write(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.deliverable_write(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.deliverable_merge_comments(text, text, text) from public, anon, authenticated;
revoke all on function public.batch_merge_comments(text, text, text) from public, anon, authenticated;
grant execute on function public.batch_write(jsonb, jsonb) to service_role;
grant execute on function public.deliverable_write(jsonb, jsonb) to service_role;
grant execute on function public.deliverable_merge_comments(text, text, text) to service_role;
grant execute on function public.batch_merge_comments(text, text, text) to service_role;

alter table public.batches replica identity full;
alter table public.deliverables replica identity full;
alter table public.deliverable_events replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'batches'
  ) then
    alter publication supabase_realtime add table public.batches;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'deliverables'
  ) then
    alter publication supabase_realtime add table public.deliverables;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'deliverable_events'
  ) then
    alter publication supabase_realtime add table public.deliverable_events;
  end if;
end $$;
