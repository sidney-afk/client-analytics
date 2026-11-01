-- ef-auto-deploy: functions-cope-without-this
-- ============================================================
-- 2026-11-01 -- Admin "Log time off" (Kasper > Time Off). OPEN_REPAIRS 627.
-- Written by session Ptolog, 2026-11-01 (UTC).
--
-- WHAT IT CHANGES (no new table, column or function):
--   pto_requests.source may now also be 'admin_log'. The pto Edge Function's
--   new admin-only `log` action creates a member's entry through the existing
--   pto_create_request_v1 with p_source = 'admin_log', then approves it
--   through the existing pto_finalize_decision_v1 with the admin as decided_by.
--   The source value is how the row says "an admin logged this, the member
--   did not ask for it". Nothing else about the table changes.
--
--   The live constraint was read back on 2026-11-01 before writing this:
--   pto_requests_source_check = CHECK (source = ANY (ARRAY['syncview',
--   'hrvey_migration'])). It is dropped and recreated with the third value in
--   one transaction, so no row can slip in unchecked.
--
-- WHY THE FUNCTIONS COPE WITHOUT IT (the marker on line 1):
--   Until this is applied, the new Log button answers admin_log_not_ready
--   (503, "paused until the admin-log database update is applied") and
--   nothing is written: the insert is refused by the old check inside the
--   create RPC's transaction. Every other pto action (overview, quote,
--   request, decide, cancel, adjust, set_start_date) is unchanged.
--
-- HOW TO TELL IT IS APPLIED (expect true):
--   select position('admin_log' in pg_get_constraintdef(oid)) > 0 as applied
--   from pg_constraint
--   where conrelid = 'public.pto_requests'::regclass
--     and conname = 'pto_requests_source_check';
--
-- ACCESS. The table's privileges are restated with all four roles named:
--   revoked from public, anon, authenticated and service_role, then
--   service_role alone gets SELECT, INSERT, UPDATE, DELETE back (what the pto
--   function uses; it is also what 2026-07-15-pto-cancellation-audit.sql
--   grants). The browser roles keep nothing. RLS stays on.
--
-- No HR rows, member ids, dates or names are read or written here.
-- Idempotent: safe to run twice.
--
-- ROLLBACK (only once no admin_log row exists, or after relabelling them):
--   alter table public.pto_requests drop constraint pto_requests_source_check;
--   alter table public.pto_requests add constraint pto_requests_source_check
--     check (source in ('syncview', 'hrvey_migration'));
-- ============================================================
begin;

do $pto_admin_log_needs$
begin
  if to_regclass('public.pto_requests') is null then
    raise exception 'pto_admin_log_source needs migrations/2026-07-15-pto-tracker.sql applied first';
  end if;
end
$pto_admin_log_needs$;

alter table public.pto_requests drop constraint if exists pto_requests_source_check;
alter table public.pto_requests add constraint pto_requests_source_check
  check (source in ('syncview', 'hrvey_migration', 'admin_log'));

alter table public.pto_requests enable row level security;
revoke all on table public.pto_requests from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.pto_requests to service_role;

commit;
