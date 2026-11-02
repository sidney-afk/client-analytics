-- ef-auto-deploy: functions-cope-without-this
-- OPEN_REPAIRS 642 (session Reviewguard, 2026-11-02): a report from the Workload calendar is stored as surface
-- 'workload' instead of 'unknown'.
--   1. write_refusal_diagnostics.receipts_v1.surface also takes 'workload';
--   2. the staff "Save problems" list (production_write_refusal_list_v1) can filter by it.
-- write-diagnostics copes without this: a receipt the table refuses for its surface is recorded again as 'unknown',
-- as before, so no report is lost before this is applied.
-- Rows already stored are left as they are (Workload reports before this read 'unknown'; their board says workload).

alter table write_refusal_diagnostics.receipts_v1 drop constraint if exists receipts_v1_surface_check;
alter table write_refusal_diagnostics.receipts_v1 add constraint receipts_v1_surface_check
  check (surface in ('calendar','sxr','production','workload','unknown'));

create or replace function public.production_write_refusal_list_v1(p_days integer default 7, p_include_automation boolean default false, p_limit integer default 200, p_surface text default null, p_page text default null)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog', 'public' as $function$
declare v_days integer:=least(greatest(coalesce(p_days,7),1),30); v_limit integer:=least(greatest(coalesce(p_limit,200),1),500);
 v_auto boolean:=coalesce(p_include_automation,false); v_surface text:=nullif(p_surface,''); v_page text:=nullif(p_page,'');
begin
 if v_surface is not null and v_surface not in ('calendar','sxr','production','workload','unknown') then raise exception 'refusal_list_surface';end if;
 if v_page is not null and v_page not in ('client_link','staff_page','unknown') then raise exception 'refusal_list_page';end if;
 return (with base as (
   select r.*,
     case when r.origin='browser_claim' then coalesce(r.claimed_page,'unknown') when r.principal_kind='client' then 'client_link' when r.principal_kind in ('staff','test') then 'staff_page' else 'unknown' end as page
   from write_refusal_diagnostics.receipts_v1 r
   where r.recorded_at>=now()-make_interval(days=>v_days)
     and (v_surface is null or r.surface=v_surface)),
  shown as (select * from base where (v_auto or traffic is distinct from 'automation') and (v_page is null or page=v_page))
  select jsonb_build_object(
   'days',v_days,'include_automation',v_auto,'surface',v_surface,'page',v_page,
   'total',(select count(*) from shown),
   'hidden_automation',(select count(*) from base where traffic='automation' and (v_page is null or page=v_page)),
   'rows',(select coalesce(jsonb_agg(to_jsonb(x) order by x.recorded_at desc),'[]'::jsonb) from (
     select recorded_at,origin,surface,operation,ui_action,code,status,page,staff_role,card_ref,left(identifiers->>'client_slug',12) as client_ref,
       detail,browser,os,app_version,coalesce(traffic,'unknown') as traffic,attempts
     from shown order by recorded_at desc limit v_limit) x)));
end $function$;

revoke all on function public.production_write_refusal_list_v1(integer,boolean,integer,text,text) from public, anon, authenticated, service_role;
grant execute on function public.production_write_refusal_list_v1(integer,boolean,integer,text,text) to service_role;
