# PTO / Time Off Tracker — implementation handoff

**Status: DESIGN / HANDOFF — not yet implemented.** This is the complete
implementation spec for an external coding agent. Nothing described here is
deployed. When implementation lands, the implementer must write the living
feature contract `docs/features/PTO_TRACKER.md` (per house convention) and this
handoff becomes historical.

**Repo line numbers below are pinned to commit `a1e26224d57643b170db6b42b74f98dd68104727`**
(2026-07-14). If the tree has moved, re-locate by the quoted symbol names, not
the line numbers.

---

## 1. Why this exists

Synchro Social tracks contractor time off in Hrvey (hrvey.com). Hrvey has no
API, no webhooks, no Zapier — and accrual balances ("Allowance Reports") are
paywalled on a plan we don't have, so contractors cannot see how many wellness
days they have left (the #1 team complaint). We are replacing Hrvey entirely
with a native SyncView feature and cancelling it.

Three deliverables, in one PR (or stacked PRs in this order):

1. **Header consolidation** — collapse the three top-right header buttons into
   one popover menu, and add a "Time Off" entry to it.
2. **Time Off surface** — a new top-level tab (`#time-off`) where staff see
   their balance, request leave, and view the team absence calendar; plus a
   Kasper subtab where requests are approved.
3. **Backend** — one new Supabase Edge Function (`pto`) + three additive
   migrations' worth of schema. **Explicitly NO n8n anywhere in this feature.**

---

## 2. Policy engine (the heart of the feature)

Source: the company "Paid Leave Policy" doc + owner (Kasper) rulings given
2026-07-14. The engine lives **server-side only** in the edge function; the
front end never computes balances, it displays what `?action=overview` returns.
This guarantees one source of truth.

### 2.1 Definitions

- **Tenure** = days since `pto_start_date` (hire date).
- **Eligibility date** = hire date + 60 days. Before it: no requests of any
  paid type (unpaid requests allowed).
- **Leave year** = personal, anniversary-based **(Kasper ruling: caps reset on
  each person's hire anniversary, NOT Jan 1)**. The current leave year runs
  from the most recent hire anniversary (or hire date if tenure < 1 year) to
  the day before the next one.
- **Bucket** at any date D: `2-6mo` if tenure at D is 60 days–6 months;
  `6mo+` if ≥ 6 months.

### 2.2 Wellness (PTO) accrual

- On the eligibility date, if in the `2-6mo` bucket: **+2.0 days immediately**.
- **Monthly grant on the 1st of each calendar month** after eligibility:
  **+0.5** while in `2-6mo`, **+1.0** in `6mo+` (bucket evaluated at the grant
  date). Crossing 6 months mid-year: balance carries over, rate simply becomes
  1.0 from the next monthly grant **(Kasper ruling #1: yes, carry over)**.
- **Cap**: grants stop when total granted within the current leave year reaches
  the bucket's annual max — 6.0 (`2-6mo`) / 12.0 (`6mo+`, evaluated at grant
  time).
- **Anniversary reset**: at each hire anniversary the wellness balance resets
  to 0 (policy: "does not roll over"), the granted/used counters reset, and
  monthly grants resume on the following 1st.
- **Company baseline (from the policy doc)**: members with 6+ months tenure on
  **2026-02-06** were granted **6.0 days on 2026-02-06**, with monthly grants
  from 2026-03-01. Implement this as a hardcoded baseline grant in the engine
  (it predates this system; several seeds depend on it).
- Half-day requests (0.5 increments) are allowed.
- **Balance = grants in current leave year − approved wellness days in current
  leave year + adjustments.** Requests that would push the balance below 0 are
  rejected server-side (409). Negative balances can exist only via seeded
  adjustments (Hrvey history) — render them in red, don't crash.

### 2.3 Sick leave

3.0 days per leave year (anniversary reset — **Kasper ruling #3**), available
in full from the eligibility date, no accrual, no rollover.

### 2.4 Holidays

Five fixed paid US holidays (Jan 1, Jul 4, Thanksgiving = 4th Thu of Nov,
Dec 24, Dec 25) — rendered on the team calendar, no request needed. Plus **1
floating holiday per calendar year** (calendar year is a default, not a Kasper
ruling — one-line config constant, flag in the feature doc), which is a
request type requiring approval.

### 2.5 Unpaid leave

A request type with approval flow but zero balance math.

### 2.6 Request rules

- Types: `wellness`, `sick`, `floating_holiday`, `unpaid`.
- Statuses: `pending → approved | denied`, and `cancelled` (by requester while
  pending, or by admin any time before the start date).
- The UI shows a non-blocking warning when start date < 14 days out (policy
  asks 2 weeks notice; Kasper can still approve).
- Weekends: day counts exclude Sat/Sun (Hrvey behaved this way — e.g. a
  Wed Jul 22 – Wed Jul 29 2026 range = 6.0 days).
- Sick requests may be same-day/past-dated (illness is retroactive by nature).

### 2.7 Worked examples (use these as unit-test fixtures)

Synthetic fixtures, evaluated at 2026-07-15 (the real member data lives in a
private Drive doc, NOT in this public repo — see §6):

- **Fixture A** (hired 2024-07-14): 6mo+ bucket. Leave year reset
  **2026-07-14** — 4.0 wellness + 1 sick used earlier in 2026 belong to the
  closed year. Current year: 0 granted so far (next grant Aug 1), wellness
  balance 0.0, sick 3.0. This looks brutal but is the direct consequence of
  Kasper ruling #2; the engine must implement it as specified. (Note: Hrvey
  itself was configured with leave year = Jan 01 — Kasper's ruling overrides
  Hrvey's config.)
- **Fixture B** (hired 2025-05-19): 6mo+ on the Feb 6 baseline → +6.0 on
  Feb 6, +1.0 Mar/Apr/May 1. **Anniversary reset 2026-05-19** → balance 0,
  then +1.0 Jun 1, +1.0 Jul 1 = 2.0 granted. Used since reset: 1.0 (Jul 9) →
  balance 1.0.
- **Fixture C** (hired 2026-01-30): eligible 2026-03-31, `2-6mo` bucket →
  +2.0 on Mar 31, +0.5 on Apr/May/Jun/Jul 1 = 4.0 granted. Crosses 6mo
  2026-07-30. Seeded with 6.0 used → **balance −2.0**: the engine must
  represent negative seeded balances without crashing and block further
  wellness requests until positive.
- **Fixture D** (hired 2026-04-01): eligible 2026-05-31 → +2.0 May 31,
  +0.5 Jun/Jul 1 = 3.0 granted, 0 used → wellness 3.0; 1 sick used → sick 2.0.

---

## 3. Data model (migration: `migrations/2026-07-XX-pto-tracker.sql`)

Follow the house idiom from `migrations/2026-07-10-smm-weekly-reports.sql`
(create-if-not-exists, indexes, RLS) and the rules in `migrations/README.md`
(additive-only; applied MANUALLY in the Supabase SQL editor — no auto-runner;
log the apply in `EXECUTION_LOG.md`).

```sql
-- 1) Hire date on the existing roster (additive)
alter table public.team_members add column if not exists pto_start_date date;
alter table public.team_members add column if not exists pto_enabled boolean not null default false;

-- 2) Requests
create table if not exists public.pto_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.team_members(id),
  type text not null check (type in ('wellness','sick','floating_holiday','unpaid')),
  start_date date not null,
  end_date date not null,
  days numeric(4,1) not null check (days > 0),
  note text not null default '',
  status text not null default 'pending'
    check (status in ('pending','approved','denied','cancelled')),
  decided_by text,
  decision_note text not null default '',
  source text not null default 'syncview' check (source in ('syncview','hrvey_migration')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists pto_requests_member_idx on public.pto_requests (member_id, status);
create index if not exists pto_requests_dates_idx on public.pto_requests (start_date, end_date);

-- 3) Adjustments (migration seeds + admin corrections)
create table if not exists public.pto_adjustments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.team_members(id),
  kind text not null check (kind in ('wellness','sick')),
  delta numeric(4,1) not null,          -- negative = days consumed
  effective_date date not null,          -- decides which leave year it lands in
  reason text not null,
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists pto_adjustments_member_idx on public.pto_adjustments (member_id);
```

**Security posture — LOCKED, not the default anon-read posture.** This is HR
data and the repo is public with a committed anon key; do NOT repeat the F76
incident (SMM routes shipped with anonymous access). Copy the
`sales-intake-migration.sql` posture for both new tables:

```sql
alter table public.pto_requests enable row level security;   -- no policies at all
alter table public.pto_adjustments enable row level security;
revoke all on table public.pto_requests from anon, authenticated;
revoke all on table public.pto_adjustments from anon, authenticated;
grant select, insert, update, delete on table public.pto_requests to service_role;
grant select, insert, update, delete on table public.pto_adjustments to service_role;
-- NO realtime publication. The tab refetches on mount/actions; polling is unnecessary.
```

All reads and writes flow through the edge function. `team_members` keeps its
existing anon-SELECT policy (it already exposes name/role; `pto_start_date` is
low-sensitivity, but do not add balance data to it).

---

## 4. Edge function `supabase/functions/pto/index.ts`

**Copy the house template**: `supabase/functions/filming-plans/index.ts`
(browser-callable, service-role Supabase client, explicit per-field payload
validation) + `supabase/functions/_shared/staff-role-auth.ts` for auth + the
action-style API of `supabase/functions/smm-weekly-reports/index.ts`. Do NOT
copy `_shared/b4-write.ts` / `deliverable-write` — that tier is service-only
Linear machinery.

Auth: secret header `X-Syncview-Key` checked via
`authorizeStaffKey(key, allowedRoles)` against the function secrets
`ROLE_KEY_ADMIN` / `ROLE_KEY_SMM` / `ROLE_KEY_CREATIVE` (already deployed —
no new secrets needed). `X-Syncview-Actor` / `X-Syncview-Role` are attribution
only and MUST NOT elevate access. 401 unknown key / 403 known-but-insufficient
(`staffAuthFailureStatus`). Constant-time comparison throughout. CORS: same
header set as filming-plans (`x-syncview-key, x-syncview-actor,
x-syncview-role` included), `OPTIONS → 204`, `Cache-Control: no-store`.
Deploy with `--no-verify-jwt` like every other function.

### API surface

| Action | Method | Roles | Behavior |
|---|---|---|---|
| `?action=overview` | GET (auth via header) | any staff | Returns: the caller's balance detail (wellness granted/used/available, sick used/available, floating-holiday status, next accrual date), all members' `{name, wellness_available, on_leave_today}`, approved absences for the calendar (±3 months), the caller's own request history, and the fixed-holiday list. |
| `action=request` | POST | any staff | Validates: member has `pto_enabled` + `pto_start_date`; eligibility (60 days) for paid types; `days` matches the weekday count of the range (recompute server-side, don't trust the client); wellness balance sufficient (else 409 `insufficient_balance`); floating holiday not already used this calendar year. Inserts `pending`. |
| `action=decide` | POST | **admin only** | `{request_id, decision: 'approved'\|'denied', decision_note?}`. Re-validates balance at decision time for wellness. Sets `decided_by` from the verified actor. |
| `action=cancel` | POST | requester (pending only) or admin (any future) | Sets `cancelled`. |
| `action=adjust` | POST | **admin only** | Inserts a `pto_adjustments` row (used for Hrvey seeds and corrections). |
| `action=set_start_date` | POST | **admin only** | `{member_id, pto_start_date, pto_enabled}`. |

The accrual engine (§2) is a pure function in the same file — write it as
**annotation-free plain JS** (valid TS) named `computePtoBalance(member,
requests, adjustments, asOfDate)` so the offline unit suite can string-extract
and execute it (house test style, see §7). Every date rule from §2 lives here.

### Deploy workflow

New file `.github/workflows/deploy-pto-edge-functions.yml`, cloned from
`deploy-onboarding-edge-functions.yml`: trigger paths
`supabase/functions/pto/**`, `supabase/functions/_shared/staff-role-auth.ts`,
the workflow itself; deploy loop `supabase functions deploy pto --project-ref
uzltbbrjidmjwwfakwve --no-verify-jwt`.

---

## 5. Front end (`index.html`) — all line refs at pinned commit

### 5.1 Header consolidation ("the expandable menu")

Current top-right (`.header-actions`, markup lines **6598–6612**): staff
identity button `#staffIdentityButton` (+ popover `#staffAccountPopover`),
status-palette toggle `#statusPaletteToggle`, theme toggle `#themeToggle`.

Replace the three visible buttons with **one** menu button (`#headerMenuButton`,
person/avatar icon; keep the green `is-valid` signed-in state styling from
`.staff-identity-btn`, CSS lines 1344–1345). Clicking opens a popover reusing
the **existing** `.staff-account-popover` pattern (CSS 1346–1358; open/close/
outside-click/Escape/focus-trap logic in `_syncviewOpenStaffAccount` lines
16815–16854 / `_syncviewCloseStaffAccount` 16801–16814) with rows:

1. Identity block: signed-in name · role, sign in/out (existing
   `_syncviewOpenStaffIdentity` flow).
2. **Time Off** → `navTo('time-off')` (menu item hidden until the runtime flag
   is on, see §5.4).
3. Dark mode row → calls existing `toggleSyncViewTheme()` (lines 6926–6934).
4. Original status colors row → existing `toggleSyncViewStatusPalette()`
   (6935–6943).

Hard constraints:
- **Keep** `toggleSyncViewTheme`, `toggleSyncViewStatusPalette`,
  `_syncviewApplyTheme`, `_syncviewApplyStatusPalette` and their localStorage
  keys (`syncview_theme`, `syncview_status_palette`) intact — unit tests
  string-extract them. Keep elements with ids `#themeToggle` /
  `#statusPaletteToggle` in the DOM (now as menu rows) so
  `_syncviewApplyTheme`'s aria/title updates keep working.
- Menu hidden on client/intake/onboarding/SMM surfaces exactly like today's
  controls (`_syncviewStaffEligible` lines 16668–16672; `_syncviewThemeAllowed`
  6883–6888 hides toggles on `?c=` links — the whole header is hidden on those
  surfaces anyway).
- The prod-polish gate asserts: desktop nav containment (nav never collides
  with the top-right controls), the 390px two-row phone header, and accessible
  names on icon-only buttons. Give `#headerMenuButton` a proper `aria-label`,
  `aria-haspopup="menu"`, `aria-expanded`. The top-right area is NOT inside the
  locked `?prod=1` design surface, so no parity contract applies — but any
  `index.html` edit runs the fast prod-polish lane, so don't regress those
  layout assertions.

### 5.2 New top-level tab `#time-off`

Registration checklist (all six touchpoints, from the nav audit):
1. Nav: no visible header button — the tab is reached from the menu (keeps the
   crowded nav untouched). `navTo('time-off')` must still work: add the key to
   the dispatch `if/else` (lines **15339–15415**) → `renderTimeOffView()` /
   `mountTimeOffView()`; add to the `.active`-toggle block (15260–15280) as a
   no-op (no nav button to highlight).
2. Hash routers: add `time-off` to both (lines **34967–34982** and
   **35070–35085**).
3. Boot gate: add `'time-off'` to `FAST` + `RESTORABLE_FAST` (lines **89–90**)
   and to `FAST_TABS` (line **30947**); add a
   `html[data-boot-nav="time-off"]` skeleton mapping (~1748) — reuse the
   generic skeleton; without this the tab still works but flashes on refresh.
4. Do NOT touch the `production`/`linear` key/label split (navProd=Linear,
   navLinear=Submit) — repo law.

Tab content (staff, any role):
- **My balance card**: wellness available (big number — this is the whole
  point), granted so far this leave year / used, sick remaining, floating
  holiday used?, next accrual date, current leave year range.
- **Request form**: type, start/end date pickers, computed weekday count
  (editable to subtract half-days), note; <14-days-notice warning banner;
  submit → `action=request`.
- **My requests**: table with status chips; cancel button on pending.
- **Team calendar**: month grid (prev/next), approved absences as name bars +
  the 5 fixed holidays — visually equivalent to the Hrvey calendar it
  replaces. Data from `overview`. Weekends shaded.

Follow the SMM-report front-end shape: one `SRP`-style module prefix (`_pto*`),
a `PTO_EF_URL = CAL_SUPABASE_URL + '/functions/v1/pto'` constant next to
`SMM_WEEKLY_REPORTS_URL` (line **16530**), fetches via the existing
`_syncviewEfHeaders` injector (line **17737**) which auto-attaches the staff
key headers, and the filming-plans 401-retry pattern (`_fpPostPlan`, line
**11519**: on 401 clear cached identity, re-prompt sign-in, retry once).

### 5.3 Kasper subtab "Time Off"

Kasper (the approver) works in the Kasper tab, so approvals live there:
- Add `{ key: 'time-off', label: 'Time Off', icon: …, showCount: true }` to
  `KASPER_SUBTABS` (line **41695**); count = pending requests (badge like the
  review queue).
- Case in `_kasperRenderTab` (line **42110**) → renderer with: pending queue
  (approve/deny + note), all-members balance table (name, hire date, granted,
  used, available, sick — negative balances in red), and admin tools: set hire
  date / enable member, add adjustment.
- Admin-key gating: the decide/adjust/set_start_date calls require the admin
  role key; the UI should require a signed-in `admin` identity
  (`_syncviewStaffCan`, line **16630**) for the action buttons. Kasper needs
  the admin role key to approve — Sidney provisions that outside the repo.

### 5.4 Runtime flag (rollback law)

Ship dark behind `syncview_runtime_flags.pto_v1 = {"mode":"off"}` (house
mode-flag shape, cf. `thumbnail_revision_v2`). Front end reads the flag: when
`off`, the menu hides the Time Off entry, `navTo('time-off')` bounces to home,
and the Kasper subtab is hidden. One-step kill = set `mode:"off"`. Add the
Live State row to `ROLLBACK.md`; log flips in `EXECUTION_LOG.md`.

---

## 6. Seed data (apply AFTER deploy, via `action=set_start_date` + `action=adjust`)

**The real member seed table (names, hire dates, days used) is deliberately
NOT in this repo — the repo is public (ROLLBACK.md rule 8) and this is
personal HR data.** It lives in the owner's private Google Drive doc
"PTO Tracker — private seed data". The coding agent does not need it:
implementation uses the synthetic fixtures in §2.7; the owner applies the
real seeds through the Kasper subtab admin tools after deploy (adjustments
carry `reason='hrvey_migration'`, `effective_date` = the usage date where
known).

Seeding is owner-side and does NOT block implementation. Roster note for the
implementer: `pto_enabled` defaults to false precisely so the owner can
enable only confirmed contractors (the Hrvey employee export mixes
contractors with client accounts).

---

## 7. Repo compliance checklist (CI-enforced — the PR fails without these)

- [ ] `docs/truth/ENDPOINTS.md`: add `functions/v1/pto`; bump the
  `"<N> literal + <M> composed" Edge Functions` count string in
  `docs/independence/SYSTEM_MAP.md` (checked by `test/truth-sync.js`).
- [ ] Offline unit tests `test/pto-accrual.js` (+ more as needed) in the house
  string-extraction style (`grabFunc`/`grabConst` from `index.html` /
  function sources, sandbox, `ok()` asserts — model: `test/save-indicator-rollout.js`).
  MUST cover: 60-day eligibility; +2 initial grant; 0.5 vs 1.0 monthly rates;
  bucket flip carry-over; caps (6/12); anniversary reset (Fixture A);
  Feb-6-2026 baseline (Fixture B); negative-seed handling (Fixture C);
  weekday counting; the §2.7 worked examples verbatim.
- [ ] `npm test` green; expect the prod-polish **fast lane** to run on any
  `index.html` PR — keep Production surface, nav containment, 390px header,
  and a11y names intact.
- [ ] `docs/features/PTO_TRACKER.md` — the living feature contract (placement
  & gating / policy / table + security posture / API / flag & rollback /
  out of scope), modeled on `docs/features/SALES_INTAKE_DESIGN.md` structure.
- [ ] `EXECUTION_LOG.md` dated entries: migration apply, EF deploy, flag flips.
- [ ] `ROLLBACK.md` Live State row: `pto_v1` flag, one-step kill.
- [ ] No REPO_MAP.md change needed (no new top-level path / docs subdir) —
  unless you add one, then same-commit update.
- [ ] LF line endings in `index.html` (string-extracting tests depend on it).
- [ ] No secrets in code/docs/commits (public repo). Role keys stay in
  Supabase function secrets.

## 8. Manual steps (owner — not the coding agent)

1. Apply the migration SQL in the Supabase SQL editor; log in EXECUTION_LOG.
2. Confirm the real contractor roster; ensure each has a `team_members` row.
3. Seed hire dates + adjustments (§6) via the Kasper subtab admin tools.
4. Give Kasper the admin role key (for approvals).
5. Flip `pto_v1` to `{"mode":"on"}`; announce to the team.
6. After 2 clean weeks: cancel Hrvey; delete the interim
   "PTO Accrual Tracker (Synchro Social)" Google Sheet.

## 9. Out of scope (v1)

- Slack/email notifications (Kasper subtab badge is the v1 signal; NO n8n).
- Realtime updates on the tab (refetch on mount/action is sufficient).
- Client-visible anything: this surface is staff-only, locked behind staff
  keys and the app password gate.
- Editing the accrual constants via UI (they're code constants + the three
  Kasper rulings are documented in §2; changes are code changes).
