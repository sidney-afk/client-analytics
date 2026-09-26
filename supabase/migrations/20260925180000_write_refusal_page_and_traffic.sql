-- Refusal-log triage 2026-09-25 (OPEN_REPAIRS): the log could not tell a real
-- client or staff member from our own tests without joining request logs by
-- minute. Two optional receipt fields close that:
--   claimed_page  browser_claim only: the page SAYS it is a client link or a
--                 staff page. Unverified, like every browser claim.
--   traffic       set server-side from the request's user agent (or an explicit
--                 automation header): 'automation' for headless browsers, curl
--                 and scripts (CI, executor sessions), else 'person'.
-- Both are optional so functions deployed before this migration keep
-- recording with the original 9-key shape. Apply THIS before deploying the
-- write-diagnostics and production-write functions that send the new keys.
-- No business rows, text, credentials or raw payloads are stored.
begin;
alter table write_refusal_diagnostics.receipts_v1
  add column if not exists claimed_page text check (claimed_page in ('client_link','staff_page')),
  add column if not exists traffic text check (traffic in ('person','automation'));
create index if not exists receipts_v1_traffic_recorded_at on write_refusal_diagnostics.receipts_v1(traffic, recorded_at);

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
  if (to_jsonb(prior)-'recorded_at'-'claimed_page'-'traffic') is distinct from base
     or prior.claimed_page is distinct from v_page or prior.traffic is distinct from v_traffic then raise exception 'refusal_attempt_conflict';end if;
  return jsonb_build_object('recorded',true,'duplicate',true);
 end if;
 if (select count(*) from write_refusal_diagnostics.receipts_v1 where recorded_at>=clock_timestamp()-interval '1 minute' and receipts_v1.origin=v_origin)>=(case when v_origin='browser_claim' then 100 else 1000 end) then raise exception 'refusal_rate_limited';end if;
 insert into write_refusal_diagnostics.receipts_v1(attempt_id,origin,surface,operation,code,status,principal_kind,member_id,identifiers,claimed_page,traffic)
 values(id,v_origin,p_receipt->>'surface',p_receipt->>'operation',p_receipt->>'code',(p_receipt->>'status')::integer,p_receipt->>'principal_kind',(p_receipt->>'member_id')::uuid,p_receipt->'identifiers',v_page,v_traffic);
 return jsonb_build_object('recorded',true,'duplicate',false);
end $fn$;

revoke all on function public.production_write_refusal_record_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.production_write_refusal_record_v1(jsonb) to service_role;
revoke all on write_refusal_diagnostics.receipts_v1 from public,anon,authenticated,service_role;
commit;
