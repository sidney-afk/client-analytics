# PTO / Time Off Tracker

> **Current status (2026-07-15): implemented in source, dark by default, and not yet a live-deployment claim.**
> The migration is manual, the Edge Function must be deployed and verified separately, real member
> setup stays in the owner's private system, and the feature must remain hidden until the
> individually bound staff-session blocker below is implemented and every owner gate passes.
> Record each live migration, deploy, seed, and flag action in `EXECUTION_LOG.md` when it actually
> happens.

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
  only a role family, not a unique person; see the go-live blocker below.

The top-right consolidation preserves the existing identity flow, theme and original-status-color
functions, local-storage keys, and the DOM IDs `themeToggle` and `statusPaletteToggle`. The menu
button owns accessible menu state and keeps the established outside-click, Escape, focus-return,
desktop-containment, and two-row mobile-header behavior.

### Go-live blocker: individual identity binding

The current `ROLE_KEY_ADMIN`, `ROLE_KEY_SMM`, and `ROLE_KEY_CREATIVE` secrets are shared role keys.
`key-verify` validates a caller-selected roster member only for role compatibility, and PTO receives
that same browser-selected member/name. This prevents role elevation but does **not** prevent one
holder of a shared SMM or creative key from claiming another same-role member. The existing path is
therefore adequate for role authorization and audit labels, but it cannot securely enforce "my"
HR history, requester ownership, or immutable decision attribution.

`pto_v1` must stay `off` until an individually revocable server-side staff session derives the
member identity without trusting actor/member fields from the browser. A secure enrollment must
include trusted owner/admin approval; automatically signing the current caller-selected identity
would preserve the same impersonation flaw. This prerequisite may use a service-role-only session
table with hashed random device tokens and expiry/revocation; it requires no personal data in this
public repository and no new fixed Edge secret. Do not seed real HR rows or cancel Hrvey before the
negative same-role impersonation test passes.

## Policy contract

All policy math runs in the server-side pure function
`computePtoBalance(member, requests, adjustments, asOfDate)`. The frontend displays the returned
values; it must not independently accrue or authorize leave.

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
  pending or by an admin before the start date.
- The form warns, but does not block, when a start date is fewer than 14 days away.
- Server day count includes weekdays in the inclusive range and excludes weekends plus observed
  fixed holidays. The submitted total must equal that count or be exactly 0.5 lower for one half-day
  endpoint. Paid ranges crossing a hire-anniversary boundary are rejected and must be split; unpaid
  ranges may span the boundary.
- Approval reads a transactionally locked per-member snapshot, evaluates the JavaScript policy,
  and finalizes only if the member's monotonic state version is unchanged. A stale snapshot reloads
  and recomputes up to two times before returning `409 decision_conflict`. This serializes distinct
  concurrent approvals without duplicating accrual math in SQL.

## Data model and security boundary

The additive manual migration is `migrations/2026-07-15-pto-tracker.sql`. It creates:

| Table | Purpose | Browser access |
|---|---|---|
| `pto_members` | Private start date, explicit enablement, and balance-state version. | None. |
| `pto_requests` | Requested dates, type, server day count, status, and decision audit fields. | None. |
| `pto_adjustments` | Dated wellness/sick migration entries and admin corrections. | None. |

All three tables have RLS enabled with no anon or authenticated policy, explicit revoked access for
`anon` and `authenticated`, and explicit service-role grants. They are not added to realtime. The
publicly readable `team_members` table is unchanged; private hire dates never become columns there.
All reads and writes go through the Edge Function's service-role client after staff-key authorization.

`pto_enabled` defaults to false. That is a data-safety gate, not an invitation to copy a roster into
the repository. The real roster, start dates, prior leave, and migration adjustments are owner-side
private inputs.

Request/adjustment/member-change triggers advance `pto_members.state_version`. Service-role-only
`pto_decision_snapshot_v1` and `pto_finalize_decision_v1` RPCs lock request then member rows in the
same order and compare that version. A partial unique index permits at most one pending or approved
floating-holiday request per member/calendar year. History reads use UUID keyset pagination rather
than a silent fixed row limit.

## Edge Function contract

Entry source: `supabase/functions/pto/index.ts`; the Deno-checked pure policy engine lives beside it
in `supabase/functions/pto/policy.js`. Browser requests include `X-Syncview-Key` and attribution
headers through the shared SyncView Edge-Function header helper. Authorization uses the matched
server secret through `authorizeStaffKey`; caller-supplied actor or role text never elevates access.
Unknown keys return 401, known but insufficient roles return 403, responses are `no-store`, and CORS
allows the required staff headers. `OPTIONS` returns 204.

Those actor/member fields remain caller claims under the current shared-key verifier; they are not
an immutable human principal. The API below is the implemented contract but must remain dark until
the individual-session prerequisite derives the member server-side.

| Action | Method | Authorized roles | Contract |
|---|---|---|---|
| `overview` | GET | Any staff role | Caller balances and request history, minimal all-member balance/today summary, approved calendar absences for ±3 months, fixed holidays, and next grant. |
| `request` | POST | Any staff role | Validates enabled membership, eligibility, type/range/day count, balance, and floating-holiday availability; inserts pending. |
| `decide` | POST | Admin | Approves or denies a pending request, rechecking wellness and recording the verified actor. |
| `cancel` | POST | Requester for pending; admin for a future request | Applies only the allowed cancellation transition. |
| `adjust` | POST | Admin | Inserts a dated wellness or sick adjustment. |
| `set_start_date` | POST | Admin | Upserts private start date and enabled state for one roster member. |

The browser URL contract is the project Edge base plus `functions/v1/pto`. The dedicated
workflow `.github/workflows/deploy-pto-edge-functions.yml` deploys only `pto` with JWT verification
disabled because the function enforces the repository's staff-role-key contract itself.

The function also reads `pto_v1` server-side. Off, missing, malformed, or unreadable state returns
`503 feature_disabled` before PTO/HR tables are loaded for `overview`, `request`, `decide`, and
`cancel`. Only the already-admin-only `set_start_date` and `adjust` setup actions remain callable
while dark, allowing private prelaunch setup without exposing either UI entry point.

## Frontend behavior and failures

- The balance card emphasizes available wellness while retaining granted, used, sick, floating-
  holiday, next-grant, and leave-year detail.
- The request form previews the inclusive weekday-minus-holiday count and permits one half-day
  endpoint. Floating holidays stay on one business date. The server remains authoritative.
- Request history shows statuses and offers cancellation only when the server contract permits it.
- The team month grid shades weekends and renders only approved absences plus observed fixed
  holidays. It refetches on mount and after actions; there is no polling or PTO data-table realtime
  channel. A separate `pto_v1` flag-only subscription propagates the behavior kill to open tabs;
  focus/visibility and route entry re-read the flag with a bounded timeout, and stale responses
  cannot overwrite newer flag/cache generations.
- A 401 clears the cached staff identity, prompts sign-in, and retries once. A 403 keeps the valid
  identity and explains the role boundary. Other errors stay visible with a retry path; they never
  fall back to public REST or n8n.
- Negative migrated wellness remains renderable and conspicuous rather than being coerced to zero.

## Runtime flag and rollback

The migration seeds `syncview_runtime_flags.pto_v1` as `{"mode":"off"}`. Source ships dark and
must fail closed for a missing or unreadable flag in both the browser and normal server actions.
Do not turn it on while individual identity binding remains open.

**One-step behavior kill:** set `pto_v1` back to `{"mode":"off"}` and read it back. This hides the
menu entry and Kasper subtab, bounces direct staff navigation home, and makes the Edge Function
reject normal read/request/approval/cancel actions with `503 feature_disabled`, including from a
stale tab. The two direct admin setup actions remain available by design; off does not delete
requests or adjustments. Disabling the deploy workflow prevents future automatic deploys but is not
the runtime kill. Keep the server authorization boundary and locked tables intact.

## Release and compliance checklist

Code review and CI:

- [x] The migration is additive, defaults `pto_enabled=false`, seeds `pto_v1` off, and gives no
  anon/authenticated table access or realtime publication.
- [x] `pto` uses only the shared role-key authorization path, no caller-selected role elevation, no
  n8n route, and no secret or personal data in source.
- [x] Offline tests cover 60-day eligibility, initial grant, both monthly rates, bucket carry-over,
  6/12 caps, anniversary reset, both 2026-02-06 baselines, negative adjustments, weekend/observed-
  holiday counting, and all five synthetic worked examples.
- [x] `docs/truth/ENDPOINTS.md`, `docs/independence/SYSTEM_MAP.md`, `README.md`, `REPO_MAP.md`,
  `ROLLBACK.md`, and `EXECUTION_LOG.md` describe the source state without claiming a live action.
- [x] `npm test` is green, including truth/repo-map checks.
- [x] `npm run test:prod-polish -- --lane=fast` is green for the `index.html` change.
- [x] `index.html` retains LF line endings for the string-extracting suites.
- [x] No Production/Linear-mirror route, authority, flag, or behavior changed.
- [ ] Replace caller-selected shared-role identity with an individually revocable server session;
  prove same-role impersonation, revoked/expired session, inactive-member, and role/session mismatch
  all fail before any real HR seed or `pto_v1` enablement.

Owner-run release (not completed merely by merging source):

- [ ] Confirm the individual-session prerequisite above is deployed and its negative tests pass.
- [ ] Confirm the contractor roster privately and ensure every intended person already has an active
  `team_members` row; never copy the roster or dates into this repository.
- [ ] Apply the migration manually; capture a public-safe schema/RLS/flag-off readback in
  `EXECUTION_LOG.md` without member rows or HR values.
- [ ] Verify the main-triggered PTO deploy workflow (or a later manual redeploy) at the release SHA;
  record the deployed function version, JWT setting, and no-secret fingerprint/evidence.
- [ ] Provision Kasper's admin role key outside the repository.
- [ ] Prove missing/wrong-key 401, insufficient-role 403, off-mode normal-action denial, the two
  admin-only setup actions, same-role impersonation denial, and locked direct-table access on
  non-personal TEST data.
- [ ] Rehearse `on -> off` using only the designated non-personal TEST member, prove both entry-point
  retirement and server-side `feature_disabled`, then return to off. Remove only the exact
  correlation-tagged TEST PTO rows, disable that TEST membership, and privately prove zero residue
  before any real seed is loaded.
- [ ] While `pto_v1` remains off, seed real membership and historical adjustments from the owner's
  private source through authenticated direct admin `set_start_date` / `adjust` calls; log aggregate
  completion, never identities, dates, notes, balances, or keys. The hidden Kasper UI is not the
  prelaunch seed path.
- [ ] Flip `pto_v1` to `{"mode":"on"}` only after owner approval and record the exact timestamp,
  readback, actor label, and rollback proof; then announce Time Off to the team.
- [ ] After two clean weeks, cancel Hrvey and delete the interim "PTO Accrual Tracker (Synchro
  Social)" Google Sheet.

## Out of scope for v1

- Slack or email notifications.
- n8n workflows of any kind.
- Realtime PTO data updates or background polling (the runtime-flag kill subscription is retained).
- Client-visible PTO data or controls.
- Editing accrual constants or policy rulings in the UI.
- Storing the private contractor roster, hire dates, request notes, balances, or migration history in
  this public repository.
