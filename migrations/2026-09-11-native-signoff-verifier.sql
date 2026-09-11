-- Preparation only. Read-only attestation of admitted native client approvals.
-- Historical epochs remain valid evidence; this does not authorize a new write.
begin;
create or replace function public.production_native_signoff_verify(p_receipt_ids text[])
returns table(receipt_id text, verified boolean, entity_id text, client_slug text, source_edited_at timestamptz)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $fn$
declare v_id text;
begin
 if p_receipt_ids is null or cardinality(p_receipt_ids) not between 1 and 200
    or array_ndims(p_receipt_ids) is distinct from 1
    or (select count(distinct x) from unnest(p_receipt_ids) x) <> cardinality(p_receipt_ids) then
  raise exception 'native_signoff_receipt_ids_invalid';
 end if;
 foreach v_id in array p_receipt_ids loop
  if v_id is null or v_id !~ '^[1-9][0-9]{0,18}$' then
   raise exception 'native_signoff_receipt_ids_invalid';
  end if;
  if v_id::numeric > 9223372036854775807::numeric then
   raise exception 'native_signoff_receipt_ids_invalid';
  end if;
 end loop;
 return query
 with requested as (select x.id, x.ordinality from unnest(p_receipt_ids) with ordinality x(id,ordinality)),
 checked as (
 select r.id,r.ordinality,o.entity_id as bound_entity,o.client_slug as bound_client,o.source_edited_at as bound_clock,
 coalesce(
 o.status='skipped' and o.entity='deliverable' and o.operation='status'
 and jsonb_typeof(o.payload)='object' and o.payload->>'status'='approved'
 and o.role='client' and o.test_only=false and o.legacy_parity=false
 and jsonb_typeof(o.payload->'_native_ordinary_receipt')='object'
 and o.payload->'_native_ordinary_receipt'->'schema'='1'::jsonb
 and o.payload->'_native_ordinary_receipt'->>'owner'='deliverable'
 and o.payload->'_native_ordinary_receipt'->>'operation'='status'
 and o.payload->'_native_ordinary_receipt'->>'epoch'=a.epoch
 and a.owner='deliverable' and a.entity='deliverable'
 and a.native_operation='status' and a.receipt_operation='status'
 and a.entity_id=o.entity_id and a.client_slug=o.client_slug and a.team=o.team
 and a.actor=o.actor and a.role=o.role and a.test_only=false and a.legacy_parity=false
 and a.dedup_key=o.dedup_key and a.intent_fingerprint=o.payload->>'_intent_fingerprint'
 and a.source_edited_at=o.source_edited_at
 and jsonb_typeof(o.linear_result)='object'
 and o.linear_result->'native_ordinary'='true'::jsonb
 and o.linear_result->>'epoch'=a.epoch and o.linear_result->>'owner'=a.owner
 and o.linear_result->>'operation'=a.native_operation
 ,false) as valid
 from requested r left join public.mirror_outbox o on o.id=r.id::bigint
 left join public.production_native_ordinary_receipt_admissions a
   on a.receipt_id=o.id and a.token::text=o.payload->'_native_ordinary_receipt'->>'token'
 )
 select c.id,c.valid,case when c.valid then c.bound_entity end,
 case when c.valid then c.bound_client end,case when c.valid then c.bound_clock end
 from checked c order by c.ordinality;
end;
$fn$;
revoke all on function public.production_native_signoff_verify(text[]) from public,anon,authenticated,service_role;
grant execute on function public.production_native_signoff_verify(text[]) to service_role;
commit;
