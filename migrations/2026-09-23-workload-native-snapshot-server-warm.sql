-- Keep Workload's cached snapshot fresh from the server, not from whichever
-- staff tab happens to be open, and stop invalidating it on writes that
-- changed nothing.
--
-- MEASURED (function logs since the warm-up deploy, 2026-09-23 19:10Z on):
-- native_snapshot_v2 gave 111 full answers and 71 were rebuilds paid by the
-- reader (median 4.5 s); warm_snapshot found 123 fresh / 13 rebuilt / 11 busy.
-- The browser warm-up fires only after a staff save or from a visible Workload
-- tab, so a change made anywhere else (system bridges, client links, a tab in
-- the background) waited for the next reader. Of the deliverables rows updated
-- in the last 4 h (54, in 30 distinct minutes), every one had a matching
-- deliverable_events row: these are real workflow changes, and updated_at is the
-- browser's due-write CAS cursor, so they MUST invalidate. What must not is a
-- statement that changed no row: the old statement-level trigger fired for an
-- UPDATE matching zero rows and for a rewrite of identical values alike.
--
-- 1. Invalidation now uses transition tables: INSERT/DELETE note a change only
--    when rows were actually inserted/deleted, UPDATE only when some row's new
--    value differs from its old one (NEW EXCEPT OLD). TRUNCATE still always
--    notes. Exactness is unchanged: any real change, updated_at included, still
--    invalidates in the same transaction.
-- 2. pg_cron runs workload_native_snapshot_warm_v1() every 10 seconds. When the
--    copy is fresh that is one existence check; when a change has committed it
--    rebuilds within ~10 s + ~3 s, off every reader's path. A reader that lands
--    during a rebuild waits on the same advisory lock for the remainder rather
--    than rebuilding again. A daily job prunes this job's run history.
--
-- Requires pg_cron (Supabase ships it; the extension is created here).
begin;

create extension if not exists pg_cron;

create or replace function public.workload_snapshot_note_rows_changed()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public as $fn$
declare v_changed boolean;
begin
  if TG_OP = 'INSERT' then
    select exists (select 1 from new_rows) into v_changed;
  elsif TG_OP = 'DELETE' then
    select exists (select 1 from old_rows) into v_changed;
  else
    select exists (select * from new_rows except select * from old_rows) into v_changed;
  end if;
  if v_changed then
    insert into public.workload_snapshot_invalidation(xid)
      values (pg_current_xact_id()) on conflict (xid) do nothing;
  end if;
  return null;
end;
$fn$;
revoke all on function public.workload_snapshot_note_rows_changed() from public, anon, authenticated, service_role;

do $do$
declare t text;
begin
  foreach t in array array['deliverables','batches','clients','team_members',
                           'workload_issues','workload_plan','syncview_runtime_flags'] loop
    execute format('drop trigger if exists workload_snapshot_note_change on public.%I', t);
    execute format('drop trigger if exists workload_snapshot_note_insert on public.%I', t);
    execute format('drop trigger if exists workload_snapshot_note_update on public.%I', t);
    execute format('drop trigger if exists workload_snapshot_note_delete on public.%I', t);
    execute format('drop trigger if exists workload_snapshot_note_truncate on public.%I', t);
    execute format('create trigger workload_snapshot_note_insert after insert on public.%I
      referencing new table as new_rows for each statement
      execute function public.workload_snapshot_note_rows_changed()', t);
    execute format('create trigger workload_snapshot_note_update after update on public.%I
      referencing old table as old_rows new table as new_rows for each statement
      execute function public.workload_snapshot_note_rows_changed()', t);
    execute format('create trigger workload_snapshot_note_delete after delete on public.%I
      referencing old table as old_rows for each statement
      execute function public.workload_snapshot_note_rows_changed()', t);
    execute format('create trigger workload_snapshot_note_truncate after truncate on public.%I
      for each statement execute function public.workload_snapshot_note_change()', t);
  end loop;
end;
$do$;

-- Idempotent scheduling: re-applying replaces, never duplicates.
do $do$
begin
  perform cron.unschedule(jobid) from cron.job
    where jobname in ('workload-snapshot-warm', 'workload-snapshot-warm-history');
end;
$do$;
select cron.schedule('workload-snapshot-warm', '10 seconds',
  $job$select public.workload_native_snapshot_warm_v1()$job$);
select cron.schedule('workload-snapshot-warm-history', '17 3 * * *',
  $job$delete from cron.job_run_details
        where jobid in (select jobid from cron.job where jobname = 'workload-snapshot-warm')
          and end_time < now() - interval '1 day'$job$);

commit;
