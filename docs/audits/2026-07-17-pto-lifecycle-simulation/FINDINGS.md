# PTO lifecycle simulation — findings

This review used synthetic TEST personas and synthetic policy values only. No
live staff identity, date, balance, note, key, response body, or HR record is
included in this public packet.

## Clear issues found and fixed

- **An interrupted write could invite an unsafe retry.** PTO mutations now use
  a bounded network deadline. If SyncView cannot confirm whether a write was
  saved, every PTO write on that surface stays locked until a successful
  Refresh reconciles the latest overview. A committed request whose response
  is lost is then shown exactly once instead of being resubmitted.
- **Network failures used browser jargon.** Connection failures and timeouts
  now use plain-English copy that explains whether retrying is safe or a
  Refresh is required.
- **An inactive-profile approval re-enabled an impossible action.** Approve now
  stays disabled after the server rejects it, an inline explanation appears,
  and the decision note plus Deny path remain usable for cleanup.
- **Mobile request history hid important lifecycle controls.** At phone width,
  each request is now a complete card with type, dates, days, status, decision
  note, and pending cancellation.
- **Kasper history omitted decision notes.** Recent Decisions now retains and
  displays the note that accompanied an approval or denial.
- **The mobile balance table gave no scrolling cue.** Kasper now sees a visible
  swipe instruction and the horizontal scroller is keyboard focusable and
  labelled.
- **Early test assertions could pass on the wrong row or a partial number.**
  Lifecycle assertions now identify the exact synthetic request and compare
  exact cells, notes, member/type/date/status attribution, decision and
  cancellation actors/timestamps, state fingerprints, ordering, and row
  counts.
- **Fast automation left stale toasts in later evidence frames.** The human
  journey harness now dismisses the prior action's toast before starting the
  next action and verifies that its synthetic-data banner covers no control or
  toast.
- **A hidden desktop table could be used as a mobile screenshot target.** Every
  evidence target must now exist and be visible; mobile Pending and Approved
  frames target the exact touch card the person sees.
- **The staff menu could open outside the visible phone viewport.** The mobile
  popover now anchors to its staff-menu trigger, and the lifecycle captures
  the open menu before selecting Time Off and verifies its visible bounds.
- **Calendar focus could leave date controls outside the phone viewport.** The
  shared branded calendar now positions and repositions against the real
  visual viewport during focus, scroll, and month navigation; the lifecycle
  verifies a real touch selection after those transitions.
- **A custom option could leave the browser's cyan tap highlight behind.**
  Branded PTO dropdown, date, and stepper controls now suppress that native
  touch artifact while preserving their intentional selected and focus states.
- **The primary PTO submit action had no visible keyboard focus ring.** It now
  uses the same clear focus treatment as the branded fields around it.
- **PTO confirmation toasts could be centered in the expanded layout viewport
  instead of the visible phone viewport.** PTO toasts now follow the visible
  viewport through resize and scroll, so the complete confirmation remains on
  screen.
- **Evidence labels could hide the very result they were meant to qualify.**
  The synthetic-data banner now avoids visible PTO text, controls, toasts, and
  the app header before any screenshot is accepted.
- **Two different policy dates could look identical when the balance did not
  change.** Every time-travel frame now carries a distinct synthetic Guatemala
  clock and policy date, making month, anniversary, and evening-boundary
  checkpoints visually auditable.
- **Publishing launched a second browser render after visual approval.** Tiny
  platform text-antialiasing differences changed exact image hashes even when
  the screen looked identical. The publisher now verifies and promotes the
  exact private candidate that was reviewed; it never substitutes a fresh
  render behind an existing approval.
- **Mock setup bypassed real entry paths.** The lifecycle now consumes the
  normal read-only `pto_v1` response, opens staff Time Off through the real
  menu, enters Kasper through its real navigation control, and uses natural
  Tab/Enter entry for the keyboard lane.
- **Transient controls were underrepresented in the first screenshot packet.**
  Branded dropdown, calendar, day arrows, note fields, both confirmation
  dialogs, touch states, and keyboard focus states now each receive their own
  action/result assertion and screenshot.

## Behavior verified as coherent

- Wellness, backdated sick, floating-holiday, and unpaid request paths.
- Near/local and far/authenticated day-count quotes without a PTO write.
- Pending cancellation, approval, denial, and admin cancellation of future
  approved leave.
- Balance, team snapshot, calendar, and history changes across the decision
  lifecycle.
- Floating-holiday reservation, second-request rejection, insufficient
  balance, and inactive-profile approval rejection.
- Server error recovery, connection loss, a slow in-flight request, a true
  client timeout, a committed response loss, and same-page double-click
  protection.
- Two-tab stale-state behavior and convergence after explicit Refresh.
- Sign-out privacy, same-role sign-in, desktop, phone, and keyboard-only use.
- Month accrual, tenure-rate transition, anniversary reset, and exact
  Guatemala-local policy-date boundaries.

## Residual risks and explicit limits

- Ordinary PTO requests do not yet carry a durable server idempotency token.
  The new client reconciliation lock prevents the observed lost-response
  duplicate path, while database-backed idempotency remains a separate future
  schema/API improvement.
- An inactive request can use a generic member label because the live overview
  intentionally excludes inactive roster identities. The new inline state
  explanation makes the decision safe; restoring a historical label would
  require a reviewed data-contract change.
- Separate browser tabs are snapshot-based rather than realtime. The server
  protects state transitions, and the other tab converges when the user
  selects Refresh.
- The synthetic backend imports the production policy engine, but it still
  models the HTTP/authentication and transaction layer. Existing Edge Function
  contract tests cover that source; the disposable production lane is the
  final integration check.
- The production disposable lane remains fail-closed until dedicated TEST
  staff/admin identities and their private role credentials are provided. It
  will not substitute a real staff member.

## Scope confirmation

No Edge Function, migration, runtime flag, deployment, frozen writer, n8n
workflow, Linear project, seed record, or client-facing Production surface was
changed by this work.
