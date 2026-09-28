-- OPEN_REPAIRS 101, release A (session Sentinel, 2026-09-27): make the refusal
-- log readable by staff. Browser claims gain optional detail fields, staff get
-- one read that lists recent refusals, and the 30-day cleanup finally runs on
-- a schedule (measured 2026-09-27: no cron job called the retention function).
--
-- New optional columns (browser claims only; gateway receipts leave them null
-- until production-write is re-released in a later, separate step):
--   card_ref     the card or deliverable id, readable (ids only, never names).
--                The client link stays a one-way hash inside `identifiers`.
--   ui_action    the page's own name for the action (approve, comment, ...).
--   detail       the error message, trimmed to 200 characters. Emails, web
--                addresses, long token-like strings and long digit runs are
--                replaced with [redacted] HERE, so no caller can skip it.
--   browser, os  coarse families parsed from the user agent by the function.
--   app_version  the served page's last-modified stamp.
--   staff_role   set only when the function VERIFIED the staff key; a page
--                cannot claim a role.
--
-- The deployed gateway keeps recording through production_write_refusal_record_v1
-- (re-issued below with one line changed). The new record function reuses it for every check it
-- already makes (shape, codes, rate limit, duplicates) and then adds the
-- detail fields to the same row.
-- Nothing here is readable from a browser: every function is service_role
-- only, and the table stays revoked from all four roles.
begin;
alter table write_refusal_diagnostics.receipts_v1
  add column if not exists card_ref text check (card_ref ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  add column if not exists ui_action text check (ui_action ~ '^[a-z0-9_]{1,40}$'),
  add column if not exists detail text check (char_length(detail) <= 200),
  add column if not exists browser text check (browser in ('chrome','edge','safari','firefox','samsung','other')),
  add column if not exists os text check (os in ('windows','mac','ios','android','linux','other')),
  add column if not exists app_version text check (app_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$'),
  add column if not exists staff_role text check (staff_role in ('admin','smm','creative'));
create index if not exists receipts_v1_recorded_at_desc on write_refusal_diagnostics.receipts_v1(recorded_at desc);

-- production_write_refusal_record_v1 is re-issued UNCHANGED except for one
-- line: its replay check compares the stored row with the incoming receipt,
-- so the seven new columns must be left out of that comparison or every
-- replay (gateway ones included) would read as a conflict. Found by
-- test/write-refusal-detail-viewer-postgres.js before this was ever applied.
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
  if (to_jsonb(prior)-'recorded_at'-'claimed_page'-'traffic'-'card_ref'-'ui_action'-'detail'-'browser'-'os'-'app_version'-'staff_role') is distinct from base
     or prior.claimed_page is distinct from v_page or prior.traffic is distinct from v_traffic then raise exception 'refusal_attempt_conflict';end if;
  return jsonb_build_object('recorded',true,'duplicate',true);
 end if;
 if (select count(*) from write_refusal_diagnostics.receipts_v1 where recorded_at>=clock_timestamp()-interval '1 minute' and receipts_v1.origin=v_origin)>=(case when v_origin='browser_claim' then 100 else 1000 end) then raise exception 'refusal_rate_limited';end if;
 insert into write_refusal_diagnostics.receipts_v1(attempt_id,origin,surface,operation,code,status,principal_kind,member_id,identifiers,claimed_page,traffic)
 values(id,v_origin,p_receipt->>'surface',p_receipt->>'operation',p_receipt->>'code',(p_receipt->>'status')::integer,p_receipt->>'principal_kind',(p_receipt->>'member_id')::uuid,p_receipt->'identifiers',v_page,v_traffic);
 return jsonb_build_object('recorded',true,'duplicate',false);
end $fn$;

-- The one place an error message is cleaned. Order matters: emails and web
-- addresses first, then anything that still looks like a key or token.
create or replace function write_refusal_diagnostics.clean_detail_v1(p text)
returns text language sql immutable set search_path=pg_catalog as $fn$
 select nullif(left(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
   coalesce(p,''),
   '[[:cntrl:]]+', ' ', 'g'),
   '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+', '[redacted]', 'g'),
   '(https?://|www\.)[^[:space:]]+', '[redacted]', 'g'),
   '[A-Za-z0-9_+/=.-]{24,}', '[redacted]', 'g'),
   '[0-9]{7,}', '[redacted]', 'g')), 200), '')
$fn$;

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
 return v_result;
end $fn$;

-- Staff list: newest first, automation hidden unless asked for. The client
-- link appears only as the first 12 characters of its hash, enough to group a
-- client's refusals together and to look one up, not to name anyone.
create or replace function public.production_write_refusal_list_v1(p_days integer default 7, p_include_automation boolean default false, p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
declare v_days integer:=least(greatest(coalesce(p_days,7),1),30); v_limit integer:=least(greatest(coalesce(p_limit,200),1),500);
begin
 return jsonb_build_object(
  'days',v_days,'include_automation',coalesce(p_include_automation,false),
  'total',(select count(*) from write_refusal_diagnostics.receipts_v1 r where r.recorded_at>=now()-make_interval(days=>v_days) and (coalesce(p_include_automation,false) or r.traffic is distinct from 'automation')),
  'hidden_automation',(select count(*) from write_refusal_diagnostics.receipts_v1 r where r.recorded_at>=now()-make_interval(days=>v_days) and r.traffic='automation'),
  'rows',(select coalesce(jsonb_agg(to_jsonb(x) order by x.recorded_at desc),'[]'::jsonb) from (
    select r.recorded_at,r.origin,r.surface,r.operation,r.ui_action,r.code,r.status,
      case when r.origin='browser_claim' then coalesce(r.claimed_page,'unknown') when r.principal_kind='client' then 'client_link' when r.principal_kind in ('staff','test') then 'staff_page' else 'unknown' end as page,
      r.staff_role,r.card_ref,left(r.identifiers->>'client_slug',12) as client_ref,
      r.detail,r.browser,r.os,r.app_version,coalesce(r.traffic,'unknown') as traffic
    from write_refusal_diagnostics.receipts_v1 r
    where r.recorded_at>=now()-make_interval(days=>v_days) and (coalesce(p_include_automation,false) or r.traffic is distinct from 'automation')
    order by r.recorded_at desc limit v_limit) x));
end $fn$;

-- Daily cleanup: the existing retention function deletes 1,000 rows per call,
-- so this repeats it until a call comes back short (at most 200 calls).
create or replace function public.production_write_refusal_retention_daily_v1()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare n integer; total integer:=0; i integer:=0;
begin
 loop
  n:=coalesce((public.production_write_refusal_retention_v1()->>'deleted')::integer,0);
  total:=total+n;i:=i+1;
  exit when n<1000 or i>=200;
 end loop;
 return jsonb_build_object('deleted',total,'calls',i,'retention_days',30);
end $fn$;

revoke all on function write_refusal_diagnostics.clean_detail_v1(text) from public,anon,authenticated,service_role;
revoke all on function public.production_write_refusal_record_browser_v2(jsonb,jsonb),public.production_write_refusal_list_v1(integer,boolean,integer),public.production_write_refusal_retention_daily_v1() from public,anon,authenticated,service_role;
grant execute on function public.production_write_refusal_record_browser_v2(jsonb,jsonb),public.production_write_refusal_list_v1(integer,boolean,integer) to service_role;
revoke all on write_refusal_diagnostics.receipts_v1 from public,anon,authenticated,service_role;

-- Schedule the cleanup once a day at 04:17 UTC. cron.schedule replaces a job
-- of the same name, so re-applying is safe. A database without pg_cron (the
-- disposable test server) skips this and says so.
do $do$
begin
 if exists (select from pg_extension where extname='pg_cron') then
  perform cron.schedule('write-refusal-retention-daily','17 4 * * *','select public.production_write_refusal_retention_daily_v1()');
 else
  raise notice 'pg_cron not installed: write-refusal-retention-daily not scheduled';
 end if;
end $do$;
commit;
