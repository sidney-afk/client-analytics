-- ============================================================
-- Remove the n8n twin of Metrics rows stored twice (2026-10-01).
--
-- SOURCE-ONLY. Not applied. Applied by hand in the SQL editor with the
-- owner's go; EXECUTION_LOG.md records the apply.
--
-- WHY THE ROWS EXIST. n8n's Google Sheets node sent an empty cell as the two
-- characters "" (yt_shorts_views / yt_longs_views of clients with no YouTube),
-- while the daily copy reads the Sheet, where the cell is empty. Same row, two
-- fingerprints, so both were stored (source 'n8n' and 'sheet-backfill').
-- Counted on 2026-10-01: 20 pairs, 10 clients on each of 2026-09-29 and
-- 2026-09-30. The code fix (clean() in _shared/sheets-mirror.mjs) stops new
-- ones; this removes the 20 existing n8n twins and keeps the sheet-backfill
-- row, whose fingerprint equals what the Sheet computes, so parity is clean.
--
-- SAFETY. One transaction. Every removed row is first copied, in full, into
-- analytics_metrics_dedupe_log with the reason and the time. A row is removed
-- only when a sheet-backfill row for the same client and day has the same
-- content in every column once a lone "" is read as empty. If the count of
-- rows to remove is not exactly 20, nothing is changed.
--
-- UNDO. insert into public.analytics_metrics overriding system value
--         select r.* from public.analytics_metrics_dedupe_log l,
--         lateral jsonb_populate_record(null::public.analytics_metrics, l.removed_row) r;
--       (re-inserts the 20 rows exactly as they were; parity goes red again.)
-- ============================================================
begin;

create table if not exists public.analytics_metrics_dedupe_log (
  id           bigint generated always as identity primary key,
  removed_at   timestamptz not null default now(),
  reason       text not null,
  kept_row_hash text not null,
  removed_row  jsonb not null
);
alter table public.analytics_metrics_dedupe_log enable row level security;
revoke all on public.analytics_metrics_dedupe_log from public, anon, authenticated, service_role;
revoke all on sequence public.analytics_metrics_dedupe_log_id_seq from public, anon, authenticated, service_role;

create temp table _twins on commit drop as
select n.row_hash as removed_hash, n.row_occurrence as removed_occ, s.row_hash as kept_hash
from public.analytics_metrics n
join public.analytics_metrics s
  on s.client_slug = n.client_slug and s.date = n.date and s.source = 'sheet-backfill'
where n.source = 'n8n'
  and n.date in ('2026-09-29', '2026-09-30')
  and n.row_hash <> s.row_hash
  and n.extra = s.extra
  and n.client_name is not distinct from s.client_name
  and n.ig_followers is not distinct from s.ig_followers
  and n.ig_avg_views is not distinct from s.ig_avg_views
  and n.ig_avg_likes is not distinct from s.ig_avg_likes
  and n.tiktok_followers is not distinct from s.tiktok_followers
  and n.tiktok_avg_plays is not distinct from s.tiktok_avg_plays
  and n.yt_subscribers is not distinct from s.yt_subscribers
  and n.yt_total_views is not distinct from s.yt_total_views
  and n.ig_views_gained_today is not distinct from s.ig_views_gained_today
  and n.tiktok_plays_gained_today is not distinct from s.tiktok_plays_gained_today
  and n.ig_views_this_month is not distinct from s.ig_views_this_month
  and n.tiktok_plays_this_month is not distinct from s.tiktok_plays_this_month
  and n.yt_views_gained_today is not distinct from s.yt_views_gained_today
  and nullif(n.yt_shorts_views, '""') is not distinct from s.yt_shorts_views
  and nullif(n.yt_longs_views, '""') is not distinct from s.yt_longs_views
  and n.analytics_receipt is not distinct from s.analytics_receipt;

do $$
declare n int;
begin
  select count(*) into n from _twins;
  if n <> 20 then
    raise exception 'expected 20 twin rows, found % - nothing changed', n;
  end if;
end $$;

insert into public.analytics_metrics_dedupe_log (reason, kept_row_hash, removed_row)
select 'n8n twin of a sheet-backfill row; only difference was a "" cell in yt_shorts_views / yt_longs_views',
       t.kept_hash, to_jsonb(m)
from public.analytics_metrics m
join _twins t on t.removed_hash = m.row_hash and t.removed_occ = m.row_occurrence
where m.source = 'n8n';

delete from public.analytics_metrics m
using _twins t
where t.removed_hash = m.row_hash and t.removed_occ = m.row_occurrence and m.source = 'n8n';

-- Proof: no client has two rows on either day any more, and the log holds 20.
do $$
declare dup int; logged int;
begin
  select count(*) into dup from (select 1 from public.analytics_metrics
    where date in ('2026-09-29', '2026-09-30') group by client_slug, date having count(*) > 1) x;
  select count(*) into logged from public.analytics_metrics_dedupe_log;
  if logged <> 20 then raise exception 'log holds % rows, expected 20', logged; end if;
  raise notice 'duplicate client-days left on 29 and 30 Sep: %; rows logged: %', dup, logged;
end $$;

commit;
