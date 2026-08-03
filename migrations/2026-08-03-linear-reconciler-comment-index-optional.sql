-- Optional write-nonblocking accelerator for the lifetime comment-ID view.
--
-- SOURCE-ONLY until a separate owner-approved production step. The measured
-- no-index view is already adequate at the current cadence and remains the
-- readiness contract. The production-plan prototype was about 49 KiB. This
-- small partial index is therefore optional and must
-- not be used to justify a trigger, cache, time bound, or source-row rewrite.
--
-- Run with psql autocommit enabled. CREATE INDEX CONCURRENTLY is deliberately
-- outside the atomic view/function migration so deliverable_events writers are
-- not blocked by an ordinary index build.

set lock_timeout = '5s';
set statement_timeout = '10min';

create index concurrently if not exists deliverable_events_linear_comment_candidate_idx
  on public.deliverable_events (deliverable_id, ts desc, id desc)
  where deliverable_id is not null
    and source in ('ui', 'mirror', 'outbound')
    and position('comment' in lower(action)) > 0;

do $check$
begin
  if not exists (
    select 1
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'deliverable_events_linear_comment_candidate_idx'
      and i.indisvalid
      and i.indisready
      and i.indislive
      and pg_get_indexdef(i.indexrelid) like
        'CREATE INDEX deliverable_events_linear_comment_candidate_idx ON public.deliverable_events USING btree (deliverable_id, ts DESC, id DESC)%'
      and pg_get_expr(i.indpred, i.indrelid) is not null
  ) then
    raise exception 'optional linear reconcile comment index is absent, invalid, or drifted';
  end if;
end;
$check$;

-- Owner-only rollback (run separately with psql autocommit enabled):
-- drop index concurrently if exists public.deliverable_events_linear_comment_candidate_idx;
