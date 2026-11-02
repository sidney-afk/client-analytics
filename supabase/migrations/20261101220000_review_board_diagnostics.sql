-- ef-auto-deploy: functions-cope-without-this
-- (write-diagnostics calls production_write_refusal_record_browser_v3 and falls back to v2, then v1, while it is missing.)
--
-- OPEN_REPAIRS 626 (session Reviewguard, 2026-11-01): the client link and Kasper's review
-- board report what they could not before (a press dropped because the part was already
-- answered or still saving, a reload during a save, a save shown as not saved, a save that
-- landed on a retry after a failure, an uncaught error), and every browser report now says
-- how full the browser's store is.
--
-- New, beside the refusal log and keyed by its row (a side table, so the existing record
-- functions and their replay check are untouched):
--   ui_code      the page's own short code for what happened (snake_case word)
--   board        'kasper' or 'client' (review reports only)
--   part         video, graphic, caption or title (review reports only)
--   storage_kc   the browser store's size in thousands of characters
--   storage_pct  that size as a percent of the ~5.2 million characters where browsers stop
-- A row goes when its refusal row goes (the 30-day cleanup), by the foreign key.
--
-- Two reads, run with SQL as the owner (counts only: no client, no card, no words):
--   select * from public.production_write_refusal_review_signatures_v1(now() - interval '3 hours', now());
--     one row per signature (board|action|code|browser|os|store bucket|retry landed) with
--     person/automation and test-client/real-client kept apart. For the scheduled watcher.
--   select * from public.production_write_refusal_review_daily_v1(14);
--     every browser report per day, page, action, code, browser and OS.
--
-- Nothing here is readable from a browser: the table is revoked from all four roles and
-- the functions run for service_role only.
begin;

create table if not exists write_refusal_diagnostics.review_env_v1 (
  attempt_id uuid primary key references write_refusal_diagnostics.receipts_v1(attempt_id) on delete cascade,
  ui_code text check (ui_code ~ '^[a-z0-9_]{1,60}$'),
  board text check (board in ('kasper','client')),
  part text check (part in ('video','graphic','caption','title')),
  storage_kc integer check (storage_kc between 0 and 100000),
  storage_pct smallint check (storage_pct between 0 and 100),
  recorded_at timestamptz not null default clock_timestamp()
);
revoke all on write_refusal_diagnostics.review_env_v1 from public, anon, authenticated, service_role;

create or replace function public.production_write_refusal_record_browser_v3(p_receipt jsonb, p_detail jsonb, p_env jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare v_result jsonb; k text; v_code text; v_board text; v_part text; v_kc integer; v_pct smallint;
begin
 if p_env is not null and jsonb_typeof(p_env) is distinct from 'object' then raise exception 'refusal_env_shape';end if;
 for k in select jsonb_object_keys(coalesce(p_env,'{}'::jsonb)) loop
  if k not in ('ui_code','board','part','storage_kc','storage_pct') then raise exception 'refusal_env_shape';end if;
 end loop;
 if jsonb_typeof(p_env->'ui_code') not in ('string','null') or jsonb_typeof(p_env->'board') not in ('string','null')
    or jsonb_typeof(p_env->'part') not in ('string','null') or jsonb_typeof(p_env->'storage_kc') not in ('number','null')
    or jsonb_typeof(p_env->'storage_pct') not in ('number','null') then raise exception 'refusal_env_shape';end if;
 v_code:=nullif(p_env->>'ui_code','');
 v_board:=nullif(p_env->>'board','');
 v_part:=nullif(p_env->>'part','');
 v_kc:=(p_env->>'storage_kc')::integer;
 v_pct:=(p_env->>'storage_pct')::smallint;
 -- Every existing check (shape, codes, identifiers, detail, rate limit, replay) runs first.
 v_result:=public.production_write_refusal_record_browser_v2(p_receipt,p_detail);
 -- A replay keeps what it was first recorded with.
 if not coalesce((v_result->>'duplicate')::boolean,false)
    and (v_code is not null or v_board is not null or v_part is not null or v_kc is not null or v_pct is not null) then
  insert into write_refusal_diagnostics.review_env_v1(attempt_id,ui_code,board,part,storage_kc,storage_pct)
  values((p_receipt->>'attempt_id')::uuid,v_code,v_board,v_part,v_kc,v_pct)
  on conflict (attempt_id) do nothing;
 end if;
 return v_result;
end $fn$;

-- Per day, per page and action: how often, on how many cards, in which browsers, and how
-- full the fullest store was. `reports` counts rows; `tries` counts the retries folded into
-- them (one row per click).
create or replace function public.production_write_refusal_review_daily_v1(p_days integer default 14)
returns table(day date, page text, action text, code text, browser text, os text, reports bigint, tries bigint, cards bigint, max_storage_pct smallint, max_storage_kc integer)
language sql stable security definer set search_path=pg_catalog,public as $fn$
 select (r.recorded_at at time zone 'UTC')::date,
        coalesce(r.claimed_page,'unknown'),
        coalesce(r.ui_action,r.operation),
        coalesce(e.ui_code,r.code),
        coalesce(r.browser,'unknown'), coalesce(r.os,'unknown'),
        count(*), sum(r.attempts), count(distinct r.card_ref),
        max(e.storage_pct), max(e.storage_kc)
 from write_refusal_diagnostics.receipts_v1 r
 left join write_refusal_diagnostics.review_env_v1 e on e.attempt_id=r.attempt_id
 where r.origin='browser_claim'
   and r.recorded_at>=now()-make_interval(days=>least(greatest(coalesce(p_days,14),1),30))
   and r.traffic is distinct from 'automation'
 group by 1,2,3,4,5,6
 order by 1 desc, 7 desc;
$fn$;

-- The review boards' reports by signature, for a time window (default: the last 3 hours).
-- signature = board|action|code|browser|os|store bucket|retry landed, built only from
-- fixed words, so it can be pasted into a public fix PR as it is. `traffic` (person or
-- automation) and `test_client` (the card's client is a test client, matched by the same
-- one-way hash the log stores) are kept apart rather than mixed in, so a watcher can read
-- people on real clients only. `retry_landed` is true when the same card, part and action
-- reported `landed_after_retry` within the hour after. The landed-after-retry reports
-- themselves are not listed as signatures. Mocked runs (CI, the offline fixtures) answer
-- every request locally and never reach this log.
create or replace function public.production_write_refusal_review_signatures_v1(p_since timestamptz default null, p_until timestamptz default null)
returns table(signature text, board text, action text, code text, browser text, os text, storage_bucket text, retry_landed boolean,
  traffic text, test_client boolean, reports bigint, tries bigint, cards bigint, first_at timestamptz, last_at timestamptz, app_version text)
language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
declare v_since timestamptz:=coalesce(p_since, now()-interval '3 hours'); v_until timestamptz:=coalesce(p_until, now());
 v_tests text[];
begin
 if v_until-v_since > interval '31 days' then v_since:=v_until-interval '31 days'; end if;
 -- The test clients, as the hash the log stores. No clients table (a bare test database): none.
 if to_regclass('public.clients') is not null then
  execute $q$select coalesce(array_agg(encode(sha256(convert_to(slug,'UTF8')),'hex')),'{}') from public.clients where kind='test'$q$ into v_tests;
 end if;
 v_tests:=coalesce(v_tests,'{}');
 return query
 with x0 as (
  select r.recorded_at as at, r.card_ref as cref, r.attempts as tries0, r.app_version as ver,
         e.board as b,
         regexp_replace(coalesce(r.ui_action,'review_unknown'),'^review_','') as a,
         coalesce(e.ui_code, r.code) as c,
         coalesce(r.browser,'unknown') as br, coalesce(r.os,'unknown') as o,
         case when e.storage_pct is null then 'unknown' when e.storage_pct<50 then '0-49' when e.storage_pct<80 then '50-79'
              when e.storage_pct<95 then '80-94' else '95-100' end as bucket,
         e.part as pt,
         coalesce(r.traffic,'unknown') as tr,
         coalesce((r.identifiers->>'client_slug') = any(v_tests), false) as tc
  from write_refusal_diagnostics.receipts_v1 r
  join write_refusal_diagnostics.review_env_v1 e on e.attempt_id=r.attempt_id
  where r.origin='browser_claim' and e.board is not null
    and r.recorded_at>=v_since and r.recorded_at<v_until+interval '1 hour'),
 marked as (
  select x.*, exists (select 1 from x0 l where l.c='landed_after_retry' and l.cref is not distinct from x.cref
           and l.pt is not distinct from x.pt and l.a=x.a
           and l.at>x.at and l.at<x.at+interval '1 hour') as rl
  from x0 x where x.c<>'landed_after_retry' and x.at<v_until)
 select concat_ws('|',m.b,m.a,m.c,m.br,m.o,m.bucket,case when m.rl then 'retry_landed' else 'no_retry_landed' end),
        m.b, m.a, m.c, m.br, m.o, m.bucket, m.rl, m.tr, m.tc,
        count(*), sum(m.tries0)::bigint, count(distinct m.cref), min(m.at), max(m.at), max(m.ver)
 from marked m
 group by m.b, m.a, m.c, m.br, m.o, m.bucket, m.rl, m.tr, m.tc
 order by m.tc, (m.tr='automation'), count(*) desc;
end $fn$;

revoke all on function public.production_write_refusal_record_browser_v3(jsonb,jsonb,jsonb), public.production_write_refusal_review_daily_v1(integer),
  public.production_write_refusal_review_signatures_v1(timestamptz,timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.production_write_refusal_record_browser_v3(jsonb,jsonb,jsonb), public.production_write_refusal_review_daily_v1(integer),
  public.production_write_refusal_review_signatures_v1(timestamptz,timestamptz) to service_role;

commit;
