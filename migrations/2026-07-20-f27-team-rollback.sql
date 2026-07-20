-- F27: guarded, per-team Track-B rollback accounting.
--
-- This is additive source only. Applying it does not flip a flag, change
-- authority, deploy an Edge Function, or touch n8n. The final authority
-- reversal remains owner-executed and is refused unless the affected team is
-- held, every captured intent is classified, approved replays are terminal,
-- and the team's active outbox count is exactly zero.

begin;

alter table public.mirror_outbox
  drop constraint if exists mirror_outbox_status_b4_check;
alter table public.mirror_outbox
  add constraint mirror_outbox_status_b4_check
  check (status in (
    'pending', 'shadow_ok', 'written', 'failed', 'skipped', 'stale',
    'quarantined'
  ));

create table if not exists public.track_b_team_rollbacks (
  id uuid primary key default gen_random_uuid(),
  correlation_id uuid not null unique default gen_random_uuid(),
  team text not null check (team in ('video', 'graphics')),
  state text not null default 'open' check (state in ('open', 'complete', 'cancelled')),
  expected_authority jsonb not null,
  prior_outbound jsonb not null,
  prior_parity jsonb not null,
  snapshot_count integer not null default 0 check (snapshot_count >= 0),
  snapshot_sha256 text,
  terminal_receipt jsonb,
  actor text not null,
  opened_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists track_b_team_rollbacks_one_open_team_idx
  on public.track_b_team_rollbacks (team)
  where state = 'open';

create table if not exists public.track_b_team_rollback_intents (
  rollback_id uuid not null references public.track_b_team_rollbacks(id),
  outbox_id bigint not null references public.mirror_outbox(id),
  row_snapshot jsonb not null,
  row_sha256 text not null,
  classification text check (classification in (
    'replay', 'quarantine', 'discard', 'already_reflected'
  )),
  reason text,
  classified_by text,
  classified_at timestamptz,
  terminal_receipt jsonb,
  primary key (rollback_id, outbox_id)
);

create or replace function public.track_b_f27_hold_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if current_setting('app.f27_rollback_bypass', true) = '1' then
    return new;
  end if;
  if new.status in ('pending', 'failed', 'shadow_ok')
     and exists (
       select 1 from public.track_b_team_rollbacks r
       where r.team = lower(new.team) and r.state = 'open'
     ) then
    raise exception 'team_rollback_hold:%', lower(new.team);
  end if;
  return new;
end;
$fn$;

drop trigger if exists track_b_f27_hold_guard on public.mirror_outbox;
create trigger track_b_f27_hold_guard
  before insert or update of status, team on public.mirror_outbox
  for each row execute function public.track_b_f27_hold_guard();

create or replace function public.track_b_f27_begin(
  p_team text,
  p_expected_authority jsonb,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_team text := lower(nullif(btrim(coalesce(p_team, '')), ''));
  v_actor text := nullif(btrim(coalesce(p_actor, '')), '');
  v_authority jsonb;
  v_outbound jsonb;
  v_parity jsonb;
  v_rollback public.track_b_team_rollbacks%rowtype;
  v_count integer;
  v_inflight integer;
  v_hash text;
begin
  if v_team not in ('video', 'graphics') or v_actor is null then
    raise exception 'f27_invalid_scope';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('track-b-f27:' || v_team, 0));
  lock table public.mirror_outbox in share row exclusive mode;

  select value into v_authority from public.syncview_runtime_flags
    where key = 'prod_authority' for update;
  select value into v_outbound from public.syncview_runtime_flags
    where key = 'linear_outbound_enabled' for update;
  select value into v_parity from public.syncview_runtime_flags
    where key = 'linear_legacy_parity_enabled' for update;

  if v_authority is distinct from p_expected_authority
     or v_authority->>v_team is distinct from 'syncview' then
    raise exception 'f27_authority_cas_refused';
  end if;
  if v_outbound is distinct from '{"mode":"off"}'::jsonb
     or v_parity is distinct from '{"enabled":false}'::jsonb then
    raise exception 'f27_emergency_stops_required';
  end if;

  -- F2/F4 stop new scans, but a stateless drainer may already hold a row and
  -- have passed its control read. Never clear that lease: wait for the worker
  -- to checkpoint/release, or investigate an expired lease, then begin again.
  select count(*) into v_inflight
  from public.mirror_outbox o
  where lower(o.team) = v_team
    and o.status in ('pending', 'failed', 'shadow_ok')
    and (o.lock_token is not null or o.locked_at is not null);
  if v_inflight <> 0 then
    raise exception 'f27_inflight_rows:%', v_inflight;
  end if;

  insert into public.track_b_team_rollbacks (
    team, expected_authority, prior_outbound, prior_parity, actor
  ) values (v_team, v_authority, v_outbound, v_parity, v_actor)
  returning * into v_rollback;

  insert into public.track_b_team_rollback_intents (
    rollback_id, outbox_id, row_snapshot, row_sha256
  )
  select
    v_rollback.id,
    o.id,
    to_jsonb(o),
    encode(digest(convert_to(to_jsonb(o)::text, 'UTF8'), 'sha256'), 'hex')
  from public.mirror_outbox o
  where lower(o.team) = v_team
    and o.status in ('pending', 'failed', 'shadow_ok')
  order by o.id;
  get diagnostics v_count = row_count;

  select encode(
    digest(convert_to(coalesce(string_agg(i.row_sha256, '' order by i.outbox_id), ''), 'UTF8'), 'sha256'),
    'hex'
  ) into v_hash
  from public.track_b_team_rollback_intents i
  where i.rollback_id = v_rollback.id;

  perform set_config('app.f27_rollback_bypass', '1', true);
  update public.mirror_outbox o
  set status = 'quarantined',
      last_error = 'F27 hold ' || v_rollback.correlation_id::text,
      next_retry_at = null,
      updated_at = now()
  where lower(o.team) = v_team
    and o.status in ('pending', 'failed', 'shadow_ok');

  update public.track_b_team_rollbacks
  set snapshot_count = v_count, snapshot_sha256 = v_hash
  where id = v_rollback.id;

  return jsonb_build_object(
    'ok', true,
    'type', 'f27_snapshot_terminal',
    'rollback_id', v_rollback.id,
    'correlation_id', v_rollback.correlation_id,
    'team', v_team,
    'snapshot_count', v_count,
    'snapshot_sha256', v_hash,
    'normal_outbound', v_outbound,
    'legacy_parity', v_parity
  );
end;
$fn$;

create or replace function public.track_b_f27_classify(
  p_rollback_id uuid,
  p_outbox_id bigint,
  p_classification text,
  p_reason text,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_kind text := lower(nullif(btrim(coalesce(p_classification, '')), ''));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_actor text := nullif(btrim(coalesce(p_actor, '')), '');
  v_team text;
  v_count integer;
begin
  if v_kind not in ('replay', 'quarantine', 'discard', 'already_reflected')
     or v_reason is null or v_actor is null then
    raise exception 'f27_classification_incomplete';
  end if;
  select r.team into v_team
  from public.track_b_team_rollbacks r
  where r.id = p_rollback_id and r.state = 'open'
  for update;
  if not found then raise exception 'f27_open_rollback_required'; end if;

  update public.track_b_team_rollback_intents
  set classification = v_kind, reason = v_reason,
      classified_by = v_actor, classified_at = now()
  where rollback_id = p_rollback_id and outbox_id = p_outbox_id
    and classification is null;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'f27_intent_classification_cas_refused'; end if;

  perform set_config('app.f27_rollback_bypass', '1', true);
  if v_kind = 'replay' then
    update public.mirror_outbox
    set attempts = 0, last_error = 'F27 approved replay pending',
        processed_at = null, next_retry_at = now(),
        lock_token = null, locked_at = null, updated_at = now()
    where id = p_outbox_id and lower(team) = v_team and status = 'quarantined';
  elsif v_kind in ('discard', 'already_reflected') then
    update public.mirror_outbox
    set status = 'skipped', processed_at = now(), next_retry_at = null,
        last_error = 'F27 ' || v_kind || ': ' || v_reason,
        lock_token = null, locked_at = null, updated_at = now()
    where id = p_outbox_id and lower(team) = v_team and status = 'quarantined';
  end if;

  return jsonb_build_object(
    'ok', true, 'type', 'f27_classification_terminal',
    'rollback_id', p_rollback_id, 'outbox_id', p_outbox_id,
    'classification', v_kind
  );
end;
$fn$;

create or replace function public.track_b_f27_record_terminal(
  p_rollback_id uuid,
  p_outbox_id bigint,
  p_receipt jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_count integer;
begin
  if coalesce(p_receipt->>'correlation_id', '') = ''
     or p_receipt->>'ok' is distinct from 'true'
     or p_receipt->>'type' is distinct from 'linear_write_terminal'
     or p_receipt->>'rollback_id' is distinct from p_rollback_id::text
     or p_receipt->>'outbox_id' is distinct from p_outbox_id::text then
    raise exception 'f27_correlated_terminal_receipt_required';
  end if;
  update public.track_b_team_rollback_intents i
  set terminal_receipt = p_receipt
  from public.track_b_team_rollbacks r, public.mirror_outbox o
  where i.rollback_id = p_rollback_id and i.outbox_id = p_outbox_id
    and r.id = i.rollback_id and r.state = 'open'
    and o.id = i.outbox_id
    and i.classification = 'replay'
    and i.terminal_receipt is null
    and o.status = 'written'
    and o.linear_result is not null
    and p_receipt->>'dedup_key' is not distinct from o.dedup_key
    and p_receipt->>'operation' is not distinct from o.operation
    and p_receipt->>'correlation_id' is not distinct from o.linear_result->>'correlation_id'
    and p_receipt->>'linear_result_sha256' is not distinct from encode(
      digest(convert_to(o.linear_result::text, 'UTF8'), 'sha256'), 'hex'
    )
    and p_receipt->>'intent_snapshot_sha256' is not distinct from i.row_sha256;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'f27_terminal_receipt_refused'; end if;
  return jsonb_build_object(
    'ok', true, 'type', 'f27_replay_terminal',
    'rollback_id', p_rollback_id, 'outbox_id', p_outbox_id,
    'correlation_id', p_receipt->>'correlation_id'
  );
end;
$fn$;

create or replace function public.track_b_f27_finalize(
  p_rollback_id uuid,
  p_expected_authority jsonb,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_case public.track_b_team_rollbacks%rowtype;
  v_authority jsonb;
  v_new_authority jsonb;
  v_outbound jsonb;
  v_parity jsonb;
  v_unclassified integer;
  v_unreceipted integer;
  v_active integer;
  v_receipt jsonb;
  v_updated integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('track-b-f27-finalize:' || p_rollback_id::text, 0));
  lock table public.mirror_outbox in share row exclusive mode;
  select * into v_case from public.track_b_team_rollbacks
    where id = p_rollback_id and state = 'open' for update;
  if not found then raise exception 'f27_open_rollback_required'; end if;
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'f27_actor_required';
  end if;

  select value into v_authority from public.syncview_runtime_flags
    where key = 'prod_authority' for update;
  select value into v_outbound from public.syncview_runtime_flags
    where key = 'linear_outbound_enabled' for update;
  select value into v_parity from public.syncview_runtime_flags
    where key = 'linear_legacy_parity_enabled' for update;
  if v_authority is distinct from p_expected_authority
     or v_authority is distinct from v_case.expected_authority then
    raise exception 'f27_authority_cas_refused';
  end if;
  if v_outbound is distinct from '{"mode":"off"}'::jsonb
     or v_parity is distinct from '{"enabled":false}'::jsonb then
    raise exception 'f27_emergency_stops_required';
  end if;

  select count(*) into v_unclassified
  from public.track_b_team_rollback_intents
  where rollback_id = p_rollback_id and classification is null;
  select count(*) into v_unreceipted
  from public.track_b_team_rollback_intents
  where rollback_id = p_rollback_id
    and classification = 'replay' and terminal_receipt is null;
  select count(*) into v_active
  from public.mirror_outbox
  where lower(team) = v_case.team
    and status in ('pending', 'failed', 'shadow_ok');
  if v_unclassified <> 0 or v_unreceipted <> 0 or v_active <> 0 then
    raise exception 'f27_team_not_zero: unclassified=%, unreceipted=%, active=%',
      v_unclassified, v_unreceipted, v_active;
  end if;

  v_new_authority := jsonb_set(v_authority, array[v_case.team], '"linear"'::jsonb, false);
  update public.syncview_runtime_flags
  set value = v_new_authority, updated_by = p_actor
  where key = 'prod_authority' and value = p_expected_authority;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then raise exception 'f27_authority_update_refused'; end if;

  v_receipt := jsonb_build_object(
    'ok', true,
    'type', 'f27_rollback_terminal',
    'rollback_id', v_case.id,
    'correlation_id', v_case.correlation_id,
    'team', v_case.team,
    'snapshot_count', v_case.snapshot_count,
    'snapshot_sha256', v_case.snapshot_sha256,
    'unclassified', v_unclassified,
    'unreceipted_replays', v_unreceipted,
    'active_team_rows', v_active,
    'authority_before', v_authority,
    'authority_after', v_new_authority,
    'normal_outbound', v_outbound,
    'legacy_parity', v_parity
  );
  update public.track_b_team_rollbacks
  set state = 'complete', terminal_receipt = v_receipt, completed_at = now()
  where id = p_rollback_id and state = 'open';
  return v_receipt;
end;
$fn$;

revoke all on table public.track_b_team_rollbacks from public, anon, authenticated, service_role;
revoke all on table public.track_b_team_rollback_intents from public, anon, authenticated, service_role;
grant select on table public.track_b_team_rollbacks to service_role;
grant select on table public.track_b_team_rollback_intents to service_role;
revoke all on function public.track_b_f27_begin(text, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.track_b_f27_classify(uuid, bigint, text, text, text)
  from public, anon, authenticated;
revoke all on function public.track_b_f27_record_terminal(uuid, bigint, jsonb)
  from public, anon, authenticated;
revoke all on function public.track_b_f27_finalize(uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.track_b_f27_begin(text, jsonb, text) to service_role;
grant execute on function public.track_b_f27_classify(uuid, bigint, text, text, text) to service_role;
grant execute on function public.track_b_f27_record_terminal(uuid, bigint, jsonb) to service_role;
grant execute on function public.track_b_f27_finalize(uuid, jsonb, text) to service_role;

commit;
