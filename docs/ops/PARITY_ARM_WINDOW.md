# Parity-arm window (F4 forward) — owner-gated, approved 2026-07-28

**Status:** ARMED 2026-07-28 20:59:55 by the owner under re-scope decision 4.
The live value is `{"enabled":true}`. Do not re-run the forward CAS or silently
disarm it; one flag changed, with no deploy or migration.

## In one paragraph

`linear_legacy_parity_enabled` is the switch the deployed gateway checks before accepting a
"legacy-parity" write — the lane every crosswalk-linked card's mark-done/edit/delete comment
action already routes through. It was `false` from 2026-07-13 until the owner
armed it on 2026-07-28 to clear the mark-done deadlock (population (a), ~24
clients). The armed lane lets those writes land canonically and mirror to
Linear. It is also a required flip step, so this advanced the flip rather than
detouring from it.

## What changes when it flips

- Gateway comment lifecycle writes (mark done / reopen / edit / delete on crosswalk-linked cards)
  stop refusing 409 `legacy_parity_disabled` and commit canonically.
- Mirror intents for those writes drain to **real Linear** with author "SyncView Mirror". This
  lane is intentionally independent of `linear_outbound_enabled` (still `off`): parity rows can
  write while normal outbound stays off (FLIP_RUNBOOK §F4).
- Nothing else reads this flag. `prod_authority` stays linear/linear; no client is enrolled in any
  cohort by this change.

## Completed apply record

- The owner approved and executed the exact §F4 forward CAS.
- `prod_authority` remained Linear/Linear and `linear_outbound_enabled` remained
  off.
- No deploy, migration, client enrollment, authority change, or n8n edit was
  part of the arm.
- Current operations must read the live row again; this dated record does not
  authorize a second write.

## Future operations

The forward apply is complete. Window P in
`docs/ops/F27_INSTALL_RUNBOOK.md` is compatible with the armed value and must
prove it unchanged. The later F27 drill/finalization window requires F4 false;
stop for a fresh owner decision at that boundary rather than using this file to
disarm it.

## Watch (first hour)

- One real mark-done on a linked card: succeeds in the UI, survives modal reopen (no silent
  revert), and its canonical row shows `done`.
- `mirror_outbox` non-terminal count returns to baseline as the drain runs; no growing backlog.
  The `linear_outbound_pending_age_alert` pager (30 min) is the tripwire if it stalls.
- Spot-check in Linear: the mirrored action appears authored "SyncView Mirror" on the right issue.
- `deliverable_events` / reconcile summaries show no new failure-like class.

## Rollback

FLIP_RUNBOOK **§F4 emergency parity kill** is the reviewed one-CAS containment
path back to `{"enabled":false}`; queued parity intents are retained, not lost,
per F43's debt semantics. It is an emergency/owner action, not an F27
precondition workaround. Killing it reintroduces the known mark-done failure
for population (a), so an operator who reaches a false-required gate must stop
and ask the owner.
