-- API (Post For Me) vs phone TikTok views. READ ONLY. Run in the Supabase SQL editor (or execute_sql).
-- See docs/ops/API_VS_PHONE_VIEWS.md for method, caveats and how to read the output.
-- Output contains real client slugs in column `slug`: keep results private, publish only `label`.
--
-- Tunables (edit the numbers below):
--   min_age_days   7     a video counts only if it was at least this old when last scraped
--   match_secs     600   an upload matches a video when their post times are this close
--   outlier_x      10    trimmed view drops videos above outlier_x times the client's median (API + phone together)
with params as (select 7::int min_age_days, 600::int match_secs, 10::numeric outlier_x),
vids as (
  select client_slug slug,
         (regexp_match(video_url, '/video/([0-9]+)'))[1] vid,
         max(scraped_date) last_scraped,
         (array_agg(views    order by scraped_date desc))[1]::numeric views,
         (array_agg(likes    order by scraped_date desc))[1]::numeric likes,
         (array_agg(comments order by scraped_date desc))[1]::numeric comments,
         (array_agg(shares   order by scraped_date desc))[1]::numeric shares
  from analytics_top_videos
  where platform = 'tiktok' and video_url ~ '/video/[0-9]+' and views is not null
  group by 1, 2),
vt as (  -- TikTok video ids carry their post time in the top 32 bits (unix seconds)
  select *, to_timestamp(vid::bigint >> 32) posted,
         (last_scraped - (to_timestamp(vid::bigint >> 32))::date) age_days
  from vids),
up as (  -- every posted API upload; client display name -> slug through the roster
  select p.slug, t.posted_at
  from tiktok_uploads t join client_profiles p on lower(p.display_name) = lower(t.client)
  where t.status = 'posted' and coalesce(t.upload_post_id, '') <> ''),
first_api as (select slug, min(posted_at) first_api_at, count(*) api_uploads from up group by 1),
tag as (
  select vt.*, fa.first_api_at, fa.api_uploads,
         exists (select 1 from up, params
                 where up.slug = vt.slug
                   and abs(extract(epoch from vt.posted - up.posted_at)) <= params.match_secs) is_api
  from vt join first_api fa using (slug)),
elig as (select tag.* from tag, params where age_days >= params.min_age_days),
api as (select * from elig where is_api),
n_api as (select slug, count(*) n from api group by 1),
phone as (  -- the same number of phone videos posted just before the first API post, most recent first
  select * from (
    select e.*, row_number() over (partition by e.slug order by e.posted desc) rn
    from elig e where not e.is_api and e.posted < e.first_api_at) x
  where rn <= (select n from n_api where n_api.slug = x.slug)),
grp as (
  select slug, 'api' g, views, likes, comments, shares, age_days from api
  union all
  select slug, 'phone', views, likes, comments, shares, age_days from phone),
med as (select slug, percentile_cont(0.5) within group (order by views) m from grp group by 1),
ph_med as (select slug, percentile_cont(0.5) within group (order by views) m from grp where g = 'phone' group by 1),
labelled as (
  select slug, 'Client ' || chr(64 + (row_number() over (order by count(*) filter (where g = 'api') desc, slug))::int) label
  from grp group by slug),
per as (
  select l.label, g.slug,
    g.g,
    count(*) n,
    round(avg(views)) mean_views,
    round(percentile_cont(0.5) within group (order by views)::numeric) median_views,
    round(100 * sum(likes + comments + shares) / nullif(sum(views), 0), 2) engagement_pct,
    round(avg(age_days)) mean_age_days,
    round(avg(views) filter (where views <= params.outlier_x * med.m)) trimmed_mean_views,
    count(*) filter (where views > params.outlier_x * med.m) outliers_dropped,
    count(*) filter (where g.g = 'api' and views > ph_med.m) beat_phone_median
  from grp g join labelled l using (slug) join med using (slug) left join ph_med using (slug), params
  group by l.label, g.slug, g.g)
select label, slug, g, n, mean_views, median_views, engagement_pct, mean_age_days, trimmed_mean_views, outliers_dropped, beat_phone_median
from per order by label, g;
-- TOTAL row (pooled across clients): replace the final select with the block below.
-- select g, count(*) n, round(avg(views)) mean_views,
--        round(percentile_cont(0.5) within group (order by views)::numeric) median_views,
--        round(100 * sum(likes + comments + shares) / nullif(sum(views), 0), 2) engagement_pct,
--        round(avg(age_days)) mean_age_days
-- from grp group by g;
