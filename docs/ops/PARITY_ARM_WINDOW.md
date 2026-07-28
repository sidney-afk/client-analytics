# Parity-arm window (F4 forward) — owner-gated, approved 2026-07-28

**Status:** NOT ARMED. Approved by the owner in the 2026-07-28 re-scope (decision 4) as Phase 1
step 3 pulled early. One flag CAS, no deploy, no migration.

## In one paragraph

`linear_legacy_parity_enabled` is the switch the deployed gateway checks before accepting a
"legacy-parity" write — the lane every crosswalk-linked card's mark-done/edit/delete comment
action already routes through. It has been `false` since 2026-07-13 while the routing that needs
it shipped on 2026-07-24, which is the mark-done deadlock (population (a), ~24 clients). Arming it
lets those writes land canonically and mirror to Linear. It is also a required flip step, so this
window advances the flip rather than detouring from it.

## What changes when it flips

- Gateway comment lifecycle writes (mark done / reopen / edit / delete on crosswalk-linked cards)
  stop refusing 409 `legacy_parity_disabled` and commit canonically.
- Mirror intents for those writes drain to **real Linear** with author "SyncView Mirror". This
  lane is intentionally independent of `linear_outbound_enabled` (still `off`): parity rows can
  write while normal outbound stays off (FLIP_RUNBOOK §F4).
- Nothing else reads this flag. `prod_authority` stays linear/linear; no client is enrolled in any
  cohort by this change.

## Preconditions (verify, do not assume)

1. Read back the flag is exactly `{"enabled":false}` and `prod_authority` is linear/linear.
2. The mark-done honesty fix (coverage-failure hold) is merged, so population (b) is already on
   the working legacy path and any post-arm failure is attributable.
3. `mirror_outbox`: record the current count of non-terminal rows (baseline for the watch).
4. A staff browser session available to perform one real mark-done immediately after arming.

## Apply

FLIP_RUNBOOK **§F4 forward block**, verbatim, in the Supabase SQL editor. It CASes from exactly
`{"enabled":false}` and refuses otherwise. Record the flag event in `EXECUTION_LOG.md`.

## Watch (first hour)

- One real mark-done on a linked card: succeeds in the UI, survives modal reopen (no silent
  revert), and its canonical row shows `done`.
- `mirror_outbox` non-terminal count returns to baseline as the drain runs; no growing backlog.
  The `linear_outbound_pending_age_alert` pager (30 min) is the tripwire if it stalls.
- Spot-check in Linear: the mirrored action appears authored "SyncView Mirror" on the right issue.
- `deliverable_events` / reconcile summaries show no new failure-like class.

## Rollback

FLIP_RUNBOOK **§F4 emergency parity kill**, one CAS back to `{"enabled":false}`. Safe at any
time; queued parity intents are retained, not lost, per F43's debt semantics. If killed, mark-done
returns to the current (broken) state for population (a) — nothing is worse than before the window.
