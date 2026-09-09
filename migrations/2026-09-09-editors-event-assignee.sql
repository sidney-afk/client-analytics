-- Event-time editor attribution for the native weekly labor view.
--
-- This is forward-only. Existing ledger rows deliberately remain `unknown`:
-- do NOT infer their owner from deliverables.assignee_id, because that is the
-- current owner and can silently rewrite a reassigned person's history.
--
-- `event_assignee_attribution` says what the nullable identity means:
--   native_transaction = identity read inside the status-write transaction
--   unassigned         = that transaction had no assignee
--   unknown            = no transaction-time proof (legacy/import/backfill)
-- The UUID deliberately has no FK: removing a roster row must not erase a
-- durable historical identity. It is not a new display-name/email snapshot.

begin;

alter table public.deliverable_events
  add column if not exists event_assignee_id uuid,
  add column if not exists event_assignee_attribution text not null default 'unknown';

alter table public.deliverable_events
  drop constraint if exists deliverable_events_event_assignee_attribution_check;
alter table public.deliverable_events
  add constraint deliverable_events_event_assignee_attribution_check
  check (
    (event_assignee_attribution = 'native_transaction' and event_assignee_id is not null)
    or (event_assignee_attribution in ('unassigned', 'unknown') and event_assignee_id is null)
  );

create index if not exists deliverable_events_status_event_assignee_ts_idx
  on public.deliverable_events (ts desc, event_assignee_id)
  where action in ('status_change', 'mirror_in_status_change');

-- Ordinary application writers may continue to create legacy/mirror/import
-- events, but cannot claim an event owner without the native transaction's
-- local protocol stamp. The trigger consumes that stamp immediately and
-- attribution fields are immutable through ordinary UPDATE paths. This is not
-- a boundary against an SQL-capable privileged role: service_role can set a
-- custom GUC and has direct ledger INSERT in the base schema. The protocol
-- prevents accidental/caller-payload fabrication; privileged SQL remains a
-- separately trusted database authority.
create or replace function public.deliverable_events_event_assignee_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_stamp text := current_setting('app.event_assignee_stamp', true);
  v_id_text text;
  v_attribution text;
begin
  if tg_op = 'UPDATE' then
    if new.event_assignee_id is distinct from old.event_assignee_id
       or new.event_assignee_attribution is distinct from old.event_assignee_attribution then
      raise exception 'event_assignee_attribution_immutable';
    end if;
    return new;
  end if;

  if v_stamp = 'native-status-v1' then
    v_id_text := nullif(current_setting('app.event_assignee_id', true), '');
    v_attribution := nullif(current_setting('app.event_assignee_attribution', true), '');
    if v_attribution not in ('native_transaction', 'unassigned') then
      raise exception 'event_assignee_stamp_invalid';
    end if;
    if (v_attribution = 'native_transaction') is distinct from (v_id_text is not null) then
      raise exception 'event_assignee_stamp_invalid';
    end if;
    new.event_assignee_id := v_id_text::uuid;
    new.event_assignee_attribution := v_attribution;
    -- A local setting is transaction-scoped. Consume it so an unrelated
    -- nested/direct event in the same transaction cannot inherit this proof.
    perform set_config('app.event_assignee_stamp', '', true);
    perform set_config('app.event_assignee_id', '', true);
    perform set_config('app.event_assignee_attribution', '', true);
  elsif new.event_assignee_id is not null
     or new.event_assignee_attribution is distinct from 'unknown' then
    raise exception 'event_assignee_server_stamp_required';
  end if;
  return new;
end;
$fn$;

DROP TRIGGER IF EXISTS deliverable_events_event_assignee_guard_before
  ON public.deliverable_events;
CREATE TRIGGER deliverable_events_event_assignee_guard_before
  BEFORE INSERT OR UPDATE ON public.deliverable_events
  FOR EACH ROW EXECUTE FUNCTION public.deliverable_events_event_assignee_guard();

-- Source-time and imported/backfill events are intentionally NOT stamped as
-- native-transaction proof. `p_event.ts` remains the existing ledger-time
-- override. `p_event.source_event_at` is only a proof-disqualifying marker,
-- so without `ts` the event keeps the existing arrival-time timestamp. A
-- delayed/import event is recorded as unknown until separately evidenced
-- history exists. Caller payload cannot provide attribution through the normal
-- RPC protocol; privileged SQL is separately trusted authority.
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
  v_event_is_status_change boolean;
  v_event_is_source_timed boolean;
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
    id, identifier, batch_id, client_slug, team, kind, title, brief, status,
    status_at, assignee_id, due_date, priority, file_url, comments, origin,
    card_id, sort_key, sync_state, created_by, created_at, updated_at,
    linear_issue_uuid, linear_identifier, linear_issue_url, linear_aliases,
    linear_raw
  ) values (
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
  v_event_is_status_change := v_old_status is distinct from v_result.status;
  v_event_is_source_timed := v_event ? 'ts' or v_event ? 'source_event_at'
    or coalesce(nullif(v_event->>'source', ''), 'ui') in ('backfill', 'reconcile');

  if v_event_is_status_change and not v_event_is_source_timed then
    perform set_config('app.event_assignee_stamp', 'native-status-v1', true);
    perform set_config('app.event_assignee_id', coalesce(v_result.assignee_id::text, ''), true);
    perform set_config('app.event_assignee_attribution',
      case when v_result.assignee_id is null then 'unassigned' else 'native_transaction' end, true);
  end if;

  insert into public.deliverable_events (
    deliverable_id, batch_id, client_slug, ts, actor, role, action,
    from_status, to_status, source, payload
  ) values (
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

revoke all on function public.deliverable_events_event_assignee_guard()
  from public, anon, authenticated, service_role;

commit;
