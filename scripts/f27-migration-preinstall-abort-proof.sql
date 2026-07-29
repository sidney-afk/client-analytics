\set ON_ERROR_STOP on

-- Run only after the checked-in parent migration returned a known gate error
-- in a disposable drift database.  Any first-DDL residue means the atomic
-- precondition did not abort before mutation.
do $f27_abort_proof$
begin
  if to_regclass('public.track_b_team_rollbacks') is not null
     or to_regclass('public.track_b_team_rollback_intents') is not null
     or to_regprocedure('public.track_b_f27_requeue(bigint,bigint)') is not null
     or to_regprocedure('public.track_b_f27_hold_guard()') is not null
     or to_regprocedure(
       'public.production_assert_authority(text,text,boolean,boolean)'
     ) is not null
     or to_regprocedure('public.track_b_f27_begin(text,jsonb,text)') is not null
     or exists (
       select 1
       from pg_attribute
       where attrelid = 'public.mirror_outbox'::regclass
         and attnum > 0
         and not attisdropped
         and attname in ('authority_generation', 'f27_drill_rollback_id')
     )
     or exists (
       select 1
       from pg_trigger
       where tgrelid = 'public.mirror_outbox'::regclass
         and not tgisinternal
         and tgname = 'track_b_f27_hold_guard'
     )
     or exists (
       select 1
       from public.mirror_outbox
       where entity_id = 'f27-migration-test'
          or dedup_key like 'f27-migration-test:%'
     ) then
    raise exception 'F27_PREINSTALL_DRIFT_ABORT_LEFT_DDL_RESIDUE';
  end if;
end
$f27_abort_proof$;

select 'F27_PREINSTALL_DRIFT_ABORT_OK' as terminal;
