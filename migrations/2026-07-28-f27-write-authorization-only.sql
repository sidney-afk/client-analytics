-- F27 write-authorization fence: the minimum the DEPLOYED gateway already requires.
--
-- WHY THIS EXISTS
-- `production-write` v26 (deployed 2026-07-26, fence in source since e28c4b1 on
-- 2026-07-21) calls `f27WriteAuthorizationGeneration` at index.ts:3483, inside
-- `handleEntityOperation` — the handler for every write that is not
-- create/intake_create. That calls `public.track_b_f27_write_authorization`,
-- which does not exist in the live database (PGRST202). Every entity write
-- therefore refuses with 503 `authority_unavailable` before reaching any
-- business logic, including blocker #8's assignment path.
--
-- The function ships in `2026-07-20-f27-team-rollback.sql`, deliberately
-- unapplied because the F27 install was aborted before DDL (PR #901) and is
-- gated behind two owner windows in `docs/ops/F27_INSTALL_RUNBOOK.md`. That
-- gating is correct and stays. This file extracts ONLY the two objects the
-- deployed gateway already depends on, verbatim, so the deployed code stops
-- calling something that isn't there.
--
-- WHAT THIS DOES NOT DO
-- It does not install F27. It creates no rollback machinery, alters no existing
-- table, replaces no existing function, installs no trigger, and changes no
-- flag or authority value. In particular it deliberately OMITS the parent
-- migration's `alter table public.mirror_outbox`, its replacement of
-- `public.mirror_outbox_enqueue`, and the `track_b_f27_hold_guard` trigger —
-- those change live outbox behaviour and belong to the gated install windows.
--
-- FORWARD COMPATIBILITY
-- Every statement is idempotent and byte-identical to the parent migration
-- (`create table if not exists`, `on conflict do nothing`, `create or replace
-- function`), so the full F27 migration re-applies cleanly over this later.
--
-- EFFECT ON BEHAVIOUR
-- With both teams seeded at generation 0 and `prod_authority` holding a valid
-- object, the function returns ok/true and the fence passes. Writes then reach
-- the checks that were always meant to judge them. It does NOT bypass any
-- authority or parity gate: `assertLegacyParityEnabled` runs at index.ts:3482,
-- one line EARLIER, and is unaffected by this file.
--
-- ============================================================================
-- APPLIED STATUS — READ THIS BEFORE EDITING ANYTHING BELOW
-- ============================================================================
-- THIS FILE WAS APPLIED TO PRODUCTION ON 2026-07-28. Unlike every other
-- unapplied delta in this folder, editing it does NOT change the database.
--
-- Verified read-only the same day, anon key, no service credential — the probe
-- distinguishes "exists but you may not call it" from "does not exist":
--   track_b_f27_write_authorization -> HTTP 401 `42501 permission denied for
--                                      function`  (EXISTS; grants are correct)
--   track_b_f27_hold_guard          -> HTTP 404 `PGRST202`  (absent, as designed)
--   production_assert_authority     -> HTTP 404 `PGRST202`  (absent, as designed)
--   <deliberately fake name>        -> HTTP 404 `PGRST202`  (control)
--
-- CONSEQUENCE: any change to the `create or replace function` body below is
-- source-only until it is re-pasted into the Supabase SQL editor. Until then
-- the repo and the live database silently disagree — the exact drift class
-- this project has been bitten by before. The statement is idempotent and
-- additive; with both teams at `linear` it changes no live decision.
--
-- The F55 edit below (dropping the legacy `supabase` alias) is such a change.
-- It has NOT been re-applied as of this commit. Re-apply, read back, and
-- record it in `EXECUTION_LOG.md`; only then may the F55 checklist box in
-- `docs/independence/GO_LIVE_CHECKLIST.md` be ticked.
--
-- The parent `2026-07-20-f27-team-rollback.sql` remains fully unapplied and
-- stays gated behind the two owner windows in `docs/ops/F27_INSTALL_RUNBOOK.md`;
-- statements that "the F27 SQL is not live-applied" are true of that file and
-- FALSE of this one.

begin;

-- Verbatim from 2026-07-20-f27-team-rollback.sql lines 11-20.
create table if not exists public.track_b_f27_team_fences (
  team text primary key check (team in ('video', 'graphics')),
  generation bigint not null default 0 check (generation >= 0),
  updated_at timestamptz not null default now(),
  updated_by text not null
);

insert into public.track_b_f27_team_fences (team, generation, updated_by)
values ('video', 0, 'f27-migration'), ('graphics', 0, 'f27-migration')
on conflict (team) do nothing;

-- Verbatim from 2026-07-20-f27-team-rollback.sql lines 205-236. F55 removed the
-- backend-only `supabase` alias from both copies in the same change so they
-- stay byte-identical; the canonical vocabulary is exactly `linear`/`syncview`.
create or replace function public.track_b_f27_write_authorization(p_team text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare
  v_team text := lower(nullif(btrim(coalesce(p_team, '')), ''));
  v_generation bigint;
  v_authority jsonb;
begin
  if v_team not in ('video', 'graphics') then
    raise exception 'f27_invalid_write_team';
  end if;
  select generation into v_generation
  from public.track_b_f27_team_fences where team = v_team;
  select value into v_authority
  from public.syncview_runtime_flags where key = 'prod_authority';
  if v_generation is null or jsonb_typeof(v_authority) is distinct from 'object'
     or lower(coalesce(v_authority->>v_team, '')) not in ('linear', 'syncview') then
    raise exception 'f27_write_authorization_unavailable';
  end if;
  return jsonb_build_object(
    'ok', true,
    'type', 'f27_write_authorization',
    'team', v_team,
    'authority', lower(v_authority->>v_team),
    'generation', v_generation
  );
end;
$fn$;

-- Grants, matching the parent migration's posture (lines 1230-1237): the table
-- is service-role read-only and unreachable from anon/authenticated; the
-- function is callable only by the service role the Edge Function uses.
revoke all on table public.track_b_f27_team_fences from public, anon, authenticated, service_role;
grant select on table public.track_b_f27_team_fences to service_role;
revoke all on function public.track_b_f27_write_authorization(text)
  from public, anon, authenticated;
grant execute on function public.track_b_f27_write_authorization(text) to service_role;

commit;
