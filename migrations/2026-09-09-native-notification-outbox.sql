-- Native notification intents: committed facts first, provider delivery later.
--
-- This deliberately does not invoke Slack, n8n, or any scheduler.  The notify
-- Edge Function may claim an intent only after an operator deliberately
-- configures its runner secret and Slack bot credential.  Status/comment
-- triggers are independent AFTER INSERT observers; they do not replace native
-- intake, ordinary-mirror, or comment-writing functions.

begin;

create extension if not exists pgcrypto;

create table if not exists public.production_notification_config (
  key text primary key check (key in ('urgent_video_destination')),
  value jsonb not null check (jsonb_typeof(value) = 'object'),
  updated_at timestamptz not null default now()
);

create table if not exists public.production_notification_intents (
  id uuid primary key default gen_random_uuid(),
  intent_key text not null unique check (intent_key ~ '^[a-z][a-z0-9:_-]{1,239}$'),
  kind text not null check (kind in ('status_smm_approval','status_tweak','comment','urgent')),
  state text not null default 'pending'
    check (state in ('pending','sending','sent','retryable','unknown','blocked')),
  client_slug text not null references public.clients(slug),
  deliverable_id text not null references public.deliverables(id),
  source_event_id bigint references public.deliverable_events(id),
  source_comment_id text references public.production_comments(id),
  actor_member_id uuid references public.team_members(id),
  intended_member_id uuid references public.team_members(id),
  destination_kind text not null check (destination_kind in ('client_creative_channel','video_editing_channel')),
  destination_channel_id text,
  message jsonb not null check (jsonb_typeof(message) = 'object'),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_failure_code text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint production_notification_intent_source_check check (
    (kind in ('status_smm_approval','status_tweak') and source_event_id is not null and source_comment_id is null)
    or (kind = 'comment' and source_event_id is null and source_comment_id is not null)
    or (kind = 'urgent' and source_event_id is null and source_comment_id is null)
  ),
  constraint production_notification_intent_destination_check check (
    (destination_channel_id is null and state = 'blocked')
    or coalesce(destination_channel_id ~ '^[CG][A-Z0-9]{8,}$', false)
  ),
  constraint production_notification_intent_delivery_check check (
    (state = 'sent' and provider_message_id is not null and sent_at is not null)
    or (state <> 'sent' and provider_message_id is null and sent_at is null)
  )
);

create unique index if not exists production_notification_intents_event_once
  on public.production_notification_intents (source_event_id)
  where source_event_id is not null;
create unique index if not exists production_notification_intents_comment_once
  on public.production_notification_intents (source_comment_id)
  where source_comment_id is not null;
create index if not exists production_notification_intents_ready
  on public.production_notification_intents (created_at, id)
  where state in ('pending', 'retryable');
create index if not exists production_notification_intents_unresolved
  on public.production_notification_intents (created_at, id)
  where state in ('blocked', 'unknown');

-- The receipt snapshots the exact channel and (for urgent) intended editor that
-- were claimed. A status/comment channel post has no individual recipient.
create table if not exists public.production_notification_delivery_receipts (
  id bigint generated always as identity primary key,
  intent_id uuid not null references public.production_notification_intents(id) on delete cascade,
  attempt integer not null check (attempt > 0),
  outcome text not null check (outcome in ('sent','retryable','unknown','blocked')),
  intended_member_id uuid references public.team_members(id),
  destination_channel_id text not null check (destination_channel_id ~ '^[CG][A-Z0-9]{8,}$'),
  provider_message_id text,
  failure_code text,
  created_at timestamptz not null default now(),
  constraint production_notification_delivery_receipt_shape check (
    (outcome = 'sent' and provider_message_id ~ '^\d{10,}\.[0-9]{6}$' and failure_code is null)
    or (outcome <> 'sent' and provider_message_id is null and failure_code ~ '^[a-z][a-z0-9_]{1,79}$')
  ),
  unique (intent_id, attempt)
);

create table if not exists public.production_notification_reconciliations (
  id bigint generated always as identity primary key,
  intent_id uuid not null references public.production_notification_intents(id),
  action text not null check (action in ('release_blocked_destination','retry_duplicate_risk','retry_known_nondelivery','attest_manual_receipt')),
  provider_message_id text,
  created_at timestamptz not null default now()
);

alter table public.production_notification_config enable row level security;
alter table public.production_notification_intents enable row level security;
alter table public.production_notification_delivery_receipts enable row level security;
alter table public.production_notification_reconciliations enable row level security;
revoke all on table public.production_notification_config, public.production_notification_intents,
  public.production_notification_delivery_receipts, public.production_notification_reconciliations from public, anon, authenticated;
grant select, insert, update, delete on table public.production_notification_config to service_role;
-- Intents/receipts have no direct service DML route: only SECURITY DEFINER
-- observer/claim/receipt routines write them.
revoke all on table public.production_notification_intents, public.production_notification_delivery_receipts, public.production_notification_reconciliations from service_role;
-- Read-only inspection supports the service gateway and security-invoker monitor.
-- Business/delivery state remains writable only through the owning RPCs.
grant select on table public.production_notification_intents, public.production_notification_delivery_receipts, public.production_notification_reconciliations to service_role;
grant usage, select on sequence public.production_notification_delivery_receipts_id_seq, public.production_notification_reconciliations_id_seq to service_role;

-- Once committed, event/comment identity, destination, and message are durable
-- evidence.  Delivery transitions are only performed by the two RPCs below.
create or replace function public.production_notification_intent_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if tg_op = 'INSERT' then
    if current_setting('app.production_notification_write', true) is distinct from '1' then
      raise exception 'production_notification_intent_insert_forbidden';
    end if;
    return new;
  end if;
  if current_setting('app.production_notification_write', true) is distinct from '1' then
    raise exception 'production_notification_intent_update_forbidden';
  end if;
  if new.id is distinct from old.id or new.intent_key is distinct from old.intent_key
     or new.kind is distinct from old.kind or new.client_slug is distinct from old.client_slug
     or new.deliverable_id is distinct from old.deliverable_id
     or new.source_event_id is distinct from old.source_event_id
     or new.source_comment_id is distinct from old.source_comment_id
     or new.actor_member_id is distinct from old.actor_member_id
     or new.intended_member_id is distinct from old.intended_member_id
     or new.destination_kind is distinct from old.destination_kind
     or new.message is distinct from old.message or new.created_at is distinct from old.created_at
     or (new.destination_channel_id is distinct from old.destination_channel_id and not (
       old.state = 'blocked' and old.destination_channel_id is null and new.state = 'pending'
       and (new.destination_channel_id ~ '^[CG][A-Z0-9]{8,}$') is true)) then
    raise exception 'production_notification_intent_immutable';
  end if;
  return new;
end;
$fn$;

drop trigger if exists production_notification_intent_guard_before on public.production_notification_intents;
create trigger production_notification_intent_guard_before
before insert or update on public.production_notification_intents
for each row execute function public.production_notification_intent_guard();

-- Human-derived fields are rendered as plain text. This makes `<@U…>`,
-- `<!channel>`, and HTML-like text inert before the Slack adapter also sends
-- parse:none/link_names:false.
create or replace function public.production_notification_plain_text(p_value text, p_cap integer)
returns text
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select left(replace(replace(replace(coalesce(p_value, ''), '<', '‹'), '>', '›'), '&', '＆'), greatest(0, least(coalesce(p_cap, 0), 3500)))
$fn$;

create or replace function public.production_notification_actor_valid(
  p_member_id uuid, p_actor_key text, p_team text
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1
      from public.team_members m
     where m.id = p_member_id
       and m.active = true
       and p_actor_key = 'member:' || m.id::text
       and (m.role in ('admin', 'smm') or (m.role in ('editor', 'designer') and m.team = p_team))
  )
$fn$;

-- These four application tables use status/raw archive markers, not deleted_at.
-- Canceled remains a visible status. False-like markers do not hide live work.
create or replace function public.production_notification_deliverable_live(p_status text, p_raw jsonb)
returns boolean language plpgsql immutable
set search_path = public, pg_temp
as $fn$
declare v_raw jsonb := p_raw;
begin
  if lower(btrim(coalesce(p_status,''))) = 'archived' then return false; end if;
  if v_raw is null or jsonb_typeof(v_raw)='null' then v_raw := '{}'::jsonb;
  elsif jsonb_typeof(v_raw)='string' then
    begin v_raw := (v_raw #>> '{}')::jsonb;
    exception when invalid_text_representation then return false;
    end;
  end if;
  if jsonb_typeof(v_raw) is distinct from 'object' then return false; end if;
  return lower(btrim(coalesce(v_raw #>> '{issue,archivedAt}',''))) in ('','false','0','null')
    and not exists (
      select 1 from jsonb_each(v_raw) e
      where e.key in ('webhook_delete','deleted','delete','removed','archived')
        and (jsonb_typeof(e.value) in ('array','object')
          or lower(btrim(coalesce(e.value #>> '{}',''))) not in ('','false','0','null'))
    );
end;
$fn$;

create or replace function public.production_notification_target_live(p_deliverable_id text)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1 from public.deliverables d join public.batches b on b.id=d.batch_id
    where d.id=p_deliverable_id and b.client_slug=d.client_slug and b.status <> 'archived'
      and public.production_notification_deliverable_live(d.status,d.linear_raw)
      and case d.origin
        when 'calendar' then exists (select 1 from public.calendar_posts p where p.id=d.card_id and p.client=d.client_slug
          and lower(btrim(coalesce(p.status,''))) <> 'archived'
          and (p.video_deliverable_id=d.id or p.graphic_deliverable_id=d.id))
        when 'samples' then exists (select 1 from public.sample_reviews p where p.id=d.card_id and p.client=d.client_slug
          and lower(btrim(coalesce(p.status,''))) <> 'archived'
          and (p.video_deliverable_id=d.id or p.graphic_deliverable_id=d.id))
        else true end
  )
$fn$;

create or replace function public.production_notification_status_intent_after()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_deliverable public.deliverables%rowtype;
  v_client public.clients%rowtype;
  v_actor_id uuid;
  v_actor_key text := nullif(btrim(coalesce(new.payload->>'actor_key', '')), '');
  v_channel text;
  v_kind text;
  v_text text;
  v_state text;
begin
  -- Only the canonical native UI ledger can create a client-channel status
  -- intent. Mirrors, imports, reconciles, replay receipts and assignment events
  -- never meet this predicate.
  if new.source <> 'ui' or new.action <> 'status_change'
     or coalesce(new.event_assignee_attribution, 'unknown') not in ('native_transaction', 'unassigned')
     or new.to_status not in ('smm_approval', 'tweak')
     or new.from_status is not distinct from new.to_status
     or new.deliverable_id is null
     or coalesce(new.payload->>'auth_kind', '') <> 'staff'
     or coalesce(new.payload->>'test_only', 'false') in ('true', '1')
     or coalesce(new.payload->>'legacy_parity', 'false') in ('true', '1')
     or v_actor_key !~ '^member:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return new;
  end if;
  v_actor_id := substring(v_actor_key from 8)::uuid;
  select d.* into v_deliverable from public.deliverables d where d.id = new.deliverable_id;
  if not found or v_deliverable.client_slug <> new.client_slug or not public.production_notification_target_live(v_deliverable.id) then return new; end if;
  if not exists (select 1 from public.syncview_runtime_flags f where f.key = 'prod_authority' and f.value->>v_deliverable.team = 'syncview') then return new; end if;
  if not public.production_notification_actor_valid(v_actor_id, v_actor_key, v_deliverable.team) then return new; end if;
  select c.* into v_client from public.clients c where c.slug = v_deliverable.client_slug and c.active = true and c.kind = 'client';
  if not found then return new; end if;
  v_channel := nullif(btrim(coalesce(v_client.slack_channel_id, '')), '');
  v_kind := case new.to_status when 'smm_approval' then 'status_smm_approval' else 'status_tweak' end;
  v_text := case new.to_status
    when 'smm_approval' then 'Status update: ' || public.production_notification_plain_text(v_deliverable.title, 300) || ' is ready for SMM approval.'
    else 'Status update: ' || public.production_notification_plain_text(v_deliverable.title, 300) || ' needs tweaks.' end;
  v_state := case when v_channel ~ '^[CG][A-Z0-9]{8,}$' then 'pending' else 'blocked' end;
  perform set_config('app.production_notification_write', '1', true);
  insert into public.production_notification_intents (
    intent_key, kind, state, client_slug, deliverable_id, source_event_id,
    actor_member_id, destination_kind, destination_channel_id, message
  ) values (
    'event:' || new.id::text, v_kind, v_state, v_deliverable.client_slug, v_deliverable.id, new.id,
    v_actor_id, 'client_creative_channel', case when v_state = 'pending' then v_channel else null end,
    jsonb_build_object('schema', 1, 'text', v_text, 'parse', 'none', 'link_names', false,
      'actor_member_id', v_actor_id::text, 'event_id', new.id)
  ) on conflict (source_event_id) where source_event_id is not null do nothing;
  return new;
end;
$fn$;

drop trigger if exists production_notification_status_intent_after on public.deliverable_events;
create trigger production_notification_status_intent_after
after insert on public.deliverable_events
for each row execute function public.production_notification_status_intent_after();

create or replace function public.production_notification_comment_intent_after()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_deliverable public.deliverables%rowtype;
  v_client public.clients%rowtype;
  v_channel text;
  v_state text;
begin
  -- One freshly-created internal native subissue comment only.  Existing
  -- comment upserts return their prior row, and mirror/import/system rows fail
  -- this predicate, so they cannot generate a second channel post.
  if new.deliverable_id is null or new.deleted_at is not null
     or new.origin <> 'native' or new.source <> 'ui' or new.import_run_id is not null
     or new.backfill_tag is not null or new.native_comment_id is null
     or new.author_member_id is null or new.author_key <> 'member:' || new.author_member_id::text
     or coalesce(new.provenance->>'test_only', 'false') in ('true', '1')
     or coalesce(new.provenance->>'legacy_parity', 'false') in ('true', '1') then return new; end if;
  select d.* into v_deliverable from public.deliverables d where d.id = new.deliverable_id;
  if not found or v_deliverable.client_slug <> new.client_slug or v_deliverable.team <> new.team
     or not public.production_notification_target_live(v_deliverable.id) then return new; end if;
  if not exists (select 1 from public.syncview_runtime_flags f where f.key = 'prod_authority' and f.value->>v_deliverable.team = 'syncview') then return new; end if;
  if not public.production_notification_actor_valid(new.author_member_id, new.author_key, v_deliverable.team) then return new; end if;
  select c.* into v_client from public.clients c where c.slug = v_deliverable.client_slug and c.active = true and c.kind = 'client';
  if not found then return new; end if;
  v_channel := nullif(btrim(coalesce(v_client.slack_channel_id, '')), '');
  v_state := case when v_channel ~ '^[CG][A-Z0-9]{8,}$' then 'pending' else 'blocked' end;
  perform set_config('app.production_notification_write', '1', true);
  insert into public.production_notification_intents (
    intent_key, kind, state, client_slug, deliverable_id, source_comment_id,
    actor_member_id, destination_kind, destination_channel_id, message
  ) values (
    'comment:' || regexp_replace(new.id, '[^A-Za-z0-9:_-]', '_', 'g'), 'comment', v_state,
    v_deliverable.client_slug, v_deliverable.id, new.id, new.author_member_id,
    'client_creative_channel', case when v_state = 'pending' then v_channel else null end,
    jsonb_build_object('schema', 1,
      'text', public.production_notification_plain_text(new.author_name, 200) || ' commented on ' || public.production_notification_plain_text(v_deliverable.title, 300) || ': ' || public.production_notification_plain_text(new.body, 3500),
      'parse', 'none', 'link_names', false, 'actor_member_id', new.author_member_id::text,
      'comment_id', new.id)
  ) on conflict (source_comment_id) where source_comment_id is not null do nothing;
  return new;
end;
$fn$;

drop trigger if exists production_notification_comment_intent_after on public.production_comments;
create trigger production_notification_comment_intent_after
after insert on public.production_comments
for each row execute function public.production_notification_comment_intent_after();


-- Client comments are admitted from their correlated committed comment_add
-- ledger event, not from caller supplied comment text/name. The event is
-- written by the existing SECURITY DEFINER comment writer after its canonical
-- row, and carries the authenticated client principal kind/key.
create or replace function public.production_notification_client_comment_event_after()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_comment public.production_comments%rowtype;
  v_deliverable public.deliverables%rowtype;
  v_client public.clients%rowtype;
  v_comment_id text := nullif(btrim(coalesce(new.payload->'comment'->>'id', '')), '');
  v_channel text;
  v_state text;
begin
  if new.source <> 'ui' or new.action <> 'comment_add'
     or coalesce(new.payload->>'auth_kind', '') <> 'client'
     or new.role is distinct from 'client'
     or new.actor is distinct from nullif(btrim(coalesce(new.payload->'comment'->>'author_name', '')), '')
     or new.client_slug is null or new.deliverable_id is null or v_comment_id is null
     or new.payload->>'actor_key' is distinct from 'client:' || new.client_slug then return new; end if;
  select c.* into v_comment from public.production_comments c where c.id = v_comment_id;
  if not found or v_comment.deleted_at is not null or v_comment.deliverable_id is distinct from new.deliverable_id or v_comment.client_slug is distinct from new.client_slug
     or v_comment.author_member_id is not null or v_comment.author_key is distinct from 'client:' || new.client_slug
     or v_comment.role is distinct from 'client' or v_comment.origin is distinct from 'native' or v_comment.source is distinct from 'ui'
     or v_comment.import_run_id is not null or v_comment.backfill_tag is not null
     or coalesce(v_comment.provenance->>'test_only', 'false') in ('true', '1')
     or coalesce(v_comment.provenance->>'legacy_parity', 'false') in ('true', '1') then return new; end if;
  select d.* into v_deliverable from public.deliverables d where d.id = v_comment.deliverable_id;
  if not found or v_deliverable.client_slug <> v_comment.client_slug or v_deliverable.team <> v_comment.team
     or not public.production_notification_target_live(v_deliverable.id) then return new; end if;
  if not exists (select 1 from public.syncview_runtime_flags f where f.key = 'prod_authority' and f.value->>v_deliverable.team = 'syncview') then return new; end if;
  select c.* into v_client from public.clients c where c.slug = v_comment.client_slug and c.active = true and c.kind = 'client';
  if not found then return new; end if;
  v_channel := nullif(btrim(coalesce(v_client.slack_channel_id, '')), '');
  v_state := case when v_channel ~ '^[CG][A-Z0-9]{8,}$' then 'pending' else 'blocked' end;
  perform set_config('app.production_notification_write', '1', true);
  insert into public.production_notification_intents(
    intent_key, kind, state, client_slug, deliverable_id, source_comment_id,
    actor_member_id, destination_kind, destination_channel_id, message
  ) values (
    'comment:' || regexp_replace(v_comment.id, '[^A-Za-z0-9:_-]', '_', 'g'), 'comment', v_state,
    v_comment.client_slug, v_deliverable.id, v_comment.id, null,
    'client_creative_channel', case when v_state = 'pending' then v_channel else null end,
    jsonb_build_object('schema', 1,
      'text', public.production_notification_plain_text(v_client.display_name, 200) || ' commented on ' || public.production_notification_plain_text(v_deliverable.title, 300) || ': ' || public.production_notification_plain_text(v_comment.body, 3500),
      'parse', 'none', 'link_names', false, 'actor_kind', 'client', 'comment_id', v_comment.id)
  ) on conflict (source_comment_id) where source_comment_id is not null do nothing;
  return new;
end;
$fn$;

drop trigger if exists production_notification_client_comment_event_after on public.deliverable_events;
create trigger production_notification_client_comment_event_after
after insert on public.deliverable_events
for each row execute function public.production_notification_client_comment_event_after();

-- A sender receives a lease, never a durable success claim. If the provider
-- response becomes unknowable, it is latched as unknown and cannot be retried
-- automatically, preventing duplicate Slack posts.
create or replace view public.production_notification_monitor_v1
with (security_invoker = true) as
select i.id, i.kind, i.state, i.client_slug, i.deliverable_id, i.attempt_count,
  i.last_failure_code, i.created_at, i.updated_at, i.next_attempt_at, i.lease_expires_at,
  case
    when i.state = 'sending' and i.lease_expires_at < now() then 'lease_expired_manual_reconcile'
    when i.state = 'unknown' then 'provider_outcome_unknown_manual_reconcile'
    when i.state = 'blocked' then 'configuration_or_destination_blocked'
    when i.state = 'retryable' then 'manual_sender_retry_available'
    else null
  end as operator_action
from public.production_notification_intents i
where i.state <> 'sent';
revoke all on table public.production_notification_monitor_v1 from public, anon, authenticated;
grant select on table public.production_notification_monitor_v1 to service_role;

-- One aggregate source for the bounded health endpoint. It avoids a capped
-- relation read and treats a stuck pending/sending queue as delivery debt.
create or replace function public.production_notification_health_summary()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select jsonb_build_object(
    'pending_stale', count(*) filter (where state = 'pending' and created_at < now() - interval '15 minutes'),
    'sending_stale', count(*) filter (where state = 'sending' and (lease_expires_at is null or lease_expires_at < now())),
    'blocked', count(*) filter (where state = 'blocked'),
    'unknown', count(*) filter (where state = 'unknown'),
    'retryable_overdue', count(*) filter (where state = 'retryable' and next_attempt_at <= now()),
    'total_open', count(*) filter (where state <> 'sent')
  )
  from public.production_notification_intents
$fn$;

-- Urgent admission preserves the existing exact assigned-editor preflight but
-- writes an intent instead of calling the retired n8n handoff. It has no
-- scheduler: successful enqueue means pending, never sent.
create or replace function public.production_notification_enqueue_urgent(
  p_dispatch_id uuid, p_client_slug text, p_deliverable_id text, p_card_id text,
  p_surface text, p_video_status_at timestamptz, p_actor_member_id uuid,
  p_intended_member_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_del public.deliverables%rowtype;
  v_client public.clients%rowtype;
  v_editor public.team_members%rowtype;
  v_channel text;
  v_slug text := nullif(btrim(coalesce(p_client_slug, '')), '');
  v_surface text := lower(btrim(coalesce(p_surface, '')));
  v_round timestamptz := p_video_status_at;
  v_card_ok boolean := false;
begin
  if p_dispatch_id is null or v_slug is null or nullif(btrim(coalesce(p_deliverable_id, '')), '') is null
     or nullif(btrim(coalesce(p_card_id, '')), '') is null or v_surface not in ('calendar', 'samples')
     or v_round is null or p_actor_member_id is null or p_intended_member_id is null then
    raise exception 'notification_urgent_input_invalid';
  end if;
  select d.* into v_del from public.deliverables d where d.id = p_deliverable_id for update;
  if not found or v_del.client_slug <> v_slug or v_del.team <> 'video' or v_del.kind <> 'video'
     or v_del.origin <> v_surface or v_del.card_id <> p_card_id or v_del.status <> 'tweak' or not public.production_notification_target_live(v_del.id) then
    raise exception 'notification_urgent_target_changed';
  end if;
  if not exists (select 1 from public.syncview_runtime_flags f where f.key = 'prod_authority' and f.value->>'video' = 'syncview') then
    raise exception 'notification_urgent_authority_unavailable';
  end if;
  if not public.production_notification_actor_valid(p_actor_member_id, 'member:' || p_actor_member_id::text, 'video') then
    raise exception 'notification_urgent_actor_invalid';
  end if;
  select c.* into v_client from public.clients c where c.slug = v_slug and c.active = true and c.kind = 'client';
  if not found then raise exception 'notification_urgent_client_invalid'; end if;
  if not exists (select 1 from public.batches b where b.id = v_del.batch_id and b.client_slug = v_slug
    and b.status = 'active' and coalesce(b.purpose, 'calendar') = v_surface) then
    raise exception 'notification_urgent_target_changed';
  end if;
  if v_surface = 'calendar' then
    select exists (select 1 from public.calendar_posts p where p.id = p_card_id and p.client = v_slug
      and p.video_deliverable_id = p_deliverable_id and p.video_status = 'Tweaks Needed'
      and p.video_status_at = v_round and lower(btrim(coalesce(p.status,''))) <> 'archived') into v_card_ok;
  else
    select exists (select 1 from public.sample_reviews p where p.id = p_card_id and p.client = v_slug
      and p.video_deliverable_id = p_deliverable_id and p.video_status = 'Tweaks Needed'
      and p.video_status_at = v_round and lower(btrim(coalesce(p.status,''))) <> 'archived') into v_card_ok;
  end if;
  if not v_card_ok then raise exception 'notification_urgent_target_changed'; end if;
  select m.* into v_editor from public.team_members m where m.id = p_intended_member_id;
  if not found or v_del.assignee_id is distinct from p_intended_member_id or v_editor.active is not true
     or v_editor.role <> 'editor' or v_editor.team <> 'video'
     or (nullif(btrim(coalesce(v_editor.slack_user_id, '')), '') ~ '^U[A-Z0-9]{8,}$') is not true then
    raise exception 'notification_urgent_editor_unavailable';
  end if;
  select nullif(btrim(coalesce(value->>'channel_id', '')), '') into v_channel
    from public.production_notification_config where key = 'urgent_video_destination' for share;
  if (v_channel ~ '^[CG][A-Z0-9]{8,}$') is not true then raise exception 'notification_urgent_destination_unconfigured'; end if;
  perform set_config('app.production_notification_write', '1', true);
  insert into public.production_notification_intents(
    intent_key, kind, state, client_slug, deliverable_id, actor_member_id, intended_member_id,
    destination_kind, destination_channel_id, message
  ) values (
    'urgent:' || encode(digest(p_deliverable_id || '|' || to_char(v_round at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'sha256'), 'hex'),
    'urgent', 'pending', v_slug, p_deliverable_id, p_actor_member_id, p_intended_member_id,
    'video_editing_channel', v_channel,
    jsonb_build_object('schema', 1, 'text', '<@' || v_editor.slack_user_id || '> URGENT: ' || public.production_notification_plain_text(v_del.title, 300) || ' needs tweaks.',
      'parse', 'none', 'link_names', false, 'allow_mentions', true, 'actor_member_id', p_actor_member_id::text,
      'intended_member_id', p_intended_member_id::text, 'round', v_round::text, 'batch_id', v_del.batch_id, 'surface', v_surface, 'card_id', p_card_id)
  ) on conflict (intent_key) do nothing;
  return jsonb_build_object('status', 'pending', 'dispatch_id', p_dispatch_id::text, 'intent_key',
    'urgent:' || encode(digest(p_deliverable_id || '|' || to_char(v_round at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'sha256'), 'hex'));
end;
$fn$;

create or replace function public.production_notification_reconcile(
  p_intent_id uuid, p_action text, p_confirmation text default null, p_provider_message_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_intent public.production_notification_intents%rowtype;
  v_channel text;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_provider text := nullif(btrim(coalesce(p_provider_message_id, '')), '');
begin
  select * into v_intent from public.production_notification_intents where id = p_intent_id for update;
  if not found then raise exception 'production_notification_intent_missing'; end if;
  perform set_config('app.production_notification_write', '1', true);
  if v_action = 'release_blocked_destination' then
    if v_intent.state <> 'blocked' or v_intent.destination_channel_id is not null then raise exception 'production_notification_reconcile_invalid_state'; end if;
    if v_intent.destination_kind = 'client_creative_channel' then
      select nullif(btrim(coalesce(c.slack_channel_id, '')), '') into v_channel from public.clients c where c.slug = v_intent.client_slug and c.active and c.kind = 'client';
    else
      select nullif(btrim(coalesce(value->>'channel_id', '')), '') into v_channel from public.production_notification_config where key = 'urgent_video_destination';
    end if;
    if (v_channel ~ '^[CG][A-Z0-9]{8,}$') is not true then raise exception 'production_notification_destination_unavailable'; end if;
    update public.production_notification_intents set state = 'pending', destination_channel_id = v_channel,
      last_failure_code = null, next_attempt_at = now(), updated_at = now() where id = v_intent.id;
  elsif v_action = 'retry_duplicate_risk' then
    if v_intent.state not in ('unknown', 'sending') or p_confirmation is distinct from 'RETRY_MAY_DUPLICATE' then
      raise exception 'production_notification_duplicate_risk_confirmation_required';
    end if;
    update public.production_notification_intents set state = 'retryable', lease_token = null, lease_expires_at = null,
      next_attempt_at = now(), last_failure_code = 'operator_duplicate_risk_retry', updated_at = now() where id = v_intent.id;
  elsif v_action = 'retry_known_nondelivery' then
    if v_intent.state <> 'blocked' or v_intent.destination_channel_id is null
       or p_confirmation is distinct from 'PROVIDER_CONFIRMED_NOT_DELIVERED' then
      raise exception 'production_notification_known_nondelivery_confirmation_required';
    end if;
    update public.production_notification_intents set state = 'retryable', next_attempt_at = now(),
      last_failure_code = 'operator_confirmed_nondelivery', updated_at = now() where id = v_intent.id;
  elsif v_action = 'attest_manual_receipt' then
    if v_intent.state not in ('unknown', 'sending')
       or p_confirmation is distinct from 'MANUAL_PROVIDER_RECEIPT_VERIFIED'
       or (v_provider ~ '^\d{10,}\.[0-9]{6}$') is not true then
      raise exception 'production_notification_manual_receipt_confirmation_required';
    end if;
    update public.production_notification_intents set state = 'sent', provider_message_id = v_provider, sent_at = now(),
      attempt_count = attempt_count + 1, lease_token = null, lease_expires_at = null, updated_at = now(), last_failure_code = null
      where id = v_intent.id;
    insert into public.production_notification_delivery_receipts(intent_id, attempt, outcome, intended_member_id, destination_channel_id, provider_message_id)
    values (v_intent.id, v_intent.attempt_count + 1, 'sent', v_intent.intended_member_id, v_intent.destination_channel_id, v_provider);
  else raise exception 'production_notification_reconcile_action_invalid'; end if;
  insert into public.production_notification_reconciliations(intent_id, action, provider_message_id) values (v_intent.id, v_action, v_provider);
  return jsonb_build_object('state', (select state from public.production_notification_intents where id = v_intent.id));
end;
$fn$;

create or replace function public.production_notification_urgent_status(
  p_client_slug text, p_deliverable_id text, p_video_status_at timestamptz
) returns jsonb
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $fn$
  select coalesce((
    select jsonb_build_object('state', i.state, 'sent', i.state = 'sent')
      from public.production_notification_intents i
     where i.intent_key = 'urgent:' || encode(digest(p_deliverable_id || '|' || to_char(p_video_status_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'sha256'), 'hex')
       and i.client_slug = p_client_slug and i.kind = 'urgent'
  ), jsonb_build_object('state', 'absent', 'sent', false))
$fn$;

create or replace function public.production_notification_claim(p_limit integer default 10)
returns table(intent_id uuid, attempt integer, destination_channel_id text, text text, client_msg_id uuid, allow_mentions boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 10));
begin
  perform set_config('app.production_notification_write', '1', true);
  -- Candidate locks and its stale urgent check share one statement. The Slack
  -- request remains necessarily later (documented point-in-time limitation).
  return query
  with candidates as (
    select i.id
      from public.production_notification_intents i
     where i.state in ('pending', 'retryable') and i.destination_channel_id is not null and i.next_attempt_at <= now()
     order by i.created_at, i.id
     for update skip locked
     limit v_limit
  ), stale as (
    update public.production_notification_intents i
       set state = 'blocked', last_failure_code = case when i.kind='urgent' then 'urgent_target_changed' else 'notification_target_changed' end, updated_at = now()
      from candidates c
     where i.id = c.id and (not public.production_notification_target_live(i.deliverable_id)
       or (i.kind='comment' and not exists (select 1 from public.production_comments comment where comment.id=i.source_comment_id and comment.deliverable_id=i.deliverable_id and comment.client_slug=i.client_slug and comment.deleted_at is null))
       or (i.kind = 'urgent' and not exists (
         select 1 from public.deliverables d
         join public.team_members m on m.id = i.intended_member_id
         join public.syncview_runtime_flags f on f.key = 'prod_authority' and f.value->>'video' = 'syncview'
         join public.production_notification_config cfg on cfg.key = 'urgent_video_destination'
         where d.id = i.deliverable_id and d.client_slug = i.client_slug and d.team = 'video'
           and d.kind = 'video' and d.status = 'tweak' and public.production_notification_target_live(d.id)
           and d.origin = i.message->>'surface' and d.card_id = i.message->>'card_id'
           and d.batch_id = i.message->>'batch_id'
           and exists (select 1 from public.batches b where b.id=d.batch_id and b.client_slug=i.client_slug and b.status='active' and coalesce(b.purpose,'calendar')=i.message->>'surface')
           and d.assignee_id = i.intended_member_id and m.active and m.role = 'editor' and m.team = 'video'
           and cfg.value->>'channel_id' = i.destination_channel_id
           and ((i.message->>'surface' = 'calendar' and exists (select 1 from public.calendar_posts p where p.id = i.message->>'card_id' and p.client = i.client_slug and p.video_deliverable_id = i.deliverable_id and p.video_status = 'Tweaks Needed' and p.video_status_at = (i.message->>'round')::timestamptz and lower(btrim(coalesce(p.status,''))) <> 'archived'))
             or (i.message->>'surface' = 'samples' and exists (select 1 from public.sample_reviews p where p.id = i.message->>'card_id' and p.client = i.client_slug and p.video_deliverable_id = i.deliverable_id and p.video_status = 'Tweaks Needed' and p.video_status_at = (i.message->>'round')::timestamptz and lower(btrim(coalesce(p.status,''))) <> 'archived')))
       ))) returning i.id
  ), claimed as (
    update public.production_notification_intents i
       set state = 'sending', attempt_count = i.attempt_count + 1,
           lease_token = gen_random_uuid(), lease_expires_at = now() + interval '5 minutes',
           updated_at = now(), next_attempt_at = now(), last_failure_code = null
      from candidates c
     where i.id = c.id and not exists (select 1 from stale s where s.id = i.id)
    returning i.*
  )
  select c.id, c.attempt_count, c.destination_channel_id, c.message->>'text', c.id, coalesce((c.message->>'allow_mentions')::boolean, false) from claimed c;
end;
$fn$;

create or replace function public.production_notification_record_delivery(
  p_intent_id uuid, p_attempt integer, p_outcome text,
  p_provider_message_id text default null, p_failure_code text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_intent public.production_notification_intents%rowtype;
  v_outcome text := lower(btrim(coalesce(p_outcome, '')));
  v_provider text := nullif(btrim(coalesce(p_provider_message_id, '')), '');
  v_failure text := nullif(btrim(coalesce(p_failure_code, '')), '');
begin
  select * into v_intent from public.production_notification_intents where id = p_intent_id for update;
  if not found or v_intent.state <> 'sending' or v_intent.attempt_count <> p_attempt then
    raise exception 'production_notification_delivery_claim_missing';
  end if;
  if v_outcome not in ('sent', 'retryable', 'unknown', 'blocked') then raise exception 'production_notification_delivery_outcome_invalid'; end if;
  if (v_outcome = 'sent') <> (v_provider is not null and v_provider ~ '^\d{10,}\.[0-9]{6}$') then
    raise exception 'production_notification_provider_receipt_invalid';
  end if;
  if (v_outcome <> 'sent') <> (v_failure is not null and v_failure ~ '^[a-z][a-z0-9_]{1,79}$') then
    raise exception 'production_notification_failure_code_invalid';
  end if;
  perform set_config('app.production_notification_write', '1', true);
  update public.production_notification_intents
     set state = v_outcome, provider_message_id = v_provider, last_failure_code = v_failure,
         sent_at = case when v_outcome = 'sent' then now() else null end,
         next_attempt_at = case when v_outcome = 'retryable' then now() + interval '5 minutes' else now() end,
         lease_token = null, lease_expires_at = null, updated_at = now()
   where id = p_intent_id;
  insert into public.production_notification_delivery_receipts(intent_id, attempt, outcome, intended_member_id, destination_channel_id, provider_message_id, failure_code)
  values (p_intent_id, p_attempt, v_outcome, v_intent.intended_member_id, v_intent.destination_channel_id, v_provider, v_failure);
end;
$fn$;

revoke all on function public.production_notification_deliverable_live(text,jsonb),
  public.production_notification_target_live(text),
  public.production_notification_intent_guard(),
  public.production_notification_status_intent_after(),
  public.production_notification_comment_intent_after(),
  public.production_notification_client_comment_event_after(),
  public.production_notification_plain_text(text, integer),
  public.production_notification_actor_valid(uuid, text, text),
  public.production_notification_health_summary(),
  public.production_notification_urgent_status(text, text, timestamptz),
  public.production_notification_reconcile(uuid, text, text, text),
  public.production_notification_enqueue_urgent(uuid, text, text, text, text, timestamptz, uuid, uuid),
  public.production_notification_claim(integer),
  public.production_notification_record_delivery(uuid, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.production_notification_deliverable_live(text,jsonb),
  public.production_notification_target_live(text),
  public.production_notification_health_summary(),
  public.production_notification_urgent_status(text, text, timestamptz),
  public.production_notification_reconcile(uuid, text, text, text),
  public.production_notification_enqueue_urgent(uuid, text, text, text, text, timestamptz, uuid, uuid),
  public.production_notification_claim(integer),
  public.production_notification_record_delivery(uuid, integer, text, text, text) to service_role;

commit;
