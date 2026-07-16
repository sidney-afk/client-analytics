# PTO / Time Off Tracker

> **Current status (2026-07-15): LIVE and enabled.** The base migration and `pto` Edge Function were
> applied/deployed and verified, private setup completed, `pto_v1` was read back as `{"mode":"on"}`,
> and Admin/non-admin plus disposable TEST browser paths passed. Value-free receipts are in
> `EXECUTION_LOG.md`. Owner decision D-36 explicitly accepted launch under the current shared-role-
> key identity model. Individually revocable sessions remain post-launch hardening, not a launch
> prerequisite. The cancellation-attribution migration and the UI/contract refinements described as
> **candidate source** below are not live until separately merged, applied/deployed, and evidenced.

This is the living contract for SyncView's staff PTO and time-off feature. It replaces the historical
implementation brief as the source for placement, policy behavior, authorization, data boundaries,
rollback, and release checks. The repository is public: member hire dates, leave history, notes,
balances, staff keys, and other personal or HR data must never be committed here.

## What it is

The feature gives staff one protected place to:

- see their wellness and sick balances, floating-holiday status, current leave year, and next grant;
- request wellness, sick, floating-holiday, or unpaid time off;
- review or cancel their own eligible requests; and
- see approved team absences and observed paid holidays on a month calendar.

The Kasper **Time Off** subtab adds the admin queue, team balance view, member enable/start-date
controls, and adjustments. SyncView does not send PTO work through n8n. The browser calls only the
staff-authenticated `pto` Supabase Edge Function, and the server alone calculates balances and day
counts.

## Placement and gating

- **Staff surface:** top-level route `#time-off`, opened from **Time Off** in the consolidated
  top-right staff menu. There is intentionally no additional header-navigation button.
- **Admin surface:** Kasper subtab `#kasper/time-off`, with a pending-request badge. Balance data can
  be rendered for the protected admin view; decision, adjustment, and member-setup controls require
  a verified `admin` staff identity.
- **Client/public exclusion:** the menu and surfaces stay unavailable on client links, intake,
  onboarding, and SMM-only entry modes. PTO data is never part of a client-facing response.
- **Runtime gate:** `pto_v1` is a mode flag. `off` hides both entry points and makes a direct
  `navTo('time-off')` return home; `on` exposes them. Unknown, missing, malformed, or failed flag
  reads are treated as off.
- **Outer shell:** the existing app password remains a visibility gate only. Every PTO read and
  mutation independently requires a valid staff role key at the Edge Function, but that key proves
  only a role family, not a unique person; see the accepted launch risk below.

The top-right consolidation preserves the existing identity flow, theme and original-status-color
functions, local-storage keys, and the DOM IDs `themeToggle` and `statusPaletteToggle`. The menu
button owns accessible menu state and keeps the established outside-click, Escape, focus-return,
desktop-containment, and two-row mobile-header behavior.

### Accepted launch risk and post-launch identity hardening

The current `ROLE_KEY_ADMIN`, `ROLE_KEY_SMM`, and `ROLE_KEY_CREATIVE` secrets are shared role keys.
`key-verify` validates a caller-selected roster member only for role compatibility, and PTO receives
that same browser-selected member/name. This prevents role elevation but does **not** prevent one
holder of a shared SMM or creative key from claiming another same-role member. The existing path is
therefore adequate for role authorization and audit labels, but it cannot securely enforce "my"
HR history, requester ownership, or immutable decision attribution.

Owner decision D-36 (2026-07-15) explicitly accepts that same-role impersonation/visibility risk for
the PTO launch. That decision supersedes the prior requirement to keep `pto_v1` off until individual
sessions exist; it does not claim the risk is fixed and does not relax the private-data rules.

Individually revocable server-side staff sessions remain the recommended post-launch hardening: the
server should derive the member identity without trusting actor/member fields from the browser. A
secure enrollment must include trusted owner/admin approval; automatically signing the current
caller-selected identity would preserve the same flaw. This work may use a service-role-only session
table with hashed random device tokens and expiry/revocation, requires no personal data in this
public repository, and remains subject to same-role impersonation, revoked/expired-session,
inactive-member, and role/session mismatch tests.

## Policy contract

All policy math runs in the server-side pure function
`computePtoBalance(member, requests, adjustments, asOfDate)`. The frontend displays the returned
values; it must not independently accrue or authorize leave.

The **candidate source** defines the company policy day in the IANA zone `America/Guatemala` and
routes overview, request-date, cancellation, and member-start-date decisions through
`ptoPolicyToday()`. This prevents UTC midnight from advancing PTO rules during the Guatemala
evening. That timezone refinement is not a live-deployment claim until the updated function is
deployed and evidenced.

### Eligibility and leave years

- Tenure starts on the private `pto_start_date`; paid leave becomes eligible on
  `pto_start_date + 60 days`.
- Paid requests before eligibility are rejected. Unpaid requests remain available.
- Each person's leave year is anniversary-based: it begins on the most recent hire anniversary and
  ends the day before the next anniversary. Wellness and sick counters reset at that boundary.
- The date's bucket is `2-6mo` from day 60 until six calendar months and `6mo+` thereafter.

### Wellness accrual

- A member reaching eligibility while in the `2-6mo` bucket receives 2.0 days on that date.
- Grants on the first of each later calendar month are 0.5 days in `2-6mo` and 1.0 day in `6mo+`.
  Crossing six months carries the existing balance forward; the new rate starts with the next grant.
- Grants stop when total grants in the current leave year reach the bucket's grant-time cap: 6.0
  days for `2-6mo`, 12.0 days for `6mo+`.
- Wellness does not roll over across a hire anniversary. The next grant after a reset is the next
  calendar-month first.
- The policy baseline is 2026-02-06. Members already at least six months received 6.0 days that day;
  members already eligible but below six months received 2.0 days that day. Monthly grants start
  2026-03-01 for both baseline cases.
- Available wellness equals current-year grants minus approved current-year wellness days plus
  current-year adjustments. Normal requests cannot take it below zero. A migrated/admin adjustment
  may create a negative balance; the UI renders it as a valid red value and further wellness
  requests remain blocked until the balance is sufficient.
- A request uses either the recomputed full business-day count or that count minus 0.5 for one
  half-day endpoint. The aggregate v1 schema cannot safely locate multiple partial dates.

### Sick, holidays, and unpaid leave

- Sick leave is 3.0 days per anniversary leave year, available in full from eligibility, with no
  accrual or rollover. Sick requests may be same-day or past-dated.
- Fixed paid holidays are New Year's Day, Independence Day, Thanksgiving (fourth Thursday in
  November), December 24, and December 25. No request is needed.
- Weekend fixed holidays are observed on Friday for Saturday and Monday for Sunday. The observed
  date appears on the calendar and is excluded from request day counts.
- Each person has one approval-based floating holiday per calendar year. Calendar-year scope is the
  deliberate `FLOATING_HOLIDAY_ALLOWANCE = 1` v1 configuration default, not an anniversary-year
  rule. A floating request is attached to one business date and may be 0.5 or 1.0 day; pending
  reserves the allowance.
- Unpaid leave uses the same approval flow but does not change a balance.

### Requests and day counting

- Types are `wellness`, `sick`, `floating_holiday`, and `unpaid`.
- Status transitions are `pending` to `approved` or `denied`, plus `cancelled` by the requester while
  their own request is pending or by an Admin before the start date while status is pending/approved.
  Candidate source keeps cancellation actor/time separate so cancelling future approved leave does
  not erase the original approval decision.
- The form warns, but does not block, when a start date is fewer than 14 days away.
- Server day count includes weekdays in the inclusive range and excludes weekends plus observed
  fixed holidays. The submitted total must equal that count or be exactly 0.5 lower for one half-day
  endpoint. Paid ranges crossing a hire-anniversary boundary are rejected and must be split; unpaid
  ranges may span the boundary.
- Overview includes the holiday projection for the previous, current, and next calendar year. When
  a selected range falls outside that projection, the browser calls the authenticated read-only
  `quote` action instead of guessing. Quote and final request both run `countPtoDays`, enforce the
  same eligibility/leave-year rules, and reject a computed count above 999 business days so the
  value always fits `pto_requests.days numeric(4,1)`.
- Approval reads a transactionally locked per-member snapshot, evaluates the JavaScript policy,
  and finalizes only if the member's monotonic state version is unchanged. A stale snapshot reloads
  and recomputes up to two times before returning `409 decision_conflict`. This serializes distinct
  concurrent approvals without duplicating accrual math in SQL. The finalizer also locks and
  rechecks that the target remains active before approval; denial remains available for cleanup.
- Candidate request creation and member setup run through paired service-role-only RPCs. Both lock
  the stable roster row and compare `pto_members.state_version`, so a request/history insert cannot
  race a first-time or existing start-date change. Setup refuses to change a start date after request
  or adjustment history (`409 start_date_history_conflict`). A stale concurrent form returns 409 and
  asks the operator to refresh rather than silently reinterpreting history.

## Data model and security boundary

The applied additive base migration is `migrations/2026-07-15-pto-tracker.sql`. It creates:

| Table | Purpose | Browser access |
|---|---|---|
| `pto_members` | Private start date, explicit enablement, and balance-state version. | None. |
| `pto_requests` | Requested dates, type, server day count, status, and decision audit fields; the candidate delta adds separate cancellation audit fields. | None. |
| `pto_adjustments` | Dated wellness/sick migration entries and admin corrections. | None. |

All three tables have RLS enabled with no anon or authenticated policy, explicit revoked access for
`anon` and `authenticated`, and explicit service-role grants. They are not added to realtime. The
publicly readable `team_members` table is unchanged; private hire dates never become columns there.
All reads and writes go through the Edge Function's service-role client after staff-key authorization.

The base migration's schema, RLS, grants, browser-role denials, and initial off flag were read back
at go-live. The additive `migrations/2026-07-15-pto-cancellation-audit.sql` delta is **candidate
source only**: it adds `cancelled_by` and `cancelled_at`; installs `pto_create_request_v1` and
`pto_set_member_start_v1`; replaces `pto_finalize_decision_v1` with its active-target guard; grants
all three hardened functions only to service role; reasserts the locked
`pto_requests` boundary; contains no member/HR seed or flag write; and must not be described as
applied until a value-free receipt is appended to `EXECUTION_LOG.md`.

`pto_enabled` defaults to false. That is a data-safety gate, not an invitation to copy a roster into
the repository. The real roster, start dates, prior leave, and migration adjustments are owner-side
private inputs.

Request/adjustment/member-change triggers advance `pto_members.state_version`. Service-role-only
`pto_decision_snapshot_v1` and `pto_finalize_decision_v1` RPCs lock request then member rows in the
same order and compare that version. A partial unique index permits at most one pending or approved
floating-holiday request per member/calendar year. History reads use UUID keyset pagination rather
than a silent fixed row limit.

Candidate `pto_create_request_v1` and `pto_set_member_start_v1` take the stable `team_members` row
lock before the private profile lock and compare the expected state version. This also serializes
first-time setup, when no `pto_members` row exists yet. Approved cancellation fails closed with 503
if the dedicated cancellation columns are not ready; it never falls back to an update that would
erase the original approval actor or timestamp.

## Edge Function contract

Entry source: `supabase/functions/pto/index.ts`; the Deno-checked pure policy engine lives beside it
in `supabase/functions/pto/policy.js`. Browser requests include `X-Syncview-Key` and attribution
headers through the shared SyncView Edge-Function header helper. Authorization uses the matched
server secret through `authorizeStaffKey`; caller-supplied actor or role text never elevates access.
Unknown keys return 401, known but insufficient roles return 403, responses are `no-store`, and CORS
allows the required staff headers. `OPTIONS` returns 204.

Those actor/member fields remain caller claims under the current shared-key verifier; they are not
an immutable human principal. D-36 accepts that residual risk for the live PTO launch, while
individual server-derived sessions remain post-launch hardening.

| Action | Method | Authorized roles | Contract |
|---|---|---|---|
| `overview` | GET | Any staff role | Caller balances and request history, minimal all-member balance/today summary, approved calendar absences for ±3 months, fixed holidays, and next grant. Candidate source minimizes each team-calendar absence to rendered member name + date range; Admin additionally receives pending requests, future approved requests, recent terminal history, and granted/approved/adjustment balance components. |
| `quote` | POST | Any staff role | Read-only, identity-bound server count for ranges outside the overview holiday projection; applies type/date/eligibility/leave-year/range limits and returns full plus one-half-day counts. |
| `request` | POST | Any staff role | Validates active/enabled membership, eligibility, type/range/day count, balance, and floating-holiday availability; inserts pending through the versioned transactional RPC, which rechecks the active roster row under lock. |
| `decide` | POST | Admin | Approves or denies a pending request, rechecking wellness and recording the verified actor. |
| `cancel` | POST | Requester for own pending; Admin before start date for pending/approved | Applies only the lifecycle-bounded cancellation transition. Candidate source writes cancellation attribution separately and preserves an earlier approval decision. |
| `adjust` | POST | Admin | Inserts a dated wellness or sick adjustment. |
| `set_start_date` | POST | Admin | Transactionally upserts private start date and enabled state for one active roster member; rejects deactivation, history, and concurrent-state conflicts under lock. |

The browser URL contract is the project Edge base plus `functions/v1/pto`. The dedicated workflow
`.github/workflows/deploy-pto-edge-functions.yml` deploys only `pto` with JWT verification disabled
because the function enforces the repository's staff-role-key contract itself. Function-only main
pushes still auto-deploy. A push that also changes PTO SQL is deliberately held: apply and read back
the migration first, set and read back the Actions repository variable
`PTO_SCHEMA_CONTRACT=transactional-writes-v1`, then manually dispatch from `main` with
`migration_readback_confirmed=true`. Every deploy also requires that exact contract latch, preventing
this Edge version from preceding its database contract. A later schema-dependent Edge revision must
bump `REQUIRED_SCHEMA_CONTRACT` and the operator-read-back variable together; reusing the old value
would not prove a newer contract.

The function also reads `pto_v1` server-side. The evidenced live state is on. Off, missing,
malformed, or unreadable state returns
`503 feature_disabled` before PTO/HR tables are loaded for `overview`, `quote`, `request`, `decide`, and
`cancel`. Only the already-admin-only `set_start_date` and `adjust` setup actions remain callable
while off, allowing private maintenance without exposing either UI entry point.

## Frontend behavior and failures

- The balance card emphasizes available wellness while retaining granted, used, sick, floating-
  holiday, next-grant, and leave-year detail.
- The request form previews the inclusive weekday-minus-holiday count and permits one half-day
  endpoint. Floating holidays stay on one business date. Out-of-window ranges show a pending state
  while the server quote runs; pending, failed, zero-day, and oversized quotes cannot be submitted.
  The final request recomputes everything server-side.
- Candidate source replaces browser-native selects, date inputs, and number spinners on both staff
  and Kasper PTO surfaces with branded controls. The select supports arrow/Home/End/Enter and
  typeahead use; the in-app calendar enforces bounds and keyboard date movement; the half-day
  stepper keeps an underlying numeric input; plain-English help appears on hover and keyboard focus.
- Request history shows statuses and offers cancellation only when the server contract permits it.
- The team month grid shades weekends and renders only approved absences plus observed fixed
  holidays. Candidate source limits absence projection to the name and date range the grid renders.
  It refetches on mount and after actions; there is no polling or PTO data-table realtime
  channel. A separate `pto_v1` flag-only subscription propagates the behavior kill to open tabs;
  focus/visibility and route entry re-read the flag with a bounded timeout, and stale responses
  cannot overwrite newer flag/cache generations.
- A 401 clears the cached staff identity, prompts sign-in, and retries once. A 403 keeps the valid
  identity and explains the role boundary. Other errors stay visible with a retry path; they never
  fall back to public REST or n8n.
- Negative migrated wellness remains renderable and conspicuous rather than being coerced to zero.
- Candidate Kasper UI separates granted days, approved usage, adjustments, and availability; adds a
  future-approved-leave cancellation list; and keeps recent decisions/cancellations in a collapsed
  history section so the normal approval queue stays concise.

## Runtime flag and rollback

The base migration seeded `syncview_runtime_flags.pto_v1` as `{"mode":"off"}`. After private setup
and verification, the owner-authorized D-36 launch changed and read it back as `{"mode":"on"}`; the
value-free flag receipt is in `EXECUTION_LOG.md`. Missing or unreadable flag state still fails closed
in both the browser and normal server actions. Individual identity binding remains post-launch
hardening rather than a prerequisite for retaining on mode under D-36.

**One-step behavior kill:** set `pto_v1` back to `{"mode":"off"}` and read it back. This hides the
menu entry and Kasper subtab, bounces direct staff navigation home, and makes the Edge Function
reject normal read/request/approval/cancel actions with `503 feature_disabled`, including from a
stale tab. The two direct admin setup actions remain available by design; off does not delete
requests or adjustments. Disabling the deploy workflow prevents future automatic deploys but is not
the runtime kill. Keep the server authorization boundary and locked tables intact.

## Release and compliance checklist

Live launch baseline (completed; evidence is value-free):

- [x] The additive base migration was applied; its three-table schema, decision RPCs, RLS, service-
  role grants, browser-role denials, and initial `pto_v1={"mode":"off"}` were read back.
- [x] The scoped workflow deployed `pto` with the intended JWT setting and public-safe fingerprint;
  missing/wrong credentials returned 401, insufficient role returned 403, and a valid dark-state
  request returned `503 feature_disabled`.
- [x] The private roster was checked and configured outside the repository; aggregate completion and
  all target checks were recorded without identities, dates, notes, balances, or keys.
- [x] D-36 recorded the owner's explicit acceptance of the shared-role-key risk for launch.
- [x] `pto_v1` changed from off to on after private verification, and database readback plus the
  `flag_flips` receipt were confirmed.
- [x] Browser verification covered the menu, Admin and one non-admin overview, and an exact-cleanup
  disposable TEST submit → approve path with zero residual TEST rows.
- [x] No Production/Linear-mirror route, authority, flag, client surface, or n8n path changed.

Current UI/hardening PR (candidate source; not a live-action claim):

- [x] The hardening migration is additive, value-free, leaves `pto_v1` untouched, adds separate
  cancellation attribution, installs the request/setup RPCs plus the active-roster approval
  finalizer, and reasserts the locked `pto_requests` table boundary.
- [x] Candidate policy/API tests cover the Guatemala policy day, minimized absence projection,
  balance breakdown, lifecycle-bounded admin cancellation, preserved decision attribution, and
  transactional request/setup conflicts plus server quotes.
- [x] Candidate UI wiring covers branded select/calendar/stepper controls, keyboard operation,
  hover/focus help, Admin future-leave cancellation, and recent terminal history.
- [x] `npm test`, the PTO browser/type/source lanes, staff-login browser lane, and every required fast
  Production-polish component are green; the frozen Production/Linear/client paths have no diff.
  The optional interaction-inventory residual documented in the release audit reproduces unchanged
  on `origin/main`.
- [ ] Before merge, apply `2026-07-15-pto-cancellation-audit.sql`; read back its two columns, three
  hardened functions, service-role-only EXECUTE grants, RLS/table grants, and browser denials; append only a
  value-free receipt to `EXECUTION_LOG.md`. Then set and read back the value-free Actions variable
  `PTO_SCHEMA_CONTRACT=transactional-writes-v1`.
- [ ] Merge only after that readback. The schema-bearing push will hold its automatic deploy; then
  manually dispatch `Deploy PTO edge function` from `main` with migration readback confirmed, verify its source
  fingerprint and safe auth/API probes, and
  browser-check the branded controls, Admin cancellation/history, and zero-residue TEST lifecycle.

Post-launch follow-up:

- [ ] Replace caller-selected shared-role identity with individually revocable server sessions and
  pass same-role impersonation, revoked/expired-session, inactive-member, and role/session mismatch
  tests. Under D-36 this remains hardening, not a retroactive launch prerequisite.
- [ ] Rehearse the live `on → off → on` behavior kill in an approved window and retain only
  value-free flag/readback evidence.
- [ ] After two clean weeks, cancel Hrvey and delete the interim PTO tracking sheet.

## Out of scope for v1

- Slack or email notifications.
- n8n workflows of any kind.
- Realtime PTO data updates or background polling (the runtime-flag kill subscription is retained).
- Client-visible PTO data or controls.
- Editing accrual constants or policy rulings in the UI.
- Storing the private contractor roster, hire dates, request notes, balances, or migration history in
  this public repository.
