# PTO / Time Off release audit — 2026-07-15

## Result

The live PTO data boundary and current stored state passed the read-only audit,
but the end-to-end lifecycle was not fully correct at the start of this review.
The most important defect was a UTC-based policy date: during the company's
evening, PTO rules could advance to the following day early. The review also
found unnecessary private detail in the staff calendar response, incomplete
admin cancellation/history UX, destructive cancellation attribution, unsafe
historical start-date edits, stale launch documentation, and no real PTO browser
suite.

This PR fixes those release-critical source gaps and the requested visual
controls. It does **not** merge, deploy, apply SQL, flip a flag, or write live
PTO/HR data. Owner decision D-36 remains the authority for operating under the
current shared-role-key identity model.

No staff names, hire dates, notes, request details, keys, or balance values are
recorded in this public audit.

## Read-only live evidence

The following checks passed without mutation:

- `pto_v1` was on and the deployed `pto` function was active with its intended
  function-owned staff authentication boundary;
- admin and ordinary-staff overview probes succeeded, while missing credentials
  and cross-role identity claims failed with the expected authorization class;
- every configured PTO profile had a valid active roster relationship;
- no orphan request/adjustment rows, malformed day counts, paid leave-year
  crossings, duplicate live floating holidays, duplicate adjustments, current
  negative balances, or overlapping live requests were found;
- all three PTO tables had RLS enabled, no browser policies/grants, service-role
  access only, no realtime publication, and the expected indexes, triggers, and
  decision RPC access;
- repeated overview reads completed within normal sub-second latency during the
  audit; and
- source routing remained staff-only, with no n8n, client-facing, Linear-mirror,
  `calendar-upsert`, or `sample-review-upsert` change.

D-36's same-role impersonation risk remains reproducible and intentionally
accepted for this launch. It is not described as closed by this audit.

## Defects found and disposition

| Priority | Finding | Disposition in this PR |
|---|---|---|
| P1 | Policy "today" used UTC and advanced date rules during the Guatemala evening. | One explicit `America/Guatemala` policy-date helper now owns overview, request, cancellation, and member-start validation; boundary tests cover both sides of local midnight. |
| P1 | Staff calendar absences exposed request/member IDs, leave type (including sick), and exact day count although the UI renders only a name and date range. | Non-admin/common absence projection is reduced to the rendered name and date range. Rich request rows remain admin-only. |
| P1 | Kasper could approve but could not see/cancel future approved leave or inspect completed decisions. | Kasper now includes upcoming approved leave, server-backed cancellation, and a recent decision/cancellation disclosure. |
| P1 | Cancellation reused `decided_by`/`decided_at`, erasing approval attribution. | Additive source-only SQL adds separate cancellation fields. The Edge Function writes them and fails closed for approved cancellation until those fields exist; it never erases the approval as a migration fallback. |
| P1 | An admin could replace a PTO start date after leave history existed, silently reinterpreting balances. | Transactional request/setup RPCs lock and recheck the active roster row, compare the profile state version, and reject deactivation, history, or concurrency conflicts, including first-time setup races. |
| P1 | README, feature, truth, system-map, migration, and rollback docs contradicted D-36 and the recorded launch. | Current-state docs are reconciled to the value-free execution evidence and keep individual sessions as post-launch hardening. |
| P2 | "Used" was a net value (`approved - adjustments`), making credits look like less leave was taken. | Staff and Kasper views separate approved leave from adjustments and explain the balance equation. |
| P2 | Browser-native dropdown, date, and spinner controls bypassed SyncView styling and accessibility behavior. | Staff and Kasper use shared branded controls with disabled options, full keyboard handling, server-date calendars, bounded/signed steppers, and focusable plain-English help. |
| P2 | PTO had source-regex and pure-policy tests but no browser interaction suite. | A fully mocked, synthetic Playwright lane covers staff and Kasper control/lifecycle interactions without live writes. |
| P2 | Decision notes were returned but invisible to staff. | Decision notes now appear with the staff member's request history. |

## Interaction and logic matrix

| Area | Evidence after this PR | Residual |
|---|---|---|
| Runtime gate and routes | Offline source gate plus existing live on/auth readback; direct off behavior remains fail-closed. | A post-merge on→off→on browser rehearsal is an owner operation, not performed here. |
| Staff identity/privacy | 401/403 and role separation live-read checks; private tables remain locked; calendar projection is minimized. | Shared role keys still do not bind a unique person; D-36 accepts this for launch. |
| Accrual/day policy | All original fixtures plus eligibility, caps, anniversaries, leap day, observed holidays, negative adjustments, and company-timezone boundaries. | The aggregate schema still cannot identify which endpoint is a half day. |
| Staff request UI | Custom type/date/day controls, disabled floating option, full/half-day bounds, visible validation/notice, decision notes, cancellation, loading/error paths. An authenticated read-only quote handles ranges outside the overview holiday projection; pending/failed/zero/oversized quotes cannot submit. | The v1 aggregate still cannot identify which endpoint is the half day. |
| Kasper | Role gate, pending decisions, separate accounting columns, setup/adjustment validation, upcoming cancellation, recent history. | There is no first-class undo/reversal workflow for an adjustment. |
| Cancellation audit | New columns and fail-closed Edge write preserve the original decision. | The additive migration must be manually applied; earlier historical cancellations are not automatically reconstructed. |
| Database | Live constraints/RLS/grants/triggers/RPCs passed; candidate SQL adds roster-row-serialized request/setup RPCs and hardens approval against inactive targets, all with service-role-only EXECUTE. | The new RPC concurrency contract is source-tested but not executed against a disposable PostgreSQL database in CI. |
| Delivery resilience | Errors remain visible and cache generations prevent stale overview repaint. | Request/adjustment idempotency keys, ambiguous-response retry protection, and an API timeout/recovery contract remain open hardening work. |
| Scale | Current live overview latency is healthy. | Overview still loads all historical PTO rows and recomputes all active profiles; archive/paging strategy should be added before material growth. |
| Calendar | Server-date today, observed holidays, ±3 complete months, weekend shading, custom navigation. | A fourth event is summarized as `+N more` without a disclosure, and partial-day placement is not representable. |

## Candidate verification

The final review tree passed the following non-mutating checks:

- all 112 repository unit suites via `npm test`;
- the PTO accrual/schema/Edge source lane, branded-control behavior lane, UI wiring lane, and Deno
  type-check;
- the synthetic PTO browser lane with 25 mocked PTO calls, covering staff and Admin actions,
  ordinary-staff role exclusion, empty/loading/error/retry states, submit → approve and future-leave
  cancellation, keyboard/focus behavior, reduced motion, light/dark themes, and no global overflow or
  serious/critical Axe findings at desktop, 768×900, 390×844, and 390×360;
- the independent staff-login browser lane; and
- every required fast Production component: boot budget, structure, read-only smoke, comment thread,
  write gateway, accessibility/focus, and desktop/compact/mobile layout.

The broader optional Production interaction inventory still reports that three guarded row pickers
do not open. A detached, untouched `origin/main` snapshot at `6f2e0d4` reproduced those same status,
due-date, and assignee assertions. This is therefore a pre-existing Production test/runtime issue,
not a PTO regression. It is recorded rather than repaired here because the Production/Linear-mirror
surface is explicitly frozen for this work.

The workflow files parse as YAML, the final diff has no whitespace errors, and the added content has
no email-like value or credential-shaped token. The only UUID-shaped additions are declared
synthetic browser fixtures. No disposable PostgreSQL execution was available, so the new RPC bodies
remain source-tested and require the migration-first apply/readback gate below.

## Visual alternatives

`docs/features/PTO_VISUAL_DIRECTIONS.html` is a non-operative, synthetic design
board with three staff and three Kasper directions:

1. balance ribbon / decision desk (recommended);
2. planner-first / roster workspace; and
3. leave-year story / operations board.

The shipped control polish is deliberately compatible with any of the three; a
larger layout choice can therefore be reviewed separately without reopening the
native-control defects.

## Owner release checks

1. **Before merge**, apply `migrations/2026-07-15-pto-cancellation-audit.sql`; read back both
   cancellation columns, all three hardened functions, service-role-only EXECUTE, RLS/table grants,
   and browser denials; append only the value-free evidence required by `EXECUTION_LOG.md`. Set and
   read back the value-free Actions variable `PTO_SCHEMA_CONTRACT=transactional-writes-v1`.
2. Merge only after that readback. The schema-bearing main push should report that automatic PTO
   deploy was held for migration-first ordering; manually dispatch it from `main` with migration readback
   confirmed and verify the deployed merge SHA.
3. Read back the policy date during the local evening and confirm it remains the
   company-local date.
4. Probe an ordinary staff overview and confirm calendar absence objects contain
   only the rendered name and date range.
5. Browser-check staff and Kasper in light/dark desktop and mobile states; cancel
   only a disposable synthetic request if an end-to-end write drill is desired.
6. Keep `pto_v1` on unless rollback is required; the one-step behavior kill
   remains `{"mode":"off"}`.

Until steps 1–4 are completed, the PR is a reviewed source fix rather than a
claim that the new cancellation audit and timezone behavior are live.
