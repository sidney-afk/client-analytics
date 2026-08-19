-- Samples native create, schema layer (owner task: "samples should have their
-- own batches", 2026-08-18).
--
-- Adds ONE column. No data is rewritten, no constraint is placed on any
-- existing row's values beyond the default they receive.
--
-- WHY A COLUMN AND NOT A NAMING CONVENTION
-- Sample batches must never appear in the Calendar dialog's previous-batch
-- picker, and calendar batches never in the Samples picker (owner ruling).
-- That is a filter both pickers have to apply, on every read, forever. A
-- derived signal (name prefix, presence of a card, origin of the first row)
-- would make every one of those reads a guess; a column makes it a fact.
--
-- BACKFILL IS THE DEFAULT, DELIBERATELY
-- Every batch that exists today was created by the Calendar flow, so
-- `default 'calendar'` combined with `not null` gives the correct value to all
-- of them without a separate UPDATE. Pre-column rows and post-column calendar
-- rows are therefore indistinguishable, which is what we want -- the Calendar
-- picker filters `purpose = 'calendar'` and gets exactly the set it had
-- before this migration.
--
-- Written and compiled against a disposable PostgreSQL 16 with the live
-- batches shape before handover (house rule since the v2 CASE defect: no
-- migration is handed over unexecuted).

begin;

-- Idempotent: re-running this is a no-op, so a partial apply can be retried.
alter table public.batches
  add column if not exists purpose text;

-- Existing rows first, THEN the not-null. Doing it in this order means the
-- statement never has to rewrite a table that already holds nulls, and a
-- re-run after a partial apply still converges.
update public.batches
   set purpose = 'calendar'
 where purpose is null;

alter table public.batches
  alter column purpose set default 'calendar';

alter table public.batches
  alter column purpose set not null;

-- The check is added separately and guarded, because `add constraint` has no
-- `if not exists` form and would abort the whole transaction on a re-run.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.batches'::regclass
       and conname = 'batches_purpose_check'
  ) then
    alter table public.batches
      add constraint batches_purpose_check
      check (purpose in ('calendar', 'samples'));
  end if;
end
$$;

-- Both pickers filter by (client_slug, purpose, status). The existing
-- batches_client_status_idx does not cover purpose, so without this every
-- picker open degrades to a filter on top of that index as the samples set
-- grows.
create index if not exists batches_client_purpose_status_idx
  on public.batches (client_slug, purpose, status);

commit;

-- ROLLBACK (inverse, safe to paste as-is):
--
--   begin;
--   drop index if exists public.batches_client_purpose_status_idx;
--   alter table public.batches drop constraint if exists batches_purpose_check;
--   alter table public.batches drop column if exists purpose;
--   commit;
--
-- Dropping the column discards only the calendar/samples distinction. No
-- deliverable, outbox row or Linear parent references it.
