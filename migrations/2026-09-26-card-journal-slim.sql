-- ============================================================
-- NOT APPLIED -- proposal for owner review (2026-09-26). Do not apply until
-- the owner says so. Deletes, trims or rewrites NO existing journal row.
--
-- WHY. public.card_change_journal reached ~616 MB / ~1.7 GB of text in nine
-- days and pushed the Track-B history dump past what the backup script could
-- decode (OPEN_REPAIRS, 2026-09-26). Measured on a 5% sample, read only:
--   * ~92% of calendar_posts journal rows change ONLY updated_at, each in its
--     own single-row transaction under service_role.
--   * every row repeats the full column layout (~565 MB of calendar_posts
--     history is layout), and there is exactly one layout.
--
-- SOURCE of the timestamp-only rows: public.calendar_merge_comments always
-- sets updated_at = now(), even when no comment cell changed, and the
-- calendar-upsert Edge Function calls it as a SEPARATE statement before its
-- real UPDATE whenever a save carries any *_tweaks column (every whole-card
-- save does). calendar-upsert is frozen, so the fix is here, in SQL.
--
-- THREE CHANGES, one transaction:
--   1. calendar_merge_comments writes only when a merged cell differs, and
--      then stamps updated_at as before; otherwise it returns the row
--      unchanged. Its ACL is reset to service_role only (live it is also
--      executable by anon and authenticated, which the 2026-06-18 migration
--      meant to prevent; it is security invoker, so this closes a surface,
--      it changes no permitted write).
--   2. card_change_journal_capture skips an UPDATE whose only change is
--      updated_at (or nothing). INSERT, DELETE and every real change are
--      journaled exactly as before.
--   3. the column layout is stored once per (relation, layout);
--      card_change_journal_row_schema(relation, md5) resolves any row's.
--
-- REHEARSED on a disposable local PostgreSQL 16 with the live function bodies:
-- scripts/card-journal-slim-rehearsal.js (18 checks, including rollback).
-- scripts/card-change-journal-rehearsal.js applies only the 2026-09-05 file,
-- so its full-layout reads stay valid; anything that reads row_schema after
-- this is applied must resolve it through card_change_journal_row_schema().
--
-- PRE-APPLY (read only): md5(prosrc) of both functions must still equal
--   calendar_merge_comments       01e84755d199ee82f060af0f338e55ff
--   card_change_journal_capture   e14642bea1950178cce0067f3ba78fda
-- or this file is stale. The index below is built CONCURRENTLY, outside the
-- transaction, so card saves are never blocked while it builds.
-- ROLLBACK: migrations/2026-09-26-card-journal-slim.ROLLBACK.sql
-- ============================================================

create index concurrently if not exists card_change_journal_full_schema_idx
  on public.card_change_journal (relation_name, row_schema_md5)
  where row_schema <> '{}'::jsonb;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if md5((select prosrc from pg_proc where oid = 'public.calendar_merge_comments(text,text,text,text,text,text,text)'::regprocedure))
       <> '01e84755d199ee82f060af0f338e55ff'
     or md5((select prosrc from pg_proc where oid = 'public.card_change_journal_capture()'::regprocedure))
       <> 'e14642bea1950178cce0067f3ba78fda' then
    raise exception 'card_journal_slim_stale: a replaced function changed since this file was written';
  end if;
end;
$pre$;

-- 1. Comment merge writes only on a real change.
create or replace function public.calendar_merge_comments(
  p_client text, p_id text,
  p_video text default null, p_graphic text default null,
  p_caption text default null, p_title text default null,
  p_base text default ''
) returns setof public.calendar_posts
language plpgsql security invoker set search_path = public as $fn$
begin
  return query
  with cur as (
    select c.client, c.id,
      case when p_video   is not null then _calmerge_comment_cell(c.video_tweaks,   p_video,   coalesce(p_base,'')) else c.video_tweaks   end as v,
      case when p_video   is not null then _calmerge_comment_cell(c.video_tweaks,   p_video,   coalesce(p_base,'')) else c.tweaks         end as t,
      case when p_graphic is not null then _calmerge_comment_cell(c.graphic_tweaks, p_graphic, coalesce(p_base,'')) else c.graphic_tweaks end as g,
      case when p_caption is not null then _calmerge_comment_cell(c.caption_tweaks, p_caption, coalesce(p_base,'')) else c.caption_tweaks end as ca,
      case when p_title   is not null then _calmerge_comment_cell(c.title_tweaks,   p_title,   coalesce(p_base,'')) else c.title_tweaks   end as ti
    from calendar_posts c
    where c.client = p_client and c.id = p_id
    for update
  ), upd as (
    update calendar_posts c set
      video_tweaks = cur.v, tweaks = cur.t, graphic_tweaks = cur.g,
      caption_tweaks = cur.ca, title_tweaks = cur.ti,
      updated_at = now()
    from cur
    where c.client = cur.client and c.id = cur.id
      and (c.video_tweaks is distinct from cur.v or c.tweaks is distinct from cur.t
        or c.graphic_tweaks is distinct from cur.g or c.caption_tweaks is distinct from cur.ca
        or c.title_tweaks is distinct from cur.ti)
    returning c.*
  )
  select * from upd
  union all
  -- Unchanged: return the current row, as the old function did (it returned
  -- the row it had just re-stamped), so a caller still sees "card exists".
  select c.* from calendar_posts c
  where c.client = p_client and c.id = p_id and not exists(select 1 from upd);
end;
$fn$;
revoke all on function public.calendar_merge_comments(text,text,text,text,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.calendar_merge_comments(text,text,text,text,text,text,text) to service_role;

-- 2 and 3. Journal capture.
create or replace function public.card_change_journal_capture()
returns trigger language plpgsql security definer
set search_path = pg_catalog set timezone = 'UTC' as $fn$
declare
  v_before jsonb;
  v_after jsonb;
  v_before_key jsonb;
  v_after_key jsonb;
  v_client_column text;
  v_key_column text;
  v_schema jsonb;
  v_schema_md5 text;
  v_schema_stored jsonb;
  v_changed text[];
  v_claims jsonb := '{}'::jsonb;
  v_selected_claims jsonb;
begin
  if tg_table_schema <> 'public' or tg_table_name not in ('calendar_posts',
    'sample_reviews','batches','deliverables','production_comments','workload_plan')
    or tg_op not in ('INSERT','UPDATE','DELETE') then
    raise exception 'card_history_owner_invalid';
  end if;
  if tg_op <> 'INSERT' then v_before := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_after := to_jsonb(new); end if;
  v_client_column := case when tg_table_name in ('calendar_posts','sample_reviews','workload_plan')
    then 'client' else 'client_slug' end;
  v_key_column := case when tg_table_name = 'workload_plan' then 'issue_id' else 'id' end;
  if v_before is not null then
    v_before_key := jsonb_build_object(v_key_column, v_before -> v_key_column);
    if tg_table_name in ('calendar_posts','sample_reviews') then
      v_before_key := v_before_key || jsonb_build_object('client', v_before -> 'client');
    end if;
  end if;
  if v_after is not null then
    v_after_key := jsonb_build_object(v_key_column, v_after -> v_key_column);
    if tg_table_name in ('calendar_posts','sample_reviews') then
      v_after_key := v_after_key || jsonb_build_object('client', v_after -> 'client');
    end if;
  end if;

  -- Capture all columns, including future business columns, with their actual
  -- SQL type/typmod/nullability. A writer allowlist is not a schema inventory.
  select jsonb_object_agg(a.attname, jsonb_build_object(
    'type', format_type(a.atttypid, a.atttypmod), 'not_null', a.attnotnull,
    'identity', a.attidentity, 'generated', a.attgenerated) order by a.attnum)
    into v_schema from pg_attribute a
    where a.attrelid = tg_relid and a.attnum > 0 and not a.attisdropped;
  select coalesce(array_agg(k order by k), array[]::text[]) into v_changed
    from jsonb_object_keys(coalesce(v_before, '{}'::jsonb) || coalesce(v_after, '{}'::jsonb)) k
    where (v_before -> k) is distinct from (v_after -> k);

  -- 2026-09-26: an UPDATE that changed nothing but updated_at (or nothing at
  -- all) carries no business change, and was 92% of calendar_posts history
  -- (docs/ops/OPEN_REPAIRS.md). The next real change still records the row
  -- in full, including its updated_at. INSERT and DELETE are always kept.
  if tg_op = 'UPDATE' and v_changed <@ array['updated_at']::text[] then
    return null;
  end if;

  -- 2026-09-26: the column layout is stored in full only on the first journal
  -- row of each (relation, layout); later rows store '{}' and the same
  -- row_schema_md5, and public.card_change_journal_row_schema() resolves it.
  -- The layout never leaves this table, so every backup of the journal still
  -- carries it. Two concurrent first rows may both keep the full copy, which
  -- is harmless.
  v_schema_md5 := md5(v_schema::text);
  if exists(select 1 from public.card_change_journal j
      where j.relation_name = tg_table_name and j.row_schema_md5 = v_schema_md5
        and j.row_schema <> '{}'::jsonb) then
    v_schema_stored := '{}'::jsonb;
  else
    v_schema_stored := v_schema;
  end if;

  -- Malformed optional metadata must not block an otherwise valid card save.
  -- Never equate these claims or persisted author fields with the action actor.
  begin
    v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  exception when invalid_text_representation then
    v_claims := '{}'::jsonb;
  end;
  v_selected_claims := jsonb_strip_nulls(jsonb_build_object(
    'role', left(v_claims ->> 'role', 120),
    'sub', left(v_claims ->> 'sub', 240)));

  insert into public.card_change_journal (
    relation_schema, relation_name, operation, entity_key_before, entity_key_after,
    client_before, client_after, row_before, row_after, changed_columns,
    row_schema, row_schema_md5, transaction_id, transaction_started_at,
    statement_started_at, recorded_at, database_name, database_session_user,
    database_role_setting, request_claims
  ) values (
    tg_table_schema, tg_table_name, tg_op, v_before_key, v_after_key,
    v_before ->> v_client_column, v_after ->> v_client_column,
    v_before, v_after, v_changed, v_schema_stored, v_schema_md5,
    txid_current(), transaction_timestamp(), statement_timestamp(), clock_timestamp(),
    current_database(), session_user, coalesce(current_setting('role', true), 'none'),
    v_selected_claims
  );
  -- Never catch a journal failure and never consult app.event_written. A failed
  -- history INSERT aborts its business transaction, including semantic events.
  return null;
end;
$fn$;
revoke all on function public.card_change_journal_capture() from public, anon, authenticated, service_role;

-- Resolves any journal row's layout, whether stored in full or by reference.
create or replace function public.card_change_journal_row_schema(p_relation text, p_md5 text)
returns jsonb language sql stable security invoker set search_path = pg_catalog as $fn$
  select j.row_schema from public.card_change_journal j
  where j.relation_name = p_relation and j.row_schema_md5 = p_md5 and j.row_schema <> '{}'::jsonb
  order by j.id limit 1;
$fn$;
revoke all on function public.card_change_journal_row_schema(text, text) from public, anon, authenticated, service_role;
grant execute on function public.card_change_journal_row_schema(text, text) to service_role;

commit;

-- VERIFY (read only, after apply):
--   * every layout in use still resolves (expect 0):
--     select count(*) from (select distinct relation_name, row_schema_md5 from public.card_change_journal) d
--       where public.card_change_journal_row_schema(d.relation_name, d.row_schema_md5) is null;
--   * a comment-only save that changes nothing adds no journal row, and one
--     that changes a comment adds exactly one (rehearse on the test client).
--   * ACLs: has_function_privilege for anon/authenticated on
--     calendar_merge_comments and card_change_journal_row_schema are false.
