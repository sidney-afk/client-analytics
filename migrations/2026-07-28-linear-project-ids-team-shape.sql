-- Linear project-ids shape conversion: bare-string array/scalar -> team-keyed object.
--
-- STATUS: REVIEWED, NOT APPLIED. This file authorizes nothing by existing in
-- the repo. It is a manually-run Supabase SQL-editor delta per this folder's
-- convention (see README.md) and requires a separate owner-approved window to
-- execute. Nothing in CI, `supabase/config.toml`, or `scripts/` runs it.
--
-- GO_LIVE_CHECKLIST.md Phase 0 item ("Every active client's
-- `linear_project_ids` uses the team-keyed shape") / PHASE0_AUDIT_2026-07-28.md
-- remaining item #5 ("One reviewed data window").
--
-- WHY THIS EXISTS
-- `projectIdsForTeam` (supabase/functions/production-write/policy.mjs) accepts
-- only a team-keyed object (`{"video":"<id>","graphics":"<id>"}`) or a list
-- whose entries each carry their own `team` tag. A bare JSON array of plain id
-- strings (`["<id>"]`) -- or a bare JSON string scalar (`"<id>"`, no array
-- wrapper at all, a documented legacy shape per
-- scripts/production-write-project-mapping.js's `configuredProjectIds`) --
-- resolves to ZERO ids for every team, so `projectForIntake` throws
-- `409 project_mapping_missing` on the first native create for that client.
-- This is invisible today only because `prod_authority` is `linear` for both
-- teams (that lane never reads the field) and becomes live-blocking the
-- moment a team flips.
--
-- Measured 2026-07-27: 31 rows team-keyed, 7 rows bare-string, 1 empty
-- (`unattributed`, internal). RE-VERIFY THESE COUNTS (Part 0 below) before
-- proceeding past Part 0 -- the roster may have changed since 2026-07-27, and
-- this file must act on live data, not the stale headline number.
--
-- SCOPE
-- - Only `public.clients` rows where `active = true`, `kind = 'client'`, and
--   `linear_project_ids` is EITHER a JSON array whose sole element is a plain
--   non-empty string, OR a bare non-empty JSON string scalar. Already
--   team-keyed objects, NULL, and empty (`{}`/`[]`/`""`) values are read but
--   never written by Part 1.
-- - The TEST client is hard-excluded BY SLUG in every write statement in this
--   file (Part 1, Part 3's template, and the ROLLBACK block), independent of
--   its `kind`: `b4-write` reads `sidneylaruel` flat and the drill depends on
--   the bare shape surviving. Confirm the live TEST slug still matches
--   before running this file.
-- - The `unattributed`/internal empty row is excluded because it is not
--   `kind = 'client'`. Part 2b below separately (read-only) surfaces any
--   OTHER non-`client`-kind row that turns out not to be empty -- see that
--   section for why `kind = 'client'` is not widened automatically.
--
-- SAFE-AUTO vs MANUAL-REVIEW SPLIT
-- Part 1 converts ONLY a single-element bare array (`["<id>"]`) or a bare
-- scalar string (`"<id>"`) to the shared-project shape
-- `{"video":"<id>","graphics":"<id>"}` -- the documented dominant historical
-- pattern (28 of the 31 rows fixed in the 2026-07-13 #819 operation used one
-- shared project for both teams; 3 used separate per-team projects). This
-- file does NOT verify against live Linear that the shared project actually
-- carries both team tags -- Part 1's readback only proves the STORED shape
-- now resolves a non-empty id for both teams, exactly mirroring what
-- `projectIdsForTeam` does at write time. Confirm each converted client's
-- Linear project team tags out-of-band (Linear `list_projects`/
-- `get_project`, or the Linear UI) before trusting the result for real
-- native-create traffic.
--
-- Any bare array with zero or 2+ string elements, or an empty-string scalar,
-- is NEVER guessed. Part 3 surfaces those rows (if any exist live) for
-- owner+Linear-confirmed manual completion, using the same audit/CAS/
-- readback discipline as Part 1. A bare array containing a non-string
-- element (an exotic shape not documented as occurring in this dataset) is
-- deliberately left `other_unclassified` by Part 0 and untouched everywhere
-- else -- out of this migration's declared remit.
--
-- POSTGRES SAFETY NOTE -- every predicate below that touches an array-only
-- jsonb function (`jsonb_array_length`, `jsonb_array_elements`, both of which
-- ERROR on non-array input) guards that call behind a CASE whose WHEN test is
-- a bare `jsonb_typeof(...) = '<kind>'` equality (which never throws,
-- regardless of shape). This is required, not decorative: PostgreSQL does
-- NOT guarantee left-to-right evaluation of a flat `AND`-ed WHERE clause, so
-- `jsonb_typeof(x) = 'array' and jsonb_array_length(x) > 0` can and does
-- error out against real object-shaped rows if the planner reorders the two
-- conjuncts -- reproduced empirically against a seeded PostgreSQL 16.13
-- instance during review. A CASE's WHEN is evaluated in written order and its
-- THEN is only evaluated once that WHEN's own (throw-free) test is true, so
-- nesting the risky call inside the THEN branch is the documented-safe fix
-- (see PostgreSQL docs section 4.2.14, "Expression Evaluation Rules").
--
-- PRIVACY (F64) -- this file is intentionally data-free: no real client slug,
-- display name, or Linear project id is hardcoded anywhere in it. Every
-- predicate is computed against live data at run time. If you fill in
-- Part 3's manual template with a real slug/project id while working the
-- live incident, keep that filled-in copy OUTSIDE this repository -- do not
-- commit real client identities or Linear ids back into this file.
--
-- ROLLBACK
-- Every touched row's prior `linear_project_ids` value is captured verbatim
-- in a durable audit table before the UPDATE. The ROLLBACK block at the
-- bottom of this file restores it exactly, CAS'd on the value (and the
-- `updated_at` timestamp) this migration wrote, so it refuses (never
-- clobbers) any row that changed again since. A row that was applied then
-- rolled back can be recaptured by a later run of this same file (the audit
-- table's insert reopens a reverted row; see Part 1).

-- ============================================================================
-- PART 0 — RE-VERIFY (read-only). Run this alone first. Compare the
-- `bare_string_array` / `bare_string_scalar` row counts and their `slugs`
-- against the 2026-07-27 baseline (31 / 7 / 1) before continuing. New clients
-- appearing here is expected and fine; what matters is that every
-- `bare_string_array`/`bare_string_scalar` slug is one you are prepared to
-- see converted by Part 1 or handled by Part 3.
-- ============================================================================

select
  kind,
  case
    when linear_project_ids is null or linear_project_ids = 'null'::jsonb then 'empty_null'
    when jsonb_typeof(linear_project_ids) = 'object' and linear_project_ids = '{}'::jsonb then 'empty_object'
    when jsonb_typeof(linear_project_ids) = 'string' then
      case when btrim(linear_project_ids #>> '{}') = '' then 'empty_string' else 'bare_string_scalar' end
    when jsonb_typeof(linear_project_ids) = 'object' then 'team_keyed_object'
    when jsonb_typeof(linear_project_ids) = 'array' then
      case
        when jsonb_array_length(linear_project_ids) = 0 then 'empty_array'
        when (select bool_and(jsonb_typeof(elem) = 'string') from jsonb_array_elements(linear_project_ids) as elem)
          then 'bare_string_array'
        else 'other_unclassified'
      end
    else 'other_unclassified'
  end as shape_bucket,
  count(*) as row_count,
  array_agg(slug order by slug) as slugs
from public.clients
where active = true
group by kind, shape_bucket
order by shape_bucket, kind;

-- ============================================================================
-- PART 1 — CONVERSION (writes). Run only after Part 0 looks sane. Single
-- transaction; aborts (raises, rolls back everything below) rather than
-- leaving a partial apply if the candidate count and the actually-converted
-- count ever disagree.
-- ============================================================================

begin;

-- Durable, service-role-only evidence table. Kept for provenance (not
-- dropped after use), same posture as this repo's other narrowly-scoped
-- audit tables. Re-running this file is safe: a slug already captured and
-- still pending/applied is never re-touched (`where reverted_at is not
-- null` on the upsert below); a slug that was applied and later rolled back
-- IS reopened as a fresh candidate, so a legitimate redo is possible without
-- manual surgery on this table.
create table if not exists public.linear_project_ids_shape_migration_20260728 (
  slug text primary key references public.clients(slug),
  captured_at timestamptz not null default now(),
  before_linear_project_ids jsonb not null,
  after_linear_project_ids jsonb,
  applied_at timestamptz,
  reverted_at timestamptz
);

alter table public.linear_project_ids_shape_migration_20260728 enable row level security;
revoke all on table public.linear_project_ids_shape_migration_20260728 from public, anon, authenticated;
grant select, insert, update on table public.linear_project_ids_shape_migration_20260728 to service_role;

-- Capture before-state for exactly the safe-auto candidates: active,
-- kind='client', not TEST, linear_project_ids is a single-element array of
-- one non-empty string OR a bare non-empty string scalar. Multi-/zero-element
-- bare arrays and empty-string scalars are deliberately left uncaptured here
-- -- see Part 3.
insert into public.linear_project_ids_shape_migration_20260728 (slug, before_linear_project_ids)
select slug, linear_project_ids
from public.clients
where active = true
  and kind = 'client'
  and slug <> 'sidneylaruel'
  and case
    when jsonb_typeof(linear_project_ids) = 'array' then
      jsonb_array_length(linear_project_ids) = 1
      and (select bool_and(jsonb_typeof(elem) = 'string') from jsonb_array_elements(linear_project_ids) as elem)
    when jsonb_typeof(linear_project_ids) = 'string' then
      btrim(linear_project_ids #>> '{}') <> ''
    else false
  end
on conflict (slug) do update set
  before_linear_project_ids = excluded.before_linear_project_ids,
  captured_at = now(),
  applied_at = null,
  reverted_at = null
where public.linear_project_ids_shape_migration_20260728.reverted_at is not null;

-- Print the captured before-state now, before any write. Save this output
-- externally as evidence — the audit table is the durable copy, but do not
-- rely on it being the only one.
select slug, before_linear_project_ids, captured_at
from public.linear_project_ids_shape_migration_20260728
where applied_at is null and reverted_at is null
order by slug;

-- Convert, with an affected-row assertion and a per-row readback check. Both
-- failures abort the whole transaction (nothing above is left half-applied).
do $$
declare
  v_candidates int;
  v_updated int;
begin
  select count(*) into v_candidates
  from public.linear_project_ids_shape_migration_20260728
  where applied_at is null and reverted_at is null;

  with converted as (
    update public.clients c
    set linear_project_ids = jsonb_build_object(
          'video', case when jsonb_typeof(a.before_linear_project_ids) = 'array'
                        then a.before_linear_project_ids ->> 0
                        else a.before_linear_project_ids #>> '{}'
                   end,
          'graphics', case when jsonb_typeof(a.before_linear_project_ids) = 'array'
                           then a.before_linear_project_ids ->> 0
                           else a.before_linear_project_ids #>> '{}'
                      end
        ),
        updated_at = now()
    from public.linear_project_ids_shape_migration_20260728 a
    where c.slug = a.slug
      and a.applied_at is null
      and a.reverted_at is null
      -- CAS: only touch a row that still holds exactly what we captured.
      and c.linear_project_ids = a.before_linear_project_ids
      and c.active = true
      and c.kind = 'client'
      and c.slug <> 'sidneylaruel'
    returning c.slug, c.linear_project_ids as after_value
  )
  update public.linear_project_ids_shape_migration_20260728 a
  set after_linear_project_ids = converted.after_value,
      applied_at = now()
  from converted
  where a.slug = converted.slug;

  get diagnostics v_updated = row_count;

  if v_updated <> v_candidates then
    raise exception
      'linear_project_ids_shape_migration: expected % candidate row(s) to convert, but % were actually updated — partial apply refused',
      v_candidates, v_updated;
  end if;

  if exists (
    select 1
    from public.linear_project_ids_shape_migration_20260728 a
    where a.applied_at = now()
      and a.reverted_at is null
      and not (
        a.after_linear_project_ids ? 'video'
        and length(btrim(a.after_linear_project_ids ->> 'video')) > 0
        and a.after_linear_project_ids ? 'graphics'
        and length(btrim(a.after_linear_project_ids ->> 'graphics')) > 0
      )
  ) then
    raise exception
      'linear_project_ids_shape_migration: readback found a converted row that does not resolve a non-empty id for both required teams';
  end if;

  raise notice 'linear_project_ids_shape_migration: % row(s) converted and read back clean', v_updated;
end $$;

-- Final in-transaction summary: only the rows THIS run touched (`now()` is
-- constant for the whole transaction, so it exactly matches what the DO
-- block above just stamped and excludes any earlier run's rows).
select slug, before_linear_project_ids, after_linear_project_ids, applied_at
from public.linear_project_ids_shape_migration_20260728
where applied_at = now() and reverted_at is null
order by slug;

commit;

-- ============================================================================
-- PART 2 — POST-APPLY READBACK (read-only; safe to re-run anytime). Proves,
-- against live `public.clients` directly (not the audit table), that Part 1
-- converted every row it was eligible to convert. This mirrors Part 1's own
-- candidate predicate exactly: zero rows means every eligible row was
-- converted; any row listed here means Part 1 SHOULD have converted it but
-- didn't — investigate before trusting this migration's result. It will
-- never list a multi-/zero-element array or an empty-string scalar (those
-- were never Part 1's target) — see Part 3 for those.
-- ============================================================================

select slug, jsonb_typeof(linear_project_ids) as shape
from public.clients
where active = true
  and kind = 'client'
  and slug <> 'sidneylaruel'
  and case
    when jsonb_typeof(linear_project_ids) = 'array' then
      jsonb_array_length(linear_project_ids) = 1
      and (select bool_and(jsonb_typeof(elem) = 'string') from jsonb_array_elements(linear_project_ids) as elem)
    when jsonb_typeof(linear_project_ids) = 'string' then
      btrim(linear_project_ids #>> '{}') <> ''
    else false
  end
order by slug;

-- ============================================================================
-- PART 2b — ADDITIONAL VISIBILITY CHECKS (read-only; out of this migration's
-- write scope, never auto-remediated). Two things the checklist item and
-- the JS reader contract both care about that a bare-shape conversion alone
-- does not prove.
-- ============================================================================

-- (i) Does any ALREADY team-keyed object fail to resolve both teams? Part 1
-- never touches object-shaped rows (they were reported "team-keyed" and
-- presumed complete per the 2026-07-13 #819 readback), but a client
-- onboarded or edited since then could hold a partial object (e.g. only
-- `{"video":"..."}`), which produces the identical 409 the moment Graphics
-- authority flips. This does not attempt to guess the missing team's project
-- id -- that is a separate, owner-driven fix.
select slug, display_name, linear_project_ids
from public.clients
where active = true
  and kind = 'client'
  and slug <> 'sidneylaruel'
  and jsonb_typeof(linear_project_ids) = 'object'
  and not (
    linear_project_ids ? 'video'
    and length(btrim(linear_project_ids ->> 'video')) > 0
    and linear_project_ids ? 'graphics'
    and length(btrim(linear_project_ids ->> 'graphics')) > 0
  )
order by slug;

-- (ii) `production-write/index.ts`'s real gateway path (`projectForIntake`,
-- and the `client.kind === 'test'` gate) special-cases ONLY kind='test' --
-- NOT kind='internal'. This migration's scope (`kind = 'client'`) assumes
-- the one documented internal row is empty/unattributed and therefore inert.
-- If this query returns any row, that assumption no longer holds: STOP and
-- get an explicit owner decision on whether that client also needs
-- conversion before treating checklist item #5 as closed. Never silently
-- widen Part 1's scope to include it without that decision.
select slug, display_name, kind, linear_project_ids
from public.clients
where active = true
  and kind <> 'client'
  and slug <> 'sidneylaruel'
  and linear_project_ids is not null
  and linear_project_ids <> 'null'::jsonb
  and linear_project_ids <> '{}'::jsonb
  and linear_project_ids <> '[]'::jsonb
order by slug;

-- ============================================================================
-- PART 3 — MANUAL REVIEW (read-only report + a fill-in-yourself template).
-- Surfaces any active, non-TEST, kind='client' row whose linear_project_ids
-- is a bare array (0 or 2+ string elements) or an empty-string scalar that
-- Part 1 did not convert. Never auto-applied: which raw id belongs to which
-- team cannot be inferred from this table alone and must be confirmed
-- against live Linear (Linear MCP `list_projects` / `get_project`, or the
-- Linear UI) before any write.
-- ============================================================================

select slug, display_name, linear_project_ids
from public.clients
where active = true
  and kind = 'client'
  and slug <> 'sidneylaruel'
  and case
    when jsonb_typeof(linear_project_ids) = 'array' then
      jsonb_array_length(linear_project_ids) = 0
      or (
        jsonb_array_length(linear_project_ids) <> 1
        and (select bool_and(jsonb_typeof(elem) = 'string') from jsonb_array_elements(linear_project_ids) as elem)
      )
    when jsonb_typeof(linear_project_ids) = 'string' then
      btrim(linear_project_ids #>> '{}') = ''
    else false
  end
order by slug;

-- Fill-in-yourself template, ONE block per flagged slug, only after
-- confirming the correct id/team pairing in Linear. Do not commit a filled-in
-- copy back into this repo (F64) — run it from a private, local copy. Uses
-- the same CTE-join + affected-row-assertion discipline as Part 1's DO block
-- so a CAS'd `clients` update that matches zero rows (e.g. the row drifted
-- since capture) can never be recorded as a false "applied" in the audit
-- table.
--
-- do $$
-- declare
--   v_updated int;
-- begin
--   insert into public.linear_project_ids_shape_migration_20260728 (slug, before_linear_project_ids)
--   select slug, linear_project_ids from public.clients
--   where slug = '<SLUG>' and active = true and kind = 'client' and slug <> 'sidneylaruel'
--   on conflict (slug) do update set
--     before_linear_project_ids = excluded.before_linear_project_ids,
--     captured_at = now(),
--     applied_at = null,
--     reverted_at = null
--   where public.linear_project_ids_shape_migration_20260728.reverted_at is not null;
--
--   with converted as (
--     update public.clients c
--     set linear_project_ids = jsonb_build_object(
--           'video', '<VIDEO_PROJECT_ID>',
--           'graphics', '<GRAPHICS_PROJECT_ID>'
--         ),
--         updated_at = now()
--     from public.linear_project_ids_shape_migration_20260728 a
--     where c.slug = a.slug
--       and a.slug = '<SLUG>'
--       and a.applied_at is null
--       and a.reverted_at is null
--       and c.linear_project_ids = a.before_linear_project_ids
--       and c.active = true
--       and c.kind = 'client'
--       and c.slug <> 'sidneylaruel'
--     returning c.slug, c.linear_project_ids as after_value
--   )
--   update public.linear_project_ids_shape_migration_20260728 a
--   set after_linear_project_ids = converted.after_value,
--       applied_at = now()
--   from converted
--   where a.slug = converted.slug;
--
--   get diagnostics v_updated = row_count;
--   if v_updated <> 1 then
--     raise exception 'manual template: expected exactly 1 row to convert for <SLUG>, got % — refusing a partial/false apply', v_updated;
--   end if;
--   raise notice 'manual template: <SLUG> converted and stamped', v_updated;
-- end $$;

-- ============================================================================
-- ROLLBACK — OWNER-ONLY. Restores exactly what Part 1 (and any completed
-- Part 3 blocks) wrote, for every row this migration actually applied.
-- Refuses (raises, rolls back) rather than reverting a partial set if the
-- row count comes up short.
-- ============================================================================

-- begin;
--   do $$
--   declare
--     v_expected int;
--     v_reverted int;
--   begin
--     select count(*) into v_expected
--     from public.linear_project_ids_shape_migration_20260728
--     where applied_at is not null and reverted_at is null;
--
--     with reverted as (
--       update public.clients c
--       set linear_project_ids = a.before_linear_project_ids,
--           updated_at = now()
--       from public.linear_project_ids_shape_migration_20260728 a
--       where c.slug = a.slug
--         and a.applied_at is not null
--         and a.reverted_at is null
--         and c.slug <> 'sidneylaruel'
--         and c.kind = 'client'
--         and c.active = true
--         -- CAS: only revert a row that still holds exactly what we wrote.
--         and c.linear_project_ids = a.after_linear_project_ids
--         -- Narrows the ABA hazard (a coincidentally byte-identical LATER
--         -- legitimate rewrite of this same client, e.g. a second manual
--         -- operator applying the identical shared-project convention):
--         -- also require updated_at to still equal the single applied_at
--         -- timestamp Part 1 stamped on both the row and the audit entry in
--         -- the same transaction. If something else has since touched this
--         -- client's row for ANY reason, this refuses rather than guesses --
--         -- inspect the row by hand in that case.
--         and c.updated_at = a.applied_at
--       returning c.slug
--     )
--     update public.linear_project_ids_shape_migration_20260728 a
--     set reverted_at = now()
--     from reverted
--     where a.slug = reverted.slug;
--
--     get diagnostics v_reverted = row_count;
--
--     if v_reverted <> v_expected then
--       raise exception
--         'linear_project_ids_shape_migration rollback: expected % row(s) to revert, but % were actually reverted — partial rollback refused',
--         v_expected, v_reverted;
--     end if;
--
--     raise notice 'linear_project_ids_shape_migration rollback: % row(s) restored', v_reverted;
--   end $$;
-- commit;
