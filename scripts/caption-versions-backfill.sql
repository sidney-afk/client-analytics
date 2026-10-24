-- ============================================================
-- Caption history backfill: the caption changes made BEFORE caption_versions existed.
-- Written by session Versions, 2026-10-23 21:20 UTC (date -u). Applied BY HAND, after
-- migrations/2026-10-23-caption-versions.sql. It is not a migration and nothing runs it automatically.
--
-- Source: public.card_change_journal (the whole calendar_posts row before and after every real change, kept
-- since 2026-09-17). It records the text but not who changed it or how, so every row written here has
-- kind = 'backfill', no actor and no note; the Calendar shows it as "Earlier version (who and how not recorded)".
--
-- What it writes, per card and per field (caption, caption_alt):
--   * the text after each journalled change;
--   * the text before the FIRST journalled change, when there was any (the caption the card had on 2026-09-17
--     or when the journal first saw it), dated from that row's own updated_at when it is a clean timestamp,
--     else one millisecond before that first change.
-- Only journal rows older than the first row the live trigger wrote are used, so nothing is counted twice.
-- The calendar's settings row (id p_cal_settings) is skipped: its caption column holds settings, not a caption.
--
-- RE-RUNNABLE: a version that is already there (same card, field, time and kind 'backfill') is not inserted
-- again, so running it twice changes nothing the second time. It only inserts; caption_versions refuses
-- update and delete.
--
-- Read-only check before (how many rows it would write):  run the SELECT inside "candidates" below on its own.
-- Check after:  select count(*) from public.caption_versions where kind = 'backfill';
-- ============================================================
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $guard$
begin
  if to_regclass('public.caption_versions') is null then
    raise exception 'apply migrations/2026-10-23-caption-versions.sql first';
  end if;
end
$guard$;

with cutoff as (
  select coalesce(min(created_at), 'infinity'::timestamptz) as at
  from public.caption_versions where kind <> 'backfill'
),
journal as (
  select j.client_after as client, j.entity_key_after ->> 'id' as post_id, j.operation,
         j.recorded_at, j.row_before, j.row_after, j.changed_columns
  from public.card_change_journal j, cutoff
  where j.relation_name = 'calendar_posts'
    and j.operation in ('INSERT', 'UPDATE')
    and j.recorded_at < cutoff.at
    and j.client_after is not null
    and coalesce(j.entity_key_after ->> 'id', '') not in ('', 'p_cal_settings')
    and coalesce(j.row_after ->> 'name', '') <> '__cal_settings__'
    and ('caption' = any(j.changed_columns) or 'caption_alt' = any(j.changed_columns))
),
fields as (select unnest(array['caption', 'caption_alt']) as field),
after_change as (
  select jr.client, jr.post_id, f.field, coalesce(jr.row_after ->> f.field, '') as text, jr.recorded_at as created_at
  from journal jr join fields f on f.field = any(jr.changed_columns)
  where not (jr.operation = 'INSERT' and coalesce(jr.row_after ->> f.field, '') = '')
),
first_before as (
  select distinct on (jr.client, jr.post_id, f.field)
         jr.client, jr.post_id, f.field, jr.row_before ->> f.field as text, jr.recorded_at,
         jr.row_before ->> 'updated_at' as before_stamp
  from journal jr join fields f on f.field = any(jr.changed_columns)
  where jr.operation = 'UPDATE' and coalesce(jr.row_before ->> f.field, '') <> ''
  order by jr.client, jr.post_id, f.field, jr.recorded_at
),
before_dated as (
  select client, post_id, field, text,
         case
           when before_stamp ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
                and before_stamp::timestamptz < recorded_at
             then before_stamp::timestamptz
           else recorded_at - interval '1 millisecond'
         end as created_at
  from first_before
),
candidates as (
  select client, post_id, field, text, created_at from after_change
  union all
  select client, post_id, field, text, created_at from before_dated
)
insert into public.caption_versions (client, post_id, field, text, kind, created_at)
select c.client, c.post_id, c.field, c.text, 'backfill', c.created_at
from candidates c
where not exists (
  select 1 from public.caption_versions v
  where v.kind = 'backfill' and v.client = c.client and v.post_id = c.post_id
    and v.field = c.field and v.created_at = c.created_at
)
order by c.created_at;

select count(*) as backfill_rows_now from public.caption_versions where kind = 'backfill';

commit;
