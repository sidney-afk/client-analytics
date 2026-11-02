-- ef-auto-deploy: functions-cope-without-this
-- (write-diagnostics records through v2, without the new fields, whenever v3 refuses, so a workload or calendar
--  board sent before this is applied loses its board and part but never the report.)
--
-- OPEN_REPAIRS 638 (session Reviewguard, 2026-11-02): the same reports the review boards send (OPEN_REPAIRS 626)
-- now come from the Workload calendar too (and, next, the content Calendar). Two changes, nothing else:
--   1. write_refusal_diagnostics.review_env_v1.board also takes 'workload' and 'calendar';
--   2. the signatures read strips the page prefix from the action for those pages too, so a Workload report's
--      signature reads workload|plan_save|... rather than workload|workload_plan_save|...
-- The two reads are used exactly as before:
--   select * from public.production_write_refusal_review_signatures_v1(now() - interval '3 hours', now());
--   select * from public.production_write_refusal_review_daily_v1(14);
-- Nothing here is readable from a browser: the table stays revoked from all four roles and the function runs
-- for service_role only.
begin;

alter table write_refusal_diagnostics.review_env_v1 drop constraint if exists review_env_v1_board_check;
alter table write_refusal_diagnostics.review_env_v1 add constraint review_env_v1_board_check
  check (board in ('kasper','client','workload','calendar'));
revoke all on write_refusal_diagnostics.review_env_v1 from public, anon, authenticated, service_role;

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
         regexp_replace(coalesce(r.ui_action,'review_unknown'),'^(review|workload|calendar)_','') as a,
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

revoke all on function public.production_write_refusal_review_signatures_v1(timestamptz,timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.production_write_refusal_review_signatures_v1(timestamptz,timestamptz) to service_role;

commit;
