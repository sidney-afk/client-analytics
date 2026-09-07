-- FUTURE OWNER-OPERATED BEHAVIOR ROLLBACK; never applied by CI or merge.
-- Retains all history, its immutable guards, private grants and source rows.
-- Capture completeness stops at this transaction. No backfill is invented.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $rollback$
declare v_table text;
begin
  foreach v_table in array array['calendar_posts','sample_reviews','batches',
    'deliverables','production_comments','workload_plan'] loop
    if not exists (
      select 1 from pg_trigger where tgrelid=to_regclass('public.' || v_table)
        and tgname='card_change_journal_after'
        and tgfoid=to_regprocedure('public.card_change_journal_capture()')
        and not tgisinternal
    ) then raise exception 'card_history_rollback_trigger_mismatch: %', v_table; end if;
    execute format('alter table public.%I disable trigger card_change_journal_after', v_table);
  end loop;
end;
$rollback$;
select clock_timestamp() as capture_disabled_at,
  count(*) as retained_journal_rows from public.card_change_journal;
commit;
