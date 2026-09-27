-- ============================================================
-- NOT APPLIED -- rollback for migrations/2026-09-26-card-journal-slim.sql.
-- Restores both functions to the bodies read live on 2026-09-26 (the journal
-- capture body is byte-identical to migrations/2026-09-05-card-change-journal.sql;
-- the merge body is the live one, which stamps now() -- its live copy uses CRLF
-- line endings, so md5(prosrc) after rollback differs from 01e84755... only by
-- those bytes). Journal rows written while the slim version ran keep '{}' as
-- their row_schema; card_change_journal_row_schema() is kept so they still
-- resolve. The merge ACL returns to service_role only (not the live anon/
-- authenticated EXECUTE, which was never intended). No journal row is touched.
-- ============================================================
begin;
set local lock_timeout = '5s';
create or replace function public.calendar_merge_comments(
  p_client text, p_id text,
  p_video text default null, p_graphic text default null,
  p_caption text default null, p_title text default null,
  p_base text default ''
) returns setof public.calendar_posts
language plpgsql security invoker set search_path = public as $fn$
begin
  return query
  update calendar_posts c set
    video_tweaks   = case when p_video   is not null then _calmerge_comment_cell(c.video_tweaks,   p_video,   coalesce(p_base,'')) else c.video_tweaks   end,
    tweaks         = case when p_video   is not null then _calmerge_comment_cell(c.video_tweaks,   p_video,   coalesce(p_base,'')) else c.tweaks         end,
    graphic_tweaks = case when p_graphic is not null then _calmerge_comment_cell(c.graphic_tweaks, p_graphic, coalesce(p_base,'')) else c.graphic_tweaks end,
    caption_tweaks = case when p_caption is not null then _calmerge_comment_cell(c.caption_tweaks, p_caption, coalesce(p_base,'')) else c.caption_tweaks end,
    title_tweaks   = case when p_title   is not null then _calmerge_comment_cell(c.title_tweaks,   p_title,   coalesce(p_base,'')) else c.title_tweaks   end,
    updated_at     = now()
  where c.client = p_client and c.id = p_id
  returning c.*;
end;
$fn$;
revoke all on function public.calendar_merge_comments(text,text,text,text,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.calendar_merge_comments(text,text,text,text,text,text,text) to service_role;

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
    v_before, v_after, v_changed, v_schema, md5(v_schema::text),
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
commit;
-- The partial index card_change_journal_full_schema_idx is harmless to keep;
-- drop it with `drop index concurrently if exists public.card_change_journal_full_schema_idx;`
-- only if nothing reads by-reference rows.
