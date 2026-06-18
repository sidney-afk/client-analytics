-- ============================================================================
-- SyncView calendar — atomic comment-cell merge
-- Fixes: concurrent comment lost-update + tombstone resurrection in
-- calendar_posts.*_tweaks columns (two writes to the same card-component
-- within the realtime window could drop a comment or revive a deleted one,
-- because the n8n upsert did a non-atomic read-modify-write).
--
-- HOW TO APPLY: paste this whole file into the Supabase SQL editor and Run.
-- Idempotent (CREATE OR REPLACE) — safe to run more than once.
-- NOTE: calendar_posts.updated_at is a TEXT column holding ISO-8601
-- strings (e.g. 2026-06-18T03:13:35.573Z), so the merge writes updated_at
-- in that exact format (not now(), whose text cast uses a space + offset
-- and would break row-freshness ordering).
--
-- After it's in, ping Claude to wire the n8n "Upsert Post" workflow to call
-- calendar_merge_comments() for the comment columns.
-- ============================================================================

-- Is this element an EXPIRED tombstone (soft-deleted > 30 days ago)? Safe cast.
create or replace function _calmerge_is_expired_tomb(p_elem jsonb, p_cutoff timestamptz)
returns boolean language plpgsql immutable as $fn$
declare v_ts timestamptz; v_s text;
begin
  if not coalesce((p_elem->>'deleted')::boolean, false) then return false; end if;
  v_s := coalesce(p_elem->>'updated_at', p_elem->>'created_at');
  if v_s is null or v_s = '' then return false; end if;
  begin v_ts := v_s::timestamptz; exception when others then return false; end;
  return v_ts < p_cutoff;
end;
$fn$;

-- Merge one comment cell: union by id (newer updated_at||created_at wins per id,
-- ties -> incoming), keep every existing comment (tombstones included), drop
-- tombstones older than 30 days. Mirrors the n8n "Merge Comments" JS mergeCell
-- under v2 (base=''), but is evaluated against the row's CURRENT value inside an
-- atomic UPDATE so concurrent writers can't clobber each other.
create or replace function _calmerge_comment_cell(p_existing text, p_incoming text, p_base text default '')
returns text language plpgsql immutable as $fn$
declare
  v_ex jsonb := '[]'::jsonb;
  v_inc jsonb := '[]'::jsonb;
  v_all jsonb;
  v_result jsonb;
  v_cutoff timestamptz := now() - interval '30 days';
begin
  begin v_ex  := coalesce(nullif(btrim(coalesce(p_existing,'')),'')::jsonb, '[]'::jsonb); exception when others then v_ex  := '[]'::jsonb; end;
  begin v_inc := coalesce(nullif(btrim(coalesce(p_incoming,'')),'')::jsonb, '[]'::jsonb); exception when others then v_inc := '[]'::jsonb; end;
  if jsonb_typeof(v_ex)  <> 'array' then v_ex  := '[]'::jsonb; end if;
  if jsonb_typeof(v_inc) <> 'array' then v_inc := '[]'::jsonb; end if;
  v_all := v_ex || v_inc;  -- existing first, incoming second (incoming wins stamp ties)

  with elems as (
    select e.elem,
           e.elem->>'id' as id,
           coalesce(e.elem->>'updated_at', e.elem->>'created_at', '') as ts,
           e.ord
    from jsonb_array_elements(v_all) with ordinality as e(elem, ord)
    where (e.elem ? 'id') and coalesce(e.elem->>'id','') <> ''
  ),
  ranked as (
    select elem, id, ts, ord,
           row_number() over (partition by id order by ts desc, ord desc) as rn,
           min(ord) over (partition by id) as first_ord
    from elems
  ),
  kept as (
    select elem, first_ord from ranked r
    where r.rn = 1 and not _calmerge_is_expired_tomb(r.elem, v_cutoff)
  )
  select coalesce(jsonb_agg(elem order by first_ord), '[]'::jsonb) into v_result from kept;

  if v_result is null or jsonb_array_length(v_result) = 0 then return ''; end if;
  return v_result::text;
end;
$fn$;

-- Atomic merge of the (optional) comment columns for ONE card. Each provided
-- column is merged against its CURRENT stored value inside a single UPDATE, so
-- the row lock serialises concurrent callers and no comment is lost/resurrected.
-- NULL arg = leave that column untouched. Returns the updated row (0 rows if the
-- card does not exist yet -> caller treats that as a create).
create or replace function calendar_merge_comments(
  p_client text, p_id text,
  p_video text default null, p_graphic text default null,
  p_caption text default null, p_title text default null,
  p_base text default ''
) returns setof calendar_posts
language plpgsql security invoker set search_path = public as $fn$
begin
  return query
  update calendar_posts c set
    video_tweaks   = case when p_video   is not null then _calmerge_comment_cell(c.video_tweaks,   p_video,   coalesce(p_base,'')) else c.video_tweaks   end,
    tweaks         = case when p_video   is not null then _calmerge_comment_cell(c.video_tweaks,   p_video,   coalesce(p_base,'')) else c.tweaks         end,
    graphic_tweaks = case when p_graphic is not null then _calmerge_comment_cell(c.graphic_tweaks, p_graphic, coalesce(p_base,'')) else c.graphic_tweaks end,
    caption_tweaks = case when p_caption is not null then _calmerge_comment_cell(c.caption_tweaks, p_caption, coalesce(p_base,'')) else c.caption_tweaks end,
    title_tweaks   = case when p_title   is not null then _calmerge_comment_cell(c.title_tweaks,   p_title,   coalesce(p_base,'')) else c.title_tweaks   end,
    updated_at     = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  where c.client = p_client and c.id = p_id
  returning c.*;
end;
$fn$;

-- Only the n8n service role (and the table owner) may call it; never the public
-- anon key that ships in the app.
revoke all on function calendar_merge_comments(text,text,text,text,text,text,text) from public;
grant execute on function calendar_merge_comments(text,text,text,text,text,text,text) to service_role;
