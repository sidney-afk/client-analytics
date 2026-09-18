-- Draft/unapplied. Additive. No grant is widened, no flag moves, no provider
-- call is made, and no existing routine body is replaced.
--
-- WHY. A natively created card carries no `linear_raw -> issue -> labels`
-- relation at all -- native intake never stamps one, and nothing else does.
-- The gateway's nativeLabelSnapshot (supabase/functions/production-write/
-- index.ts:797-818) returns null unless that relation has a `nodes` ARRAY and
-- `pageInfo.hasNextPage` exactly false, so with the label capability on
-- `native` the read refuses with `native_label_state_incomplete`
-- (index.ts:5611) and the Production tab still renders "Labels unavailable" --
-- the same string it renders today for a different reason. Turning the
-- capability on does not, by itself, give a native card an editable label
-- list. This migration is what does.
--
-- The seeded value is the empty-but-COMPLETE relation:
--   {"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}
-- which is exactly what production_labels_write itself writes when a selection
-- is cleared (2026-09-06-native-label-writes.sql:180). "No labels" and "labels
-- unknown" are different states, and only the first is true of a new card.
--
-- WORKLOAD IS UNAFFECTED, and that is checked rather than hoped. The weekly
-- view branches on workload_native_label_state_absent: absent gives
-- `workload_labels_complete = true` and `workload_labels = []`
-- (2026-09-09-workload-native-roster.sql:27-31). Feeding the seeded relation
-- to production_workload_label_projection returns complete:true with an empty
-- label array as well (2026-07-23-f34-f53-production-attachments.sql:85-101 --
-- an empty `nodes` passes every structural check and the node loop does not
-- run), so both branches agree and no row changes weight.
begin;

-- ONE definition of the seeded shape, used by both the backfill and the
-- trigger, so the two can never drift apart.
create function public.production_native_label_empty_state(p_raw jsonb)
returns jsonb language sql immutable set search_path=pg_catalog,public as $fn$
  select case
    -- Absent everything: build the minimum envelope the reader needs.
    when p_raw is null or jsonb_typeof(p_raw)='null'
      then jsonb_build_object('issue',jsonb_build_object('labels',
             jsonb_build_object('nodes','[]'::jsonb,
               'pageInfo',jsonb_build_object('hasNextPage',false,'endCursor',null))))
    -- Not an object, or an `issue` that is not an object: NOT ours to repair.
    -- A malformed relation is a real problem and must keep failing loudly
    -- rather than being quietly replaced with "this card has no labels".
    when jsonb_typeof(p_raw)<>'object' then p_raw
    when p_raw->'issue' is null or jsonb_typeof(p_raw->'issue')='null'
      then jsonb_set(p_raw,'{issue}',jsonb_build_object('labels',
             jsonb_build_object('nodes','[]'::jsonb,
               'pageInfo',jsonb_build_object('hasNextPage',false,'endCursor',null))))
    when jsonb_typeof(p_raw->'issue')<>'object' then p_raw
    -- A relation that is already present is never overwritten, complete or
    -- not. Only a genuinely ABSENT one is seeded.
    when (p_raw->'issue')->'labels' is null
      then jsonb_set(p_raw,'{issue,labels}',
             jsonb_build_object('nodes','[]'::jsonb,
               'pageInfo',jsonb_build_object('hasNextPage',false,'endCursor',null)))
    else p_raw
  end;
$fn$;

-- The seed predicate is the workload lane's own "absent" test, deliberately
-- reused rather than restated: this migration seeds exactly the population
-- that lane already treats as "complete, with no labels", which is why it
-- cannot change a single workload weight.
create function public.production_native_label_seed_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare v_raw jsonb;
begin
  -- A card with a provider issue is not ours: its relation is whatever the
  -- last Linear read stored, and an absent one there means "not read yet",
  -- which is a different fact from "this card has no labels".
  if new.linear_issue_uuid is not null then return new; end if;
  if public.workload_native_label_state_absent(new.linear_raw) then
    v_raw:=public.production_native_label_empty_state(new.linear_raw);
    if v_raw is distinct from new.linear_raw then new.linear_raw:=v_raw; end if;
  end if;
  -- HOLD THE CLOCK ON A SEED-ONLY UPDATE. Every production write is CAS-guarded
  -- on updated_at, so moving it for a change no human made would hand an open
  -- tab a write_conflict out of nowhere. This fires whether the seeding was
  -- done by the branch above or by the backfill statement below, because in the
  -- backfill the STATEMENT supplies the seeded value and the branch above is a
  -- no-op. Any other column difference fails the last test, so a real write
  -- still stamps its own timestamp; track_b_deliverable_touch_timestamps_before
  -- has already set now(), and this trigger's name sorts after it so the
  -- restore lands last.
  if tg_op='UPDATE'
     and old.linear_raw is distinct from new.linear_raw
     and new.linear_raw is not distinct from public.production_native_label_empty_state(old.linear_raw)
     and (to_jsonb(new)-'linear_raw'-'updated_at') is not distinct from (to_jsonb(old)-'linear_raw'-'updated_at')
  then
    new.updated_at:=old.updated_at;
  end if;
  return new;
end; $fn$;

-- Named to sort AFTER track_b_deliverable_touch_timestamps_before, which sets
-- new.updated_at := now() unconditionally; the restore above only works from
-- a trigger that runs later, and PostgreSQL fires same-timing triggers in name
-- order. It also sorts before zzz_production_native_identifier_mint, which
-- touches different columns entirely.
drop trigger if exists zzz_native_label_state_seed on public.deliverables;
create trigger zzz_native_label_state_seed
  before insert or update on public.deliverables
  for each row execute function public.production_native_label_seed_guard();

-- Existing native cards. app.event_written suppresses the ledger guard
-- (2026-07-06-b1-linear-data-model.sql:246), which would otherwise insert a
-- deliverable_events row per card and enqueue a provider mirror_outbox row for
-- every one of them -- provider debt manufactured by a maintenance backfill.
-- The trigger above holds updated_at still, so no card's CAS moves either.
do $$
declare v_seeded bigint;
begin
  perform set_config('app.event_written','1',true);
  update public.deliverables d
     set linear_raw=public.production_native_label_empty_state(d.linear_raw)
   where d.linear_issue_uuid is null
     and public.workload_native_label_state_absent(d.linear_raw);
  get diagnostics v_seeded=row_count;
  raise notice 'native label empty state seeded on % card(s)',v_seeded;
  -- Fail closed: if any native card still reads as absent afterwards, the
  -- predicate and the seeder disagree and the migration must not commit.
  if exists(select 1 from public.deliverables d
             where d.linear_issue_uuid is null
               and public.workload_native_label_state_absent(d.linear_raw)) then
    raise exception 'native_label_seed_incomplete';
  end if;
end $$;

-- Nothing is granted. All four roles are named so the absence is a statement
-- rather than an omission: the trigger function is reachable only as a trigger,
-- and the shape helper is needed by no caller outside this file.
revoke all on function public.production_native_label_empty_state(jsonb),
  public.production_native_label_seed_guard()
  from public, anon, authenticated, service_role;
commit;
