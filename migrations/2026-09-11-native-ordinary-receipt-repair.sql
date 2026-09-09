-- Successor repair for the dormant ordinary receipt contract.  Do not enable
-- native mode until this migration and its PostgreSQL proof have run.
begin;

-- The BEFORE INSERT classifier knows NEW.id, but the parent row is not visible
-- to an immediate FK check yet.  Keep the immutable admission evidence and
-- defer only the receipt attachment until the owning row/event transaction
-- commits; a rollback leaves neither row.
alter table public.production_native_ordinary_receipt_admissions
  drop constraint if exists production_native_ordinary_receipt_admissions_receipt_id_fkey;
alter table public.production_native_ordinary_receipt_admissions
  add constraint production_native_ordinary_receipt_admissions_receipt_id_fkey
  foreign key (receipt_id) references public.mirror_outbox(id)
  deferrable initially deferred;

-- Provider mode is a strict compatibility lane. TEST and legacy-parity values
-- are rejected only when an actual native receipt would be minted.
create or replace function public.production_native_ordinary_event(p_event jsonb,p_expected jsonb)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_event jsonb:=coalesce(p_event,'{}'::jsonb); v_out jsonb:=coalesce(v_event->'outbound','{}'::jsonb);
 v_payload jsonb:=coalesce(v_out->'payload','{}'::jsonb); v_cap jsonb; v_token uuid:=gen_random_uuid();
 v_owner text:=p_expected->>'owner'; v_native text:=p_expected->>'native_operation';
begin
  if v_payload ? '_native_ordinary_receipt' then raise exception 'native_ordinary_receipt_marker_forbidden'; end if;
  -- This is intentionally before TEST/parity and detailed owner validation:
  -- default provider behavior must remain byte-for-byte compatible.
  v_cap:=public.production_native_ordinary_capability(p_expected->>'team');
  if v_cap->>'mode'='provider' then return v_event; end if;
  if v_cap->>'mode'='hold' then raise exception 'native_ordinary_receipt_held'; end if;
  if v_owner not in ('deliverable','comment') or coalesce(v_native,'')=''
     or p_expected->>'entity' is distinct from v_out->>'entity'
     or p_expected->>'entity_id' is distinct from v_out->>'entity_id'
     or p_expected->>'receipt_operation' is distinct from v_out->>'operation'
     or p_expected->>'client_slug' is distinct from coalesce(v_out->>'client_slug',p_expected->>'client_slug')
     or p_expected->>'team' is distinct from v_out->>'team'
     or p_expected->>'actor' is distinct from v_event->>'actor'
     or p_expected->>'role' is distinct from v_event->>'role'
     or coalesce(v_out->>'dedup_key','')='' or coalesce(v_payload->>'_intent_fingerprint','')=''
     or coalesce((v_out->>'test_only')::boolean,false) or coalesce((v_out->>'legacy_parity')::boolean,false)
  then raise exception 'native_ordinary_receipt_scope_forbidden'; end if;
  insert into public.production_native_ordinary_receipt_admissions(
    token,epoch,owner,entity,entity_id,receipt_operation,native_operation,client_slug,team,actor,role,dedup_key,intent_fingerprint,source_edited_at)
  values(v_token,v_cap->>'epoch',v_owner,p_expected->>'entity',p_expected->>'entity_id',p_expected->>'receipt_operation',v_native,
    p_expected->>'client_slug',p_expected->>'team',p_expected->>'actor',p_expected->>'role',v_out->>'dedup_key',v_payload->>'_intent_fingerprint',
    (v_out->>'source_edited_at')::timestamptz);
  return jsonb_set(v_event,'{outbound,payload}',v_payload||jsonb_build_object('_native_ordinary_receipt',
    jsonb_build_object('schema',1,'epoch',v_cap->>'epoch','owner',v_owner,'operation',v_native,'token',v_token::text)),true);
end $fn$;
revoke all on function public.production_native_ordinary_event(jsonb,jsonb) from public,anon,authenticated,service_role;
commit;
