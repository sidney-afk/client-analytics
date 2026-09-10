-- Applied after the dormant retirement admission migration.  It extends only
-- the native recognizer; activation remains intentionally blocked there.
begin;
do $preflight$
begin
 if to_regprocedure('public.production_syncview_retirement_typed_native_receipt(public.mirror_outbox)') is null
    or to_regclass('public.production_native_ordinary_receipt_admissions') is null then
   raise exception 'syncview_retirement_native_ordinary_prerequisite_missing';
 end if;
end $preflight$;
create or replace function public.production_syncview_retirement_typed_native_receipt(p_row public.mirror_outbox)
returns boolean language sql immutable set search_path=public as $fn$
 select (
   p_row.operation='create' and coalesce(p_row.payload->>'_native_intake_epoch','')<>'' and coalesce(p_row.payload->>'_native_intake_request','')<>'' and p_row.status='skipped' and p_row.linear_result->>'native_only'='true' and p_row.linear_result->>'epoch'=p_row.payload->>'_native_intake_epoch'
 ) or (
   p_row.operation='assignee' and coalesce(p_row.payload->>'_native_assignment_epoch','')<>'' and p_row.status='skipped' and p_row.linear_result->>'native_assignment'='true' and p_row.linear_result->>'epoch'=p_row.payload->>'_native_assignment_epoch'
 ) or (
   p_row.operation='labels' and coalesce(p_row.payload->>'_native_label_catalog_version','') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and p_row.status='skipped' and p_row.linear_result->>'native_labels'='true' and p_row.linear_result->>'catalog_version'=p_row.payload->>'_native_label_catalog_version'
 ) or (
   jsonb_typeof(p_row.payload->'_native_ordinary_receipt')='object'
   and p_row.payload->'_native_ordinary_receipt'->'schema'='1'::jsonb
   and coalesce(p_row.payload->'_native_ordinary_receipt'->>'epoch','') ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
   and coalesce(p_row.payload->'_native_ordinary_receipt'->>'token','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and p_row.status='skipped' and p_row.linear_result->>'native_ordinary'='true'
   and p_row.linear_result->>'epoch'=p_row.payload->'_native_ordinary_receipt'->>'epoch'
   and p_row.linear_result->>'owner'=p_row.payload->'_native_ordinary_receipt'->>'owner'
   and p_row.linear_result->>'operation'=p_row.payload->'_native_ordinary_receipt'->>'operation'
   and (
     (p_row.payload->'_native_ordinary_receipt'->>'owner'='deliverable'
       and p_row.entity='deliverable'
       and p_row.operation=p_row.payload->'_native_ordinary_receipt'->>'operation'
       and p_row.operation in ('status','due','title','priority','archive','restore','parent','description','attachment'))
     or (p_row.payload->'_native_ordinary_receipt'->>'owner'='comment'
       and p_row.entity='comment' and p_row.operation='comment'
       and p_row.payload->'_native_ordinary_receipt'->>'operation' in ('comment','edit','delete','resolve','unresolve'))
   )
 );
$fn$;
commit;
