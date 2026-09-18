-- Draft/unapplied. Replaces ONE routine body, adds nothing, grants nothing.
--
-- The assignment lane's half of the defect Codex found on PR #1414. That PR
-- fixed the label lane; this is the same binding for the lane #1413 left
-- carrying it, so the test client can reach this one through the real gateway
-- too.
--
-- WHAT WAS WRONG. #1413 made production_assignee_write stop refusing test_only
-- and pass the real value to production_assert_authority -- but left
--   p_event->>'auth_kind' is distinct from 'staff'
-- standing (2026-09-18-native-test-client-parity.sql:258). eventFor emits
-- `auth_kind: principal.kind` (production-write/index.ts:1557) and the TEST
-- principal's kind is `test`, not `staff` (index.ts:1206), so a real TEST
-- assignment request was refused one layer later with assignment_scope_forbidden
-- regardless of test_only. The parity was unreachable through the gateway.
--
-- It went unnoticed because #1413's rehearsal hand-built its event with
-- auth_kind 'staff', which is not a request the gateway can send, and because
-- the nightly drill never gets far enough to exercise it -- it stops earlier at
-- `TEST override project mismatch`.
--
-- THE FIX binds the two fields rather than widening either: auth_kind must be
-- 'test' exactly when test_only is true and 'staff' exactly when it is false,
-- in both directions. Merely allowing auth_kind in ('staff','test') would make
-- "auth_kind": "test" a way to write as the test client while skipping the
-- authority check that goes with it. This is safe to state exactly because
-- testOnly is true on precisely one principal and that principal's kind is
-- always 'test'; every other branch of authenticate() sets testOnly false.
--
-- test_only must now also be a JSON boolean. Every gateway caller already
-- builds it as one (index.ts:1979, 2402, 4061, 5269, 5396 and siblings), and
-- the old `coalesce((v_out->>'test_only')::boolean,false)` would have accepted
-- the string "true" while the new comparison would not -- so requiring the type
-- keeps the two readings of the same field from diverging.
--
-- NOTHING ELSE IN THE LANE CHANGES. production_assignment_context does not gate
-- on auth_kind at all -- checked, rather than assumed, because an earlier read
-- of this file suggested it did -- and legacy_parity is untouched: the literal
-- false in the authority call stands.
begin;

create or replace function public.production_assignee_write(p_row jsonb,p_event jsonb) returns public.deliverables
language plpgsql security definer set search_path=public as $$
declare v_out jsonb:=p_event->'outbound'; v_payload jsonb:=v_out->'payload'; v_context jsonb;
 v_current public.deliverables; v_member public.team_members; v_result public.deliverables;
 v_assignee text:=nullif(btrim(p_row->>'assignee_id'),''); v_expected jsonb;
begin
  if p_event->>'surface' is distinct from 'production'
     or jsonb_typeof(v_out->'test_only') is distinct from 'boolean'
     or p_event->>'auth_kind' is distinct from (case when v_out->'test_only'='true'::jsonb then 'test' else 'staff' end)
     or p_event->>'source' is distinct from 'ui' or p_event->>'action' is distinct from 'assignee_change'
     or v_out->>'operation' is distinct from 'assignee' or v_out->>'entity' is distinct from 'deliverable'
     or v_out->>'entity_id' is distinct from p_row->>'id'
     or v_payload->>'assignee_id' is distinct from v_assignee
     or coalesce(p_event->>'expected_updated_at','')=''
     or coalesce(v_payload->>'_native_assignment_epoch','')='' then raise exception 'assignment_scope_forbidden'; end if;
  perform public.production_assert_authority(p_row->>'client_slug',p_row->>'team',
    coalesce((v_out->>'test_only')::boolean,false),false);
  -- Match the established dedup -> deliverable lock order; the epoch's SHARE
  -- lock then remains held through eligibility, event and outbox insertion.
  perform pg_advisory_xact_lock(hashtextextended(v_out->>'dedup_key',0));
  v_expected := jsonb_build_object('entity','deliverable','entity_id',p_row->>'id','operation','assignee',
    'client_slug',p_row->>'client_slug','team',p_row->>'team','actor',p_event->>'actor','role',p_event->>'role',
    'test_only',v_out->'test_only','legacy_parity',v_out->'legacy_parity',
    'dedup_key',v_out->>'dedup_key','intent_fingerprint',v_payload->>'_intent_fingerprint');
  v_context := public.production_assignment_context(v_expected);
  if v_context->>'epoch' is distinct from v_payload->>'_native_assignment_epoch' then
    raise exception 'assignment_authority_unavailable'; end if;
  if v_context->>'replay'='true' then
    return public.production_deliverable_write(p_row,p_event);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('production-deliverable:'||(p_row->>'id'),0));
  select * into v_current from public.deliverables where id=p_row->>'id' for update;
  if not found or v_current.client_slug is distinct from p_row->>'client_slug'
     or v_current.team is distinct from p_row->>'team' then raise exception 'assignment_scope_forbidden'; end if;
  if v_current.updated_at is distinct from (p_event->>'expected_updated_at')::timestamptz then raise exception 'write_conflict'; end if;
  if v_assignee is not null then
    select * into v_member from public.team_members where id::text=v_assignee for share;
    if not found or v_member.active is distinct from true or v_member.team is distinct from v_current.team then
      raise exception 'assignee_out_of_scope'; end if;
    if lower(v_member.role) is distinct from (case v_current.team when 'video' then 'editor' when 'graphics' then 'designer' end) then
      raise exception 'assignee_role_incompatible'; end if;
  end if;
  -- The wrapper changes only its owned column. The existing RPC retains CAS,
  -- events, journal triggers, dedup and F27 enqueue as one transaction.
  v_result := public.production_deliverable_write(to_jsonb(v_current)||jsonb_build_object('assignee_id',v_assignee),p_event);
  return v_result;
end; $$;

-- The ACL this routine already carries, re-stated rather than changed. All four
-- roles named so the posture is a statement, not an omission.
revoke all on function public.production_assignee_write(jsonb,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.production_assignee_write(jsonb,jsonb) to service_role;
commit;
