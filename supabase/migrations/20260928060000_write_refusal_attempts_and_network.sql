-- OPEN_REPAIRS 101 release A, follow-up (session Sentinel, 2026-09-28): the
-- live proof on the test client found four gaps; three need the database.
--
--   attempts   one row per click. The page now sends ONE attempt id for a save
--              and its automatic retries; a retry is a duplicate of the first
--              row and bumps this count instead of adding a row (measured
--              2026-09-28: one failed click made three rows).
--   status     may be empty. A save that never reached a server has no HTTP
--              status; the log used to invent 500 for it.
--   code       gains 'network_failure' for exactly that case (it used to read
--              'browser_refusal', which looks like a refusal).
--
-- The client reference needs no change: client-link records now carry the
-- same one-way hash of the client that production-write receipts carry.
--
-- v1 is re-issued once more with one line changed (its replay comparison
-- leaves out `attempts`, or every replay would read as a conflict); v2 and the
-- list are re-issued to count attempts and return the count. Signatures and
-- grants are unchanged. Apply BEFORE deploying the matching write-diagnostics
-- (that function sends status null and the new code, which this allows).
begin;
alter table write_refusal_diagnostics.receipts_v1
  add column if not exists attempts integer not null default 1 check (attempts between 1 and 10000);
alter table write_refusal_diagnostics.receipts_v1 alter column status drop not null;

-- Widen the code rule by one value without re-typing the ~190 existing codes:
-- read the current rule and OR the new code onto it. Safe to re-apply.
do $do$
declare def text;
begin
 select pg_get_constraintdef(oid) into def from pg_constraint
  where conrelid='write_refusal_diagnostics.receipts_v1'::regclass and conname='receipts_v1_code_check';
 if def is null then raise exception 'receipts_v1_code_check missing'; end if;
 if position('network_failure' in def)=0 then
  execute 'alter table write_refusal_diagnostics.receipts_v1 drop constraint receipts_v1_code_check';
  execute 'alter table write_refusal_diagnostics.receipts_v1 add constraint receipts_v1_code_check check (('
    || substring(def from '^CHECK \((.*)\)$') || ') or code = ''network_failure'')';
 end if;
end $do$;

create or replace function public.production_write_refusal_record_v1(p_receipt jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare id uuid; prior write_refusal_diagnostics.receipts_v1%rowtype; k text; v jsonb; v_origin text;
 base jsonb; v_page text; v_traffic text;
begin
 if jsonb_typeof(p_receipt) is distinct from 'object' then raise exception 'refusal_shape';end if;
 -- The original nine keys are required; claimed_page and traffic are optional.
 base:=p_receipt-'claimed_page'-'traffic';
 if (select array_agg(key order by key) from jsonb_object_keys(base) key) is distinct from array['attempt_id','code','identifiers','member_id','operation','origin','principal_kind','status','surface']::text[] then raise exception 'refusal_shape';end if;
 id:=(p_receipt->>'attempt_id')::uuid;v_origin:=p_receipt->>'origin';
 v_page:=nullif(p_receipt->>'claimed_page','');v_traffic:=nullif(p_receipt->>'traffic','');
 if p_receipt ? 'claimed_page' and jsonb_typeof(p_receipt->'claimed_page') not in ('string','null') then raise exception 'refusal_shape';end if;
 if p_receipt ? 'traffic' and jsonb_typeof(p_receipt->'traffic') not in ('string','null') then raise exception 'refusal_shape';end if;
 if v_page is not null and v_page not in ('client_link','staff_page') then raise exception 'refusal_claimed_page';end if;
 if v_traffic is not null and v_traffic not in ('person','automation') then raise exception 'refusal_traffic';end if;
 -- The gateway knows its principal; only a browser claim may state a page.
 if v_page is not null and v_origin<>'browser_claim' then raise exception 'refusal_claimed_page';end if;
 if id is null or jsonb_typeof(p_receipt->'identifiers') is distinct from 'object' then raise exception 'refusal_identifiers';end if;
 for k,v in select * from jsonb_each(p_receipt->'identifiers') loop
  if k not in ('id','client_slug','card','component','comment','parent','request_id') or jsonb_typeof(v) is distinct from 'string' or (v#>>'{}') !~ '^[a-f0-9]{64}$' then raise exception 'refusal_identifier_shape';end if;
 end loop;
 if v_origin='browser_claim' and (p_receipt->>'principal_kind'<>'unverified' or p_receipt->'member_id'<>'null'::jsonb) then raise exception 'refusal_browser_principal';end if;
 perform pg_advisory_xact_lock(19370101,101);
 select * into prior from write_refusal_diagnostics.receipts_v1 where attempt_id=id;
 if found then
  if (to_jsonb(prior)-'recorded_at'-'claimed_page'-'traffic'-'card_ref'-'ui_action'-'detail'-'browser'-'os'-'app_version'-'staff_role'-'attempts') is distinct from base
     or prior.claimed_page is distinct from v_page or prior.traffic is distinct from v_traffic then raise exception 'refusal_attempt_conflict';end if;
  return jsonb_build_object('recorded',true,'duplicate',true);
 end if;
 if (select count(*) from write_refusal_diagnostics.receipts_v1 where recorded_at>=clock_timestamp()-interval '1 minute' and receipts_v1.origin=v_origin)>=(case when v_origin='browser_claim' then 100 else 1000 end) then raise exception 'refusal_rate_limited';end if;
 insert into write_refusal_diagnostics.receipts_v1(attempt_id,origin,surface,operation,code,status,principal_kind,member_id,identifiers,claimed_page,traffic)
 values(id,v_origin,p_receipt->>'surface',p_receipt->>'operation',p_receipt->>'code',(p_receipt->>'status')::integer,p_receipt->>'principal_kind',(p_receipt->>'member_id')::uuid,p_receipt->'identifiers',v_page,v_traffic);
 return jsonb_build_object('recorded',true,'duplicate',false);
end $fn$;

create or replace function public.production_write_refusal_record_browser_v2(p_receipt jsonb, p_detail jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare v_result jsonb; v_id uuid; k text;
 v_card text; v_action text; v_detail text; v_browser text; v_os text; v_version text; v_role text;
begin
 if jsonb_typeof(p_receipt) is distinct from 'object' or p_receipt->>'origin' is distinct from 'browser_claim' then raise exception 'refusal_shape';end if;
 if jsonb_typeof(p_detail) is distinct from 'object' then raise exception 'refusal_detail_shape';end if;
 for k in select jsonb_object_keys(p_detail) loop
  if k not in ('card_ref','ui_action','detail','browser','os','app_version','staff_role') or jsonb_typeof(p_detail->k) not in ('string','null') then raise exception 'refusal_detail_shape';end if;
 end loop;
 v_card:=nullif(p_detail->>'card_ref','');v_action:=nullif(p_detail->>'ui_action','');
 v_detail:=write_refusal_diagnostics.clean_detail_v1(p_detail->>'detail');
 v_browser:=nullif(p_detail->>'browser','');v_os:=nullif(p_detail->>'os','');
 v_version:=nullif(p_detail->>'app_version','');v_role:=nullif(p_detail->>'staff_role','');
 -- Every existing check (shape, codes, identifiers, rate limit, replay) runs first.
 v_result:=public.production_write_refusal_record_v1(p_receipt);
 v_id:=(p_receipt->>'attempt_id')::uuid;
 -- A replay keeps the detail it was first recorded with.
 update write_refusal_diagnostics.receipts_v1 set card_ref=v_card,ui_action=v_action,detail=v_detail,browser=v_browser,os=v_os,app_version=v_version,staff_role=v_role
  where attempt_id=v_id and not coalesce((v_result->>'duplicate')::boolean,false);
 -- A retry of the same save (same attempt id from the page) attaches to the
 -- first record: one row per click, with a count of how many tries it took.
 if coalesce((v_result->>'duplicate')::boolean,false) then
  update write_refusal_diagnostics.receipts_v1 set attempts=least(attempts+1,10000) where attempt_id=v_id;
 end if;
 return v_result;
end $fn$;

create or replace function public.production_write_refusal_list_v1(p_days integer default 7, p_include_automation boolean default false, p_limit integer default 200, p_surface text default null, p_page text default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
declare v_days integer:=least(greatest(coalesce(p_days,7),1),30); v_limit integer:=least(greatest(coalesce(p_limit,200),1),500);
 v_auto boolean:=coalesce(p_include_automation,false); v_surface text:=nullif(p_surface,''); v_page text:=nullif(p_page,'');
begin
 if v_surface is not null and v_surface not in ('calendar','sxr','production','unknown') then raise exception 'refusal_list_surface';end if;
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
end $fn$;

revoke all on function public.production_write_refusal_record_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.production_write_refusal_record_v1(jsonb) to service_role;
revoke all on function public.production_write_refusal_record_browser_v2(jsonb,jsonb),public.production_write_refusal_list_v1(integer,boolean,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.production_write_refusal_record_browser_v2(jsonb,jsonb),public.production_write_refusal_list_v1(integer,boolean,integer,text,text) to service_role;
revoke all on write_refusal_diagnostics.receipts_v1 from public,anon,authenticated,service_role;
commit;
