-- Draft/unapplied. Replaces TWO routine bodies, adds nothing, grants nothing.
-- The same change PR #1413 made to the native ordinary and native assignment
-- lanes, applied to the third lane it left untouched: the label lane.
--
-- BEFORE THIS, the label lane refused a `test_only` write outright once the
-- capability was `native`, in both layers:
--   production_labels_write             2026-09-06-native-label-writes.sql:132
--   production_native_label_receipt_guard                              ...:101
-- so the test client could never exercise native labels at all, and step 27's
-- "watch real work flow through it" had no TEST lane. The first native label
-- write that could ever succeed was on a real client.
--
-- AFTER IT, each layer RECORDS the value and COMPARES it, exactly as it
-- already does for every other scope field:
--   * the outbox row keeps `test_only` in its own column, as it always did;
--   * production_outbox_replay receives the real value, so a replay whose
--     scope disagrees with the retained receipt raises idempotency_conflict
--     (2026-07-12-write-ui-outbox-parity.sql) -- that IS the compare, and it
--     is what stops a TEST replay adopting a real client's receipt;
--   * production_assert_authority receives the real value, so a TEST write is
--     validated AS a test write -- it requires an active kind='test' client --
--     instead of against the real team's prod_authority.
--
-- legacy_parity is UNTOUCHED in both bodies: both refusals remain, and the
-- authority call still passes a literal false for it. Each half is asserted
-- separately in test/native-label-test-client-parity-contract.js so a later
-- edit cannot widen one while claiming the other.
--
-- AUTH_KIND IS PART OF THE SCOPE, and it was the half this migration first
-- missed. eventFor() emits `auth_kind: principal.kind`
-- (production-write/index.ts:1557), and the TEST principal's kind is `test`,
-- not `staff` (index.ts:1206). Requiring 'staff' therefore refused every real
-- TEST request no matter what test_only said -- so dropping the test_only
-- refusal alone left the lane exactly as unreachable as before. Codex caught
-- this on PR #1414; the first rehearsal missed it by hand-building an event
-- with auth_kind 'staff', which is not what the gateway sends.
--
-- The two are now BOUND, in both directions: auth_kind must be 'test' exactly
-- when test_only is true and 'staff' exactly when it is false. That is exact
-- rather than permissive, because testOnly is true on precisely one principal
-- and that principal's kind is always 'test' (index.ts:1206-1215; every other
-- branch sets testOnly false). A forged event claiming one without the other
-- is refused. test_only must also be a JSON boolean now, which the old
-- `is distinct from 'false'::jsonb` implied for free and the new read does not.
--
-- NOT IN THIS FILE: the gateway's own principal gate, which is a separate
-- commit on this PR because it is the only part needing a production-write
-- deploy.
begin;

create or replace function public.production_native_label_receipt_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_mode jsonb; v_version text;
begin
  if tg_op='DELETE' then
    if old.payload ? '_native_label_catalog_version' then raise exception 'native_label_receipt_retained'; end if;
    return old;
  end if;
  if tg_op='UPDATE' then
    if new.payload->'_native_label_catalog_version' is distinct from old.payload->'_native_label_catalog_version'
       or (old.payload ? '_native_label_catalog_version' and
         (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at')) then raise exception 'idempotency_conflict'; end if;
    return new;
  end if;
  if new.operation is distinct from 'labels' or new.dedup_key not like 'write-ui:labels:deliverable:%' then
    if new.payload ? '_native_label_catalog_version' then raise exception 'native_label_scope_forbidden'; end if;
    return new;
  end if;
  v_mode:=public.production_label_catalog_capability();
  if v_mode->>'mode'='hold' then raise exception 'native_label_catalog_held'; end if;
  if v_mode->>'mode'='provider' then
    if new.payload ? '_native_label_catalog_version' then raise exception 'native_label_catalog_changed'; end if;
    return new;
  end if;
  v_version:=v_mode->>'version_id';
  if new.payload->>'_native_label_catalog_version' is distinct from v_version then raise exception 'native_label_catalog_changed'; end if;
  if new.entity is distinct from 'deliverable' or coalesce(new.role,'') not in ('admin','smm')
     or new.legacy_parity is distinct from false
     or coalesce(new.payload->>'_intent_fingerprint','')='' then raise exception 'native_label_scope_forbidden'; end if;
  perform public.production_assert_authority(new.client_slug,new.team,new.test_only,false);
  perform public.production_label_catalog_read_attested(v_version::uuid,new.team);
  new.status:='skipped'; new.processed_at:=clock_timestamp(); new.next_retry_at:=null; new.last_error:=null;
  new.linear_result:=jsonb_build_object('native_labels',true,'catalog_version',v_version);
  return new;
end; $$;

create or replace function public.production_labels_write(p_row jsonb,p_event jsonb) returns public.deliverables
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_out jsonb:=p_event->'outbound'; v_payload jsonb:=v_out->'payload'; v_mode jsonb;
  v_current public.deliverables; v_receipt public.mirror_outbox; v_selection jsonb; v_raw jsonb;
  v_nodes jsonb; v_ids jsonb; v_read jsonb; v_result public.deliverables;
begin
  if p_event->>'surface' is distinct from 'production'
     or jsonb_typeof(v_out->'test_only') is distinct from 'boolean'
     or p_event->>'auth_kind' is distinct from (case when v_out->'test_only'='true'::jsonb then 'test' else 'staff' end)
     or p_event->>'source' is distinct from 'ui' or p_event->>'action' is distinct from 'labels_change'
     or coalesce(p_event->>'role','') not in ('admin','smm') or coalesce(p_event->>'actor','')=''
     or v_out->>'operation' is distinct from 'labels' or v_out->>'entity' is distinct from 'deliverable'
     or v_out->>'entity_id' is distinct from p_row->>'id'
     or v_out->'legacy_parity' is distinct from 'false'::jsonb
     or coalesce(v_payload->>'_intent_fingerprint','')='' or coalesce(v_out->>'dedup_key','')=''
     or coalesce(p_event->>'expected_updated_at','')='' then raise exception 'native_label_scope_forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_out->>'dedup_key',0));
  select * into v_receipt from public.mirror_outbox where dedup_key=v_out->>'dedup_key';
  -- Only retained native receipts can be adopted before current admission.
  -- This path reads the current scoped result and emits no new event/intent.
  if v_receipt.payload ? '_native_label_catalog_version' and
    public.production_outbox_replay('deliverable',p_row->>'id','labels',p_row->>'client_slug',p_row->>'team',
      p_event->>'actor',p_event->>'role',coalesce((v_out->>'test_only')::boolean,false),false,v_payload->>'_intent_fingerprint',v_out->>'dedup_key') then
    if v_receipt.payload->>'_native_label_catalog_version' is distinct from v_payload->>'_native_label_catalog_version'
       or v_receipt.status is distinct from 'skipped' or v_receipt.linear_result->>'native_labels' is distinct from 'true'
       or v_receipt.linear_result->>'catalog_version' is distinct from v_payload->>'_native_label_catalog_version'
       then raise exception 'idempotency_conflict'; end if;
    select * into v_result from public.deliverables where id=p_row->>'id' and client_slug=p_row->>'client_slug' and team=p_row->>'team';
    if not found then raise exception 'idempotent_result_missing'; end if;
    return v_result;
  end if;
  perform public.production_assert_authority(p_row->>'client_slug',p_row->>'team',coalesce((v_out->>'test_only')::boolean,false),false);
  -- The capability SHARE lock is retained through commit. Concurrent activation
  -- cannot switch the version between validation and the accepted receipt.
  v_mode:=public.production_label_catalog_capability();
  if v_mode->>'mode' is distinct from 'native' then raise exception 'native_label_catalog_held'; end if;
  if v_mode->>'version_id' is distinct from v_payload->>'_native_label_catalog_version' then raise exception 'native_label_catalog_changed'; end if;
  v_read:=public.production_label_catalog_read_attested((v_mode->>'version_id')::uuid,p_row->>'team');
  perform pg_advisory_xact_lock(hashtextextended('production-deliverable:'||(p_row->>'id'),0));
  select * into v_current from public.deliverables where id=p_row->>'id' for update;
  if not found or v_current.client_slug is distinct from p_row->>'client_slug' or v_current.team is distinct from p_row->>'team'
     then raise exception 'native_label_scope_forbidden'; end if;
  if v_current.updated_at is distinct from (p_event->>'expected_updated_at')::timestamptz then raise exception 'write_conflict'; end if;
  v_raw:=v_current.linear_raw; v_nodes:=v_raw->'issue'->'labels'->'nodes';
  if jsonb_typeof(v_nodes) is distinct from 'array' or v_raw->'issue'->'labels'->'pageInfo'->'hasNextPage' is distinct from 'false'::jsonb
     then raise exception 'native_label_state_incomplete'; end if;
  select coalesce(jsonb_agg(n->>'id' order by n->>'id'),'[]'::jsonb) into v_ids from jsonb_array_elements(v_nodes) n;
  if v_raw->'issue' ? 'labelIds' then
    if jsonb_typeof(v_raw->'issue'->'labelIds') is distinct from 'array' or
       (select coalesce(jsonb_agg(n order by n),'[]'::jsonb) from jsonb_array_elements(v_raw->'issue'->'labelIds') n) is distinct from v_ids
       then raise exception 'native_label_state_incomplete'; end if;
  end if;
  -- Match the existing native selected-state presentation: absent/invalid
  -- legacy color uses its documented fallback; missing descriptions are null.
  -- Do not manufacture or drop identities to make validation succeed.
  select coalesce(jsonb_agg(jsonb_build_object('id',btrim(n->>'id'),'name',btrim(n->>'name'),
    'color',case when btrim(n->>'color') ~ '^#[0-9a-fA-F]{6}$' then btrim(n->>'color') else '#5e6ad2' end,
    'description',nullif(btrim(n->>'description'),'')) order by n->>'id'),'[]'::jsonb)
    into v_nodes from jsonb_array_elements(v_nodes) n;
  v_selection:=public.production_label_catalog_validate_selection((v_mode->>'version_id')::uuid,v_current.team,v_nodes,v_payload->'label_ids');
  v_raw:=jsonb_set(v_raw,'{issue}',(v_raw->'issue')||jsonb_build_object('labelIds',v_selection->'selected_label_ids',
    'labels',jsonb_build_object('nodes',v_selection->'selected_labels','pageInfo',jsonb_build_object('hasNextPage',false,'endCursor',null))));
  -- Copy only this owned field from locked current state. Existing writes keep
  -- their event, F27, journal and receipt in this SAME transaction.
  return public.production_deliverable_write(to_jsonb(v_current)||jsonb_build_object('linear_raw',v_raw),p_event);
end; $$;

-- The ACLs these two routines already carry. `create or replace function`
-- preserves them, so this re-states the existing posture rather than changing
-- it: every one of the four roles is named, and only service_role keeps
-- EXECUTE on the writer. The trigger function is reachable only as a trigger.
revoke all on function public.production_labels_write(jsonb,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.production_labels_write(jsonb,jsonb) to service_role;
revoke all on function public.production_native_label_receipt_guard()
  from public, anon, authenticated, service_role;
commit;
