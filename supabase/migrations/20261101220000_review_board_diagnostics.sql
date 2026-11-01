-- ef-auto-deploy: functions-cope-without-this
-- (write-diagnostics calls production_write_refusal_record_browser_v3 and falls back to v2, then v1, while it is missing.)
--
-- OPEN_REPAIRS 623 (session Reviewguard, 2026-11-01): the client link and Kasper's review
-- board report what they could not before (a press dropped because the part was already
-- answered or still saving, a reload during a save, a save shown as not saved, an
-- uncaught error), and every browser report now says how full the browser's store is.
--
-- New, beside the refusal log and keyed by its row (a side table, so the existing record
-- functions and their replay check are untouched):
--   ui_code      the page's own short code for what happened (snake_case word)
--   storage_kc   the browser store's size in thousands of characters
--   storage_pct  that size as a percent of the ~5.2 million characters where browsers stop
-- A row goes when its refusal row goes (the 30-day cleanup), by the foreign key.
--
-- One read per day for the supervisor, run with SQL as the owner:
--   select * from public.production_write_refusal_review_daily_v1(14);
-- Counts only: no client, no card, no words. Browser and OS are the families the function
-- already reads from the user agent.
--
-- Nothing here is readable from a browser: the table is revoked from all four roles and
-- both functions run for service_role only.
begin;

create table if not exists write_refusal_diagnostics.review_env_v1 (
  attempt_id uuid primary key references write_refusal_diagnostics.receipts_v1(attempt_id) on delete cascade,
  ui_code text check (ui_code ~ '^[a-z0-9_]{1,60}$'),
  storage_kc integer check (storage_kc between 0 and 100000),
  storage_pct smallint check (storage_pct between 0 and 100),
  recorded_at timestamptz not null default clock_timestamp()
);
revoke all on write_refusal_diagnostics.review_env_v1 from public, anon, authenticated, service_role;

create or replace function public.production_write_refusal_record_browser_v3(p_receipt jsonb, p_detail jsonb, p_env jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare v_result jsonb; k text; v_code text; v_kc integer; v_pct smallint;
begin
 if p_env is not null and jsonb_typeof(p_env) is distinct from 'object' then raise exception 'refusal_env_shape';end if;
 for k in select jsonb_object_keys(coalesce(p_env,'{}'::jsonb)) loop
  if k not in ('ui_code','storage_kc','storage_pct') then raise exception 'refusal_env_shape';end if;
 end loop;
 if jsonb_typeof(p_env->'ui_code') not in ('string','null') or jsonb_typeof(p_env->'storage_kc') not in ('number','null')
    or jsonb_typeof(p_env->'storage_pct') not in ('number','null') then raise exception 'refusal_env_shape';end if;
 v_code:=nullif(p_env->>'ui_code','');
 v_kc:=(p_env->>'storage_kc')::integer;
 v_pct:=(p_env->>'storage_pct')::smallint;
 -- Every existing check (shape, codes, identifiers, detail, rate limit, replay) runs first.
 v_result:=public.production_write_refusal_record_browser_v2(p_receipt,p_detail);
 -- A replay keeps what it was first recorded with.
 if not coalesce((v_result->>'duplicate')::boolean,false) and (v_code is not null or v_kc is not null or v_pct is not null) then
  insert into write_refusal_diagnostics.review_env_v1(attempt_id,ui_code,storage_kc,storage_pct)
  values((p_receipt->>'attempt_id')::uuid,v_code,v_kc,v_pct)
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

revoke all on function public.production_write_refusal_record_browser_v3(jsonb,jsonb,jsonb), public.production_write_refusal_review_daily_v1(integer) from public, anon, authenticated, service_role;
grant execute on function public.production_write_refusal_record_browser_v3(jsonb,jsonb,jsonb), public.production_write_refusal_review_daily_v1(integer) to service_role;

commit;
