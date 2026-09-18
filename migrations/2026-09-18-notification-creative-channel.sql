-- 2026-09-18 — the client creative channel becomes its own column, and the
-- notification readers stop reading the shared one.
--
-- WHY. Measured on the live roster tonight: all 26 stored `clients.slack_channel_id`
-- values are SHARED client channels — the channel the client is in. Every native
-- notification path resolved its destination from that column, so an enabled
-- sender would have posted internal status changes and staff comments into a
-- channel the client can read. That is not a delivery bug to be fixed later; it
-- is the wrong destination by construction.
--
-- WHAT. `clients.creative_channel_id` is a new, separate, nullable column with
-- its own shape check. The three intent triggers and the client branch of the
-- reconcile RPC read it INSTEAD of `slack_channel_id`. Nothing reads the shared
-- column for notifications any more, and a client that has no creative channel
-- yet produces a BLOCKED intent with no destination — never a send.
--
-- Note on the two shapes, deliberately different: the column check accepts
-- `^C[A-Z0-9]{8,}$` (public channels), while the state predicate and the table
-- constraint accept `^[CG][A-Z0-9]{8,}$`. Since this column is now the only
-- source for a client destination, a `G…` id cannot be stored and so cannot be
-- sent to. Widening the column later is additive; narrowing the predicate is not.
--
-- PRIVILEGES. `create or replace function` preserves an existing function's ACL,
-- so this file grants nothing and revokes nothing. It does not re-grant what
-- migrations/2026-09-17-notification-service-role-revokes.sql removed: EXECUTE on
-- these routines is still absent for `service_role`, and `public`, `anon` and
-- `authenticated` gain nothing here either. All four roles are named so that the
-- absence is a statement rather than an omission (CLAUDE.md).
--
-- The new column inherits the `clients` table's existing grants; no column-level
-- grant or revoke is issued for `service_role`, `anon`, `authenticated` or
-- `public`, because the notification readers are SECURITY DEFINER and the
-- browser roles gain no new reachable data: a channel id is not exposed by any
-- browser-reachable select that did not already select the row.

begin;

-- 1. The column.
alter table public.clients add column if not exists creative_channel_id text;
alter table public.clients drop constraint if exists clients_creative_channel_id_check;
alter table public.clients add constraint clients_creative_channel_id_check
  check (creative_channel_id is null or creative_channel_id ~ '^C[A-Z0-9]{8,}$');
comment on column public.clients.creative_channel_id is
  'Internal creative channel for native notifications. NOT the shared client channel in slack_channel_id. Null means no destination: intents block.';

-- 2. The intent guard gains exactly one new allowed transition, the withdrawing
-- direction, so that step 3 can withdraw a pending row rather than leaving it
-- pointed at a shared channel. Everything else in the guard is byte for byte
-- the 2026-09-09 text.

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
  v_channel := nullif(btrim(coalesce(v_client.creative_channel_id, '')), '');
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
  v_channel := nullif(btrim(coalesce(v_client.creative_channel_id, '')), '');
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
  v_channel := nullif(btrim(coalesce(v_client.creative_channel_id, '')), '');
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
      select nullif(btrim(coalesce(c.creative_channel_id, '')), '') into v_channel from public.clients c where c.slug = v_intent.client_slug and c.active and c.kind = 'client';
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
       (old.state = 'blocked' and old.destination_channel_id is null and new.state = 'pending'
         and (new.destination_channel_id ~ '^[CG][A-Z0-9]{8,}$') is true)
       -- 2026-09-18: the one-way safety direction. An intent that still points
       -- at a destination may be withdrawn to blocked with no destination at
       -- all. It can only ever reduce what a sender could do, and without it
       -- step 3 of this migration could not withdraw the pending rows that
       -- point at a shared channel.
       or (old.state = 'pending' and old.destination_channel_id is not null
         and new.state = 'blocked' and new.destination_channel_id is null))) then
    raise exception 'production_notification_intent_immutable';
  end if;
  return new;
end;
$fn$;

-- 3. Nothing pending may keep pointing at a shared channel. Every
-- client_creative_channel intent still in `pending` is withdrawn to `blocked`
-- with no destination. `sending`, `sent`, `retryable` and `unknown` are left
-- exactly as they are: this migration never rewrites the record of something
-- that already left, or that an operator is mid-decision on.
do $mig$
declare v_withdrawn integer;
begin
  perform set_config('app.production_notification_write', '1', true);
  with withdrawn as (
    update public.production_notification_intents
       set state = 'blocked', destination_channel_id = null,
           last_failure_code = 'destination_withdrawn_creative_channel_migration',
           updated_at = now()
     where destination_kind = 'client_creative_channel'
       and state = 'pending'
     returning 1)
  select count(*) into v_withdrawn from withdrawn;
  raise notice 'withdrawn pending client_creative_channel intents: %', v_withdrawn;
  if exists (select 1 from public.production_notification_intents
              where destination_kind = 'client_creative_channel'
                and state = 'pending' and destination_channel_id is not null) then
    raise exception 'pending client destination survived the withdrawal';
  end if;
end;
$mig$;

commit;
