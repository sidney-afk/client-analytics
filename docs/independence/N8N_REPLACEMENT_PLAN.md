# The n8n webhooks that read Linear, and what replaces each one

> **Lane LX-N8N.** Written 2026-09-08 against `main@d8866d9` (the tip after #1354
> merged). Ledger entry: `docs/ops/OPEN_REPAIRS.md` item **181**.
>
> **This document installs nothing.** Every n8n workflow named here was read
> about, not touched: no create, edit, activate, deactivate, or test-run. The
> plans below are written so a person with the owner's go-ahead can execute
> them later. Where a plan needs an n8n change, it says so and stops there.
>
> **Public-safe.** No credential values, webhook secrets, client display names,
> or Linear API keys. Client slugs and counts only.

---

## 0. Why this exists

SyncView's browser calls n8n webhooks that reach into Linear on every request.
When the Linear account lapses, those workflows do not degrade — they fail at
the API call and the surface above them goes blank or errors. This document
establishes which endpoints those actually are, decides what happens to each,
and writes the design for the ones that need a native equivalent.

The programme already has good material on this: `TRACK_B_LINEAR_REPLACEMENT_SPEC.md`
(§9.11 for editors-week), `LINEAR_CUTOVER_TOUCHPOINT_INVENTORY.md` (2026-07-14
disposition table), `GO_LIVE_CHECKLIST.md`, and `SYSTEM_MAP.md`. This document
does not restate them. It does three things they do not: it re-derives the
endpoint list from today's `index.html` rather than a July snapshot, it names
where the three source documents disagree, and it states the failure mode for
every replacement.

---

## 1. The endpoint list, re-derived

Method: `grep -oE 'webhook/[a-zA-Z0-9_-]+' index.html | sort -u` gives **56**
distinct webhook slugs on `main@d8866d9` — the same derivation `test/truth-sync.js`
uses. Every line number below was re-read on that commit, not carried forward
from an earlier audit.

### 1.1 Endpoints that reach Linear

| Endpoint | URL const | Call sites | Returns | Surface that dies | Audience |
|---|---|---|---|---|---|
| `editors-week` | `EDITORS_WEEK_URL` :22419 | **1** — `_kasperLoadEditors` :78774 | `{weekStart, weekLabel, editors[]}` — per-editor Linear issue histories for a week | Kasper tab → **Editors** subtab | Staff (Kasper only) |
| `linear-issues` | `LINEAR_ISSUES_WEBHOOK` :14035 | **1** — `loadLinearIssues` :14599, fetch :14632 (URL composed :14628-14631) | array of active VID/GRA issues (identifier, url, title, status, assignee, due, client) | **Workload** board when the Supabase mirror errors or returns 0 rows; also the Calendar bulk-create link poll's feeder | Staff |
| `linear-issue-statuses` | `LINEAR_STATUSES_URL` :22417 | **2** — `_calRefreshParentLinkFlags` :33691, `_calReconcileLinearStatuses` :33846 | `{ok, statuses{}, meta{ isSubIssue, hasProject, hasDue, hasEditor }}` | Calendar **completeness banners** (:33691); Calendar Linear→card status pull on the `?v2=0` path only (:33846, early-returns under v2) | Staff **and client** (Calendar renders for `?c=&v=calendar`) |
| `linear-subissues` | `LINEAR_SUBISSUES_URL` :22415 | **4** — `_calSyncStatusFromLinear` :33758, `_calLinearImportFetch` :33974, `_calBulkLinkFetch` :34251, `_sxrSyncStatusFromLinear` :69969 | `{ok, parent{identifier,status,url}, subIssues[]}` | Calendar **Import from Linear** and **Bulk-link** modals; Calendar + Samples-New **point-adoption** when a link is freshly pasted | Staff (modals); point-adoption fires on any link save |
| `linear-tweak-comments` | `LINEAR_TWEAK_COMMENTS_WEBHOOK` :14036 | **1** — `wlFetchTweakComments` :19343 | `{ok, comments{ id: [{author, body, createdAt}] }}` | Workload **Tweak-Needed popover** inline comment preview | Staff |
| `linear-projects` | `LINEAR_PROJECTS_WEBHOOK` :13872 | **1** — `fetchLinearProjects` :13988 | array of VID project names | Submit tab **project dropdown** (legacy source; the same function already reads native `clients` as its second source at :14004-14012) | Staff, and clients on the `?intake=1` link |
| `send-urgent-slack` | `URGENT_SLACK_URL` :22437 | **1** — :33393 | `{ok}` | **URGENT** button on Calendar, Samples-New and both Kasper surfaces | Staff |

**`send-urgent-slack` is a Linear reader.** It is shaped like a Slack write and
is filed under "Slack pings" in `SYSTEM_MAP.md` and under "Misc" in the 2026-07-03
audit, but its n8n graph resolves the issue's **current Linear assignee** to pick
the Slack mention (`LINEAR_CUTOVER_TOUCHPOINT_INVENTORY.md:349`). It fails with
Linear. Leaving it out of a "Linear readers" list is exactly how a cutoff
surprises someone.

### 1.2 Endpoints that write Linear (in scope because they also die)

The brief scopes this document to readers. These four are writers, but the
sentence "when the Linear account lapses, each of those endpoints starts
failing" is equally true of them, so they are carried here with their
classification rather than left for someone else to rediscover.

| Endpoint | URL const | Call sites | Surface | Audience |
|---|---|---|---|---|
| `linear-set-status` | :22416 | **4** — outbox dispatch :32594 and :68952, direct :32768, :69076 | Every component status change on a linked card (Calendar + Samples-New) | Staff and client |
| `linear-add-comment` | :22418 | **4** — outbox dispatch :32594 and :68952, direct :32794, :69098 | Client/Kasper tweak text mirrored to the editor's Linear inbox | Staff and client |
| `video-form` / `graphic-form` | :13870 / :13871 | **1 shared** — `_linearAwaitCreate` :47802, target resolved by `_linearTargetForTeam` :47607-47609 | Submit tab: creates the VID/GRA parent + children in Linear | Staff, and clients on `?intake=1` |

### 1.3 Endpoints that look Linear-bound and are not

| Endpoint | URL const | Call sites | Why it survives |
|---|---|---|---|
| `log-linear-submission` | :13873 | **3** — :47985, :48458, :48496 | Appends the `Linear Submissions` Google Sheet. Touches no Linear API. The name is the only Linear thing about it. |
| `kasper-queue` | :22414 | **1** — :77159 | Middle fallback in the Kasper calendar fan-out: Supabase `calendar_posts` first, this second, per-client `calendar-get` third. Reads Sheets, never Linear. |

---

## 2. Where the three sources disagree

The brief asked for this specifically, and it is the part most likely to save
someone a wasted day. Seven disagreements, each verified on `main@d8866d9`.

**(1) `docs/truth/ENDPOINTS.md` says "n8n webhooks (54)". The real number is 56.**
The *set* it enumerates is correct — `test/truth-sync.js` re-derives the set from
`index.html` and that assertion passes. The parenthetical count in the heading is
not machine-checked, so it drifted two behind when `tiktok-upload-url` and
`tiktok-upload-direct` landed on 2026-08-18. `SYSTEM_MAP.md:1537` says 56 and
enumerates 56. **`SYSTEM_MAP.md` is right; the ENDPOINTS.md heading is stale.**

**(2) `ENDPOINTS.md` files `log-linear-submission` under "Linear bridge".** It is
not a Linear bridge. PR #1346 establishes it appends a Google Sheet and calls no
Linear API, and the code agrees — the three call sites send `{timestamp,
clientName, mode, webhookJson}` to a Sheets-append branch. Grouping it with the
Linear bridge invites someone to retire it during the cutoff. The 2026-08-26
incident (a videographer refused eleven times, the only copy of his work in his
own browser) is the reason that would be expensive.

**(3) Every line number in `LINEAR_CUTOVER_TOUCHPOINT_INVENTORY.md` is stale.**
It was verified at `e3961b6` on 2026-07-14 and says so honestly, but nothing in
the document warns a reader that the anchors have since moved by tens of
thousands of lines. Not one range still points at its code:

| Endpoint | Inventory says | Actually (`main@d8866d9`) |
|---|---|---|
| `editors-week` | `index.html:43879-43925` | const :22419, fetch :78774 |
| `linear-tweak-comments` | `index.html:13479-13510` | const :14036, fetch :19343 |
| `linear-projects` | `index.html:11665-11682` | const :13872, fetch :13988 |
| `linear-issue-statuses` | `index.html:20530-20689` | const :22417, fetches :33691, :33846 |
| `linear-subissues` | `index.html:20583-20630`, `20735-21235`, `37358-37382` | const :22415, fetches :33758, :33974, :34251, :69969 |
| `linear-issues` (workload) | `index.html:11684-11917` | const :14035, fetch :14632 |

The dispositions in that document are still the best thinking available. Only
its coordinates are dead.

**(4) The 2026-07-03 audit's "n8n GET/POST reads" list omits `send-urgent-slack`.**
The same audit describes the Linear lookup correctly in §3 ("n8n resolves editor
from Linear + Video Editors sheet") but never carries it into the reader
enumeration in §2 or the Linear-touchpoint list in §4. A reader who trusts §2 as
the reader list will miss it. See §1.1 above.

**(5) The 2026-07-03 audit calls `linear-issues` "workload fallback" — it has a
second caller.** `SYSTEM_MAP.md:1009` records the correction: `loadLinearIssues`
is also the Calendar bulk-create link poll's data source, sharing the feeder and
its cache. The `force` branch at :14628-14631 exists only for that poll (it
appends `t=<now>` and sets `cache: 'no-store'` so a CDN cannot collapse two
back-to-back GETs). Retiring `linear-issues` on the strength of "Workload has a
native path now" would silently break the bulk-create poll.

**(6) `SYSTEM_MAP.md` corrects an earlier "3 call sites" for `editors-week` to
one. The correction holds.** Re-measured: one constant (:22419), one fetch
(:78774), and the third historical hit was a comment. This is noted because the
correction is easy to un-correct — a naive `grep -c EDITORS_WEEK_URL` still
returns 3.

**(7) The lane brief that commissioned this document says `index.html:22342`
still calls `editors-week` on `main`.** The claim is right and the anchor is
wrong. Line 22342 on `main@d8866d9` is onboarding CSS. The constant is at 22419
and the only call site is at 78774. The **substance is confirmed**: `main` today
still calls `editors-week`, so the ordering constraint in §5 stands exactly as
the brief states it.

---

## 3. Classification

| Endpoint | Class | Reasoning |
|---|---|---|
| `editors-week` | **REPLACE** | Kasper's Editors subtab stays. Native replacement is built in **PR #1346** (commit `1c96322b`, on `deliverable_events`) but is **not merged**. Plan and its unresolved parity gap: §4.1. |
| `linear-issues` | **REPLACE** | Workload stays and the bulk-create poll stays. Native path is in **PR #1344** (LX-A). Plan: §4.2. |
| `linear-issue-statuses` | **REPLACE** (banners) + **RETIRE** (reconcile) | Two callers with different fates. The `_calReconcileLinearStatuses` caller (:33846) already early-returns under v2 and is reachable only on `?v2=0` — retire it with the v1 path. The banner caller (:33691) needs a native source. Plan: §4.3. |
| `linear-subissues` | **RETIRE** | Both its jobs are Linear-shaped by construction. The import/bulk-link modals exist to pull a Linear parent's children into cards; after the cutoff there is no Linear parent. Point-adoption exists to copy a Linear issue's status onto a card; after the cutoff the card *is* the record. The replacement is not a native `linear-subissues` — it is a native deliverable picker, which `production-write`'s `intake_create` and the batch model already make possible. Detail: §4.6. |
| `linear-tweak-comments` | **REPLACE** | The Workload Tweak-Needed popover stays. Native source is `production_comments` through the deployed `production-comments` Edge Function. Plan: §4.4. |
| `linear-projects` | **RETIRE** | The replacement is already in the same function. `fetchLinearProjects` (:13982) fetches the legacy list at :13988 and native `clients` rows at :14004-14012, and renders whichever the cohort flag selects. Retirement is deleting the legacy half, not building anything. Detail: §4.6. |
| `send-urgent-slack` | **REPLACE** | The URGENT button stays and is load-bearing for tweak turnaround. Only the assignee lookup is Linear. Plan: §4.5. |
| `linear-set-status` | **RETIRE** | Superseded by `production-write` + `mirror_outbox` + `linear-outbound`. After the cutoff there is nothing downstream to mirror to. |
| `linear-add-comment` | **RETIRE** | Same, superseded by the `production-comments` gateway (F43 canonical add/reply/edit/delete/resolve). |
| `video-form` / `graphic-form` | **RETIRE** | Superseded by `production-write`'s `intake_create` on the `submission` and Calendar surfaces (#850 cohort). |
| `log-linear-submission` | **KEEP** | Does not read or write Linear. Appends a Google Sheet, and is the pre-gateway fallback log that the 2026-08-26 incident exists to justify. It survives the Linear cutoff untouched. |
| `kasper-queue` | **KEEP** | Does not read Linear. Reads Sheets as the middle fallback in the Kasper fan-out. Survives the cutoff with **nothing owed**. The touchpoint inventory's caveat here — four Kasper visibility predicates gating on `graphic_linear_issue_id`, so thumbnails drop out of review once the column stops being populated — **is closed on `main@d8866d9` and must not be carried forward.** `_calCompLinked` (:28124-28135) accepts either the legacy URL column or `graphic_deliverable_id` / `video_deliverable_id`, and `_calCompKasperVisible` gates on that shared predicate (:45758). `test/cutover-fix-pack-ui.js:158-196` is the F04 fix pack and pins all four Kasper decisions plus both SMM/SXR pill locks for a native-ID-only graphic. |

---

## 4. The REPLACE plans

Each plan states what the native version reads, the response shape the existing
browser caller needs, the auth posture, and **the failure mode** — what a user
sees when it breaks, and whether failing open or failing closed is correct there.

The failure-direction rule this repo works under (`AGENTS.md`, owner directive
2026-08-27): a client-side guard that could go either way chooses **permissive**,
because an absence is the one failure a user cannot report accurately. That rule
governs what the UI *hides*. It does not license reading data without checks —
server-side guards stay **fail-closed**. Every plan below is read-side, so the
distinction matters at every entry: fail closed on *authorization*, fail
*visible* on *availability*.

### 4.1 `editors-week` → `deliverable_events`

**Status.** Built in PR #1346, not merged. This section documents the plan and
the one gap that PR does not close.

**Reads.** `public.deliverable_events` (`migrations/2026-07-06-b1-linear-data-model.sql:87`)
joined to `public.deliverables` and `public.team_members`. The event row carries
`deliverable_id`, `batch_id`, `client_slug`, `ts`, `actor`, `role`, `action`,
`from_status`, `to_status`, `source`, `payload`. The index
`deliverable_events_client_ts_idx (client_slug, ts desc)` serves the weekly window.

A "delivery" in the legacy semantics is a hand-off out of a held state into
`smm_approval` / `kasper_approval` / `client_approval`. Natively that is a row
with `to_status` in that set, bounded by `ts` within the Mon–Sun America/Chicago
week.

**Response shape.** `_kedPaint` (:78799) and `_kedEditorStats` read
`{weekStart, weekLabel, editors:[{id|assigneeId, name|assigneeName, ...}]}`, and
`_kedWeekDateKeys(data.weekStart)` derives the Mon–Sun bars from `weekStart`.
`_kedLoadEditorsCache` additionally requires `data.weekStart` to be present and
to equal `_kedExpectedLastWeekMondayDate()`, or the cache is discarded. **The
native response must keep `weekStart` as a date string that survives
`String(x).split('T')[0]`**, or every load misses cache and refetches. Keeping
the shape identical means the browser caller needs no change beyond the URL and
the auth header.

**Auth posture.** Staff-only, fail closed. This is per-editor, per-client,
per-day labour data for named people; it is the most sensitive read in the Kasper
tab. It belongs behind a staff role key on an Edge Function, matching
`kasper-ad-performance-read` and `quiz-leads-list` — service-role reads,
anonymous GET returns `401`.

> **Do not serve this from the browser's publishable key.** `deliverable_events`
> is granted `select` to `anon` and `authenticated` with a permissive
> `using(true)` policy (`2026-07-06-b1-linear-data-model.sql:698`, `:682-688`),
> and **no later migration in this repo revokes it.** The F53 migration
> (`2026-07-23-f34-f53-production-attachments.sql:280,296`) revoked table-level
> SELECT on `batches` and `deliverables` from `public, anon, authenticated`, but
> not on `deliverable_events`. The only carve-out is one restrictive policy for
> comment-body snapshots (`2026-07-12-production-comments.sql:158-161`), which
> leaves the ordinary activity rows — `client_slug`, `actor`, `role`,
> `from_status`, `to_status`, `ts` — anon-readable. That is the F48 exposure
> shape reproduced natively. **Source-level finding, not live-verified** (see
> §6). Whoever executes this must confirm the live grant and revoke it in the
> same window as the cutover, or the replacement inherits the defect it replaces.
> **The Edge Function is not a substitute for the revoke.** While the grant
> stands, the committed publishable key reaches `deliverable_events` directly
> through PostgREST — no application reader involved — so serving the tab from
> an authenticated function protects that function's response and nothing else.
> Both are required.

**Failure mode.**

- *What a user sees.* Kasper opens Editors and gets one card: "Couldn't load
  editor stats" with the error text (`:78789-78792`) — **and whatever was on
  screen is gone.** The cache does not keep rendering through a failure, on
  either path. On an explicit Refresh (`forceRefresh`), `_kedLoadEditorsCache`
  is skipped entirely (`:78759`), the body is replaced by a loading skeleton
  (`:78770`), and the catch replaces that with the error card. On a non-force
  load the catch's `b.innerHTML = …` (`:78787-78792`) is unconditional too, so
  it blanks an already-painted week just the same. The cached payload survives
  in `localStorage` and would be re-read on the *next* non-force load — it is
  durable, but it is not on screen.
- *Therefore the replacement owes work the legacy version never did.* "Keep the
  stale week visible and label it stale" (below) is **not** preserved behaviour
  to port; it is a change. Budget for it, or the native Editors tab reproduces
  today's blank-on-failure.
- *Fail open or closed?* **Closed on authorization, visible on availability.**
  An unauthorized caller gets `401` and no rows — never a partial or empty-looking
  success, because "no editor deliveries last week" is a legitimate render
  (`:78813`) and is indistinguishable from a silently-denied read. The native
  reader must therefore distinguish *denied* from *empty* in its response and the
  browser must render them differently. Today it cannot: `json.ok === false`
  throws, but a `200` with `editors: []` paints "No editor deliveries last week."
  A denied read that returns an empty array would tell Kasper his editors did
  nothing. **That is the single most dangerous line in this replacement.**
- *On availability failure* (function down, timeout): show the error card, keep
  the stale cache visible, and label it stale. Never substitute an empty week.

**The gap PR #1346 does not close.** `deliverable_events` has **no event-time
assignee column**. Attribution must join through `deliverables.assignee_id`,
which is the *current* assignee — reproducing exactly the defect F48 records in
the legacy endpoint ("attributes every past transition to the issue's current
assignee"). The native version is not worse than the legacy one on this axis, and
it is not better. `CUTOVER_AUDIT_2026-07-13.md` (F48 row) already measured the
consequence: of 401 source transitions for the same production videos, 27 are
absent natively and 239 native rows are unmatched or duplicative; exact source
time and immutable event-time member are not stored. **Closing that gap needs a
schema change** (an `actor_member_id` / event-time member on `deliverable_events`,
populated forward and backfilled where derivable) which is outside this lane and
is not in PR #1346. Until it lands, the native Editors tab is a *delivery-count*
parity, not a *report* parity, and `GO_LIVE_CHECKLIST.md:999` is correct to
require the full §9.11 UI/semantic parity before retirement.

### 4.2 `linear-issues` → native Workload composition

**Status.** Native path in PR #1344 (LX-A), not merged.

**Reads.** `deliverables` + `batches` + `clients` + `team_members`, replacing the
`workload_issues` mirror as the base issue set. The existing browser read is
already Supabase-first (`_wlV2FetchIssues`) with `linear-issues` only as the
fallback when the mirror errors or returns zero active rows (`:14595-14608`).

**Response shape.** `loadLinearIssues` returns `{issues, fetchedAt, fromCache}`
where `issues` is `Array.isArray(data) ? data : data.issues`. Both branches must
keep producing rows that `_wlV2MapRow`'s consumers accept: identifier, url,
title, status, `team_key`, `assignee_name`, `client_name`, `due_date`. The
second caller — the Calendar bulk-create link poll — needs the `force` branch's
cache-bypass semantics preserved (`:14628-14632`); a native read served from
PostgREST or an EF must be equally uncacheable or the poll re-reads its own
stale answer.

**Auth posture.** Staff-authenticated. The Workload sidecar (`workload-plan`)
already requires a staff identity and allows Admin/SMM/Creative to list; the
base set should not be looser than the sidecar that annotates it. Note
`deliverables` table-level SELECT is already revoked from anon (F53), so a
browser-direct PostgREST read is not available — this must go through an Edge
Function or the `production_deliverables_browser_v1` view.

**Failure mode.**

- *What a user sees.* **Not an empty board — a frozen one.** This is the one
  place my own first analysis had the failure backwards, and
  `LINEAR_EXIT_LANES.md` (now on `main`) states the real shape: when Linear
  dies the reconcile returns `[]` on a bad read and its safety gate keeps the
  old rows, so roughly 2,000 `workload_issues` rows stay `active=true` with a
  `synced_at` that stops advancing. The board renders normally and is wrong.
  Separately, in the browser, a failed v2 read falls through to
  `linear-issues`, and if that also fails the cached `wlWriteCache` payload
  renders with its `fetchedAt` age.
- *Fail open or closed?* **Fail visible — and "visible" has to cover staleness,
  not just emptiness.** Both directions are wrong here and they are not
  symmetric. A zero-row render claims nothing is outstanding, and an editor who
  believes it stops working; the current code already treats zero active rows as
  a *fallback trigger* rather than an answer (`loadLinearIssues` :14599,
  fallback trigger :14606-14607), which is the right instinct and must survive
  the replacement. But stale-and-plausible is the worse of the two, because a
  blank board is at least legible as broken and a frozen one is not. So the
  native reader owes **both**: an explicit error the board can render as
  "couldn't load" instead of an empty set, **and** a freshness signal the board
  surfaces when the data stops advancing. `LINEAR_EXIT_LANES.md` is why lane A
  must be live *and observed* before lane F stops the reconcile.
- *On the write side there is nothing to fail:* the board is read-only in the
  browser; plan and due writes go through `workload-plan` / `workload-linear`
  and already have their own receipt semantics.

### 4.3 `linear-issue-statuses` → native batch/deliverable fields (banners only)

Two callers, two fates.

**RETIRE — `_calReconcileLinearStatuses` (:33846).** It early-returns whenever
`_calV2Ready()` (:33833, inside `_calReconcileLinearStatuses` :33825), so it is reachable only on the `?v2=0` opt-out
path. It is the v1 Linear→calendar pull and dies with v1. No replacement.

**REPLACE — `_calRefreshParentLinkFlags` (:33660, fetch :33691).** This is the one that
matters. It sources the completeness banners — "this card's issue has no
project / no due date / no editor", and "you linked a parent, link the sub-issue".

**Reads.** All four facts are already native columns.

| Banner fact | Legacy `meta` key | Native source |
|---|---|---|
| is this a sub-issue or a parent | `isSubIssue` | not applicable natively — a `deliverables` row *is* the unit; a batch is the parent. The banner becomes "this card is not bound to a deliverable". |
| has a project | `hasProject` | `deliverables.batch_id` → `batches` (the native batch is the project analogue) |
| has a due date | `hasDue` | `deliverables.due_date` |
| has an editor | `hasEditor` | `deliverables.assignee_id` → `team_members` |

Resolution is by the documented two-slot card linkage: `deliverables` is uniquely
indexed on `(client_slug, origin, card_id, kind)` where `origin in ('calendar','samples')`
(`2026-07-06-b1-linear-data-model.sql:83-85`). A card resolves its video and
graphic slots directly; no identifier parsing, and none of the `ABC-123`-vs-UUID
poisoning that F139 forced the legacy batch to guard against (`:33858-33860`).

**Response shape.** The browser needs `{meta: { <key>: {isSubIssue, hasProject,
hasDue, hasEditor} }}` keyed the same way it batches its request. Two behaviours
must be preserved deliberately:

1. **`hasProject` is tri-state on purpose.** `:33718` reads
   `e.hasProject !== false` — an older backend that omits the key leaves it
   `undefined`, which is treated as *present*, so the nudge stays off. Keep that:
   a missing key must never turn a banner on.
2. **The unsupported-backend latch.** `_calStatusMetaUnsupported` (declared :33462, guarded :33684, latched :33702)
   disables the whole feature for the session when a response has no `meta`
   object. A native reader that returns `{meta:{}}` for a legitimately empty set
   is fine; one that returns no `meta` key at all silently kills banners for the
   session.

The seven-day persisted cache (`syncview_calLinearMeta_v1`) must be **version-keyed
at cutover** or stale Linear-derived metadata outlives the endpoint that produced it.

**Auth posture.** Calendar is client-facing (`?c=&v=calendar`). These banners are
staff repair affordances; a client does not need to know a deliverable has no
assignee. Serve them behind the staff read path and let the client render omit
them. `deliverables` SELECT is already revoked from anon, so this cannot be a
browser-direct PostgREST read regardless.

**Failure mode.**

- *What a user sees.* Nothing. Every failure path in `_calRefreshParentLinkFlags`
  is a bare `return` (abort/catch at `:33700`, no-`meta` latch at `:33701-33704`) — no toast, no console error,
  no banner. The banners simply do not appear.
- *Fail open or closed?* **Fail open — silently — and that is correct here, but
  only because of what the banner is.** A completeness banner is an *advisory*:
  its absence costs a nudge, its false presence costs trust ("SyncView says my
  issue has no editor, it does"). Under the owner's permissive rule, the
  asymmetry runs the other way from usual: the invisible thing here is a warning,
  not a working option, so hiding it on uncertainty is the safe direction. Keep
  the silent return.
- *The one thing that must not fail open:* the sub-issue/parent distinction, once
  it becomes "is this card bound to a deliverable". That is not advisory — an
  unbound card silently accepts status changes that reach nothing. That banner
  must render on uncertainty, not hide.

### 4.4 `linear-tweak-comments` → `production_comments`

**Reads.** `public.production_comments` through the deployed
`functions/v1/production-comments` Edge Function, which is already the bounded,
no-store canonical-thread reader with the F39 cross-team scope closure applied.
The popover needs the newest few comments on a deliverable in `tweak` status —
the same query the reader already serves, narrowed by deliverable and ordered
`created_at desc`.

**Response shape.** `wlFetchTweakComments` (:19336) needs
`{ok:true, comments: { <id>: [{author, body, createdAt}] }}` — a map keyed by the
id it asked for, one array per key, and **a key present with an empty array for
ids that have no comments**. The cache write loop (`:19350-19352`) coerces a
missing key to `[]` and caches that, so a partial response silently caches
"no comments" for the ids the backend dropped, for the full 5-minute TTL. If the
native reader can return fewer keys than requested, either it must pad, or
`:19350-19352` must stop caching absent keys.

`wlRenderTweakComments` (:19359) slices to 3 and renders `+ N older comment(s) on
the sub-issue in Linear` (:19374) — **that copy must change at cutover**, it names Linear.

**Auth posture.** Staff, fail closed. `production-comments` already resolves
exactly one active compatible roster member or one active exact-client token,
authorizes the exact target/team/client before reading bodies, filters client
pages by audience, and uses non-enumerating denials. Workload is staff-only, so
the roster-member path applies; no new posture is needed.

**Failure mode.**

- *What a user sees.* `wlFetchTweakComments` throws on `!resp.ok` or
  `data.ok === false`, and the popover's fill is abandoned — the sub-issue rows
  render without their comment preview. The standing "always check Frame.io"
  note (`:19312-19315`) is already the fallback instruction, because tweaks left
  in Frame never reach this path at all.
- *Fail open or closed?* **Fail closed, and say so.** This is the one popover
  where a silent empty is actively misleading: a "Tweak Needed" row with no
  comment rendered reads as *"bounced back with no reason given"*, which is a
  real state the UI deliberately renders as nothing (`:19361-19364`). An
  unavailable reader must therefore be distinguishable from an empty thread.
  Today it is not. The replacement should render a one-line "couldn't load
  comments" in the popover rather than reuse the no-comment render.
- *This is the concrete instance of the general rule* stated at the top of §4:
  fail closed on authorization, but make unavailability **visible**, because the
  empty render is semantically meaningful here.

### 4.5 `send-urgent-slack` → `deliverables → team_members`

**Reads.** Only the assignee lookup is Linear. Replace it with
`deliverables.assignee_id → team_members`, resolved from the card's native slot
rather than from a pasted Linear URL. The Slack post itself is unchanged and
survives the cutoff.

**Response shape.** The button latches "Sent" for the session on any `{ok}`. That
is the defect, not the contract — see below.

**Auth posture.** Staff. The button already requires a staff surface.

**Failure mode.** This one is already broken and the replacement must not
reproduce it.

- *What a user sees today.* The button says "Sending…", then latches **"Sent"**.
  The touchpoint inventory (`:349`) records that the active n8n graph "can still
  post and return unconditional success when assignee/mapping is absent" — so a
  ping with no resolvable recipient reports success. The retained execution
  sample had mapped mentions, so this is not evidence of a historical missed
  recipient; it is evidence the UI cannot tell.
- *Fail open or closed?* **Fail closed, with an exact-recipient receipt.** A
  notification that claims delivery it cannot prove is worse than one that says
  "couldn't find the editor". The native version must return the resolved member
  and a destination/message id, and the browser must latch "Sent" only on that
  receipt. A missing mapping stays **retryable and visibly pending** — not
  failed, not sent.
- *Additional dependency to cut in the same change:* Calendar, Samples-New and
  both Kasper surfaces currently **hide or refuse** the URGENT action when
  `linear_issue_id` is absent, and persist that URL as `video_urgent_issue`.
  After the cutoff no card has that column populated, so the button disappears
  everywhere. Under the permissive rule this gate is exactly the wrong shape —
  it hides a working action based on client-side state — and must be repointed to
  the native deliverable binding, not merely relaxed.

### 4.6 The two RETIREs that need a note

**`linear-projects`.** No work to build. `fetchLinearProjects` (:13982) already
fetches both sources in the same call: the legacy list at :13988 and native
`clients` rows (`select=slug,display_name,kind,active&active=eq.true`) at
:14004-14012, with a generation guard so an older cohort request cannot win.
Retirement is deleting the legacy fetch and the `linearLegacyProjects` state that
holds it. **Ordering caveat:** the native branch is gated on
`_writeUiRerouteClients.size || pendingNativeClientSlug` (:14004) — it only runs
for enrolled clients. Deleting the legacy half before every client is enrolled
leaves the Submit dropdown empty for the rest, which is the "absence a user
cannot debug" failure the owner's rule is written against. **Retire only after
full enrolment**, not before.

**`linear-subissues`.** Four call sites, two different retirements:

- *Import (:33974) and Bulk-link (:34251) modals* — these exist to walk a Linear
  parent's children and match them to cards by "Video N". After the cutoff there
  is no Linear parent to walk. The replacement is a native deliverable picker
  reading `batches` → `deliverables` for the client, which the `(client_slug,
  origin, card_id, kind)` linkage makes a direct query. This is new UI, not a
  port, and it is not in scope for any open lane PR I could find.
- *Point-adoption (:33758 Calendar, :69969 Samples-New)* — these copy a freshly
  linked Linear issue's status onto the card. That behaviour has no native
  meaning: the deliverable and the card are two slots of one record, not two
  systems to reconcile. Delete rather than replace. Note the Calendar copy
  refuses to knock a `Posted` component back (`:33782`) and the Samples-New
  copy rejects `Scheduled`/`Posted` (`:69977`) — those guards exist because Linear
  could disagree with the card. Natively nothing can, so the guards go with them.

---

## 5. Ordering — what must merge or deploy before each retirement is safe

Nothing in this list may be deactivated in n8n before the row above it is on
`main` and, where stated, deployed. All six lane PRs are open and unmerged as of
2026-09-08; none of these retirements is executable today.

| # | Retirement | Blocked until | Evidence |
|---|---|---|---|
| 1 | **`editors-week` deactivated** | **PR #1346 merges.** `main@d8866d9` still calls it at `index.html:78774`; Kasper's Editors subtab dies the moment the endpoint stops answering. Deactivating first is a live outage on a staff-only tab with no fallback beyond a one-week cache. | §1.1, §2(7) |
| 1a | *(and, before the tab can be trusted, not merely rendered)* | The event-time-assignee schema gap in §4.1 — **not in #1346**, needs a `deliverable_events` migration. Until then the native tab has delivery-count parity, not report parity. `GO_LIVE_CHECKLIST.md:999` requires full §9.11 parity before retirement. | §4.1 |
| 1b | *(and, independently, before it is served at all)* | **The `deliverable_events` anon-SELECT grant and permissive policy are revoked.** This is not satisfied by putting the reader behind an authenticated Edge Function: while the grant stands, the committed publishable key can query the table straight through PostgREST, so an EF protects only its own response and leaves the F48 exposure exactly where it was. Revocation and the authenticated reader are two requirements, not two options. | §4.1 |
| 2 | **`linear-issues` deactivated** | **PR #1344 merges** AND the Calendar bulk-create link poll is repointed. The Workload half alone is not sufficient — the poll is the second, undocumented caller. | §2(5), §4.2 |
| 3 | **`linear-issue-statuses` deactivated** | The Calendar completeness-banner source is native (§4.3) AND the `?v2=0` opt-out path is retired or accepted as broken. The persisted `syncview_calLinearMeta_v1` cache must be version-keyed in the same change or stale metadata outlives the endpoint by up to seven days. | §4.3 |
| 4 | **`linear-tweak-comments` deactivated** | The Workload popover reads `production-comments` (§4.4), the partial-response caching at `:19350-19352` is fixed, and the "in Linear" copy at `:19374` is changed. | §4.4 |
| 5 | **`send-urgent-slack` assignee lookup repointed** | The URGENT gate is repointed off `linear_issue_id` (§4.5). Ordering matters in the unusual direction here: repointing the *gate* before the *lookup* leaves a button that is visible and silently misdelivers; repointing the *lookup* first leaves a correct button that is hidden. **Do the lookup and the gate in one change.** | §4.5 |
| 6 | **`linear-projects` legacy half deleted** | Every client is enrolled in `write_ui_reroute_clients`. Before that, deleting it empties the Submit dropdown for un-enrolled clients. | §4.6 |
| 7 | **`linear-subissues` deactivated** | The native deliverable picker exists (new UI, not in any open lane PR) AND both point-adoption call sites are deleted. | §4.6 |
| 8 | **`linear-set-status` / `linear-add-comment` deactivated** | All three browser outboxes are drained and neutralized — `syncview_linear_outbox_v1`, `syncview_sxr_linear_outbox_v1`, `syncview_calCardJobs_v1` — including startup, focus, timer, page-hide, resume and reassert paths. A queued item in a tab someone left open replays after deactivation. **And separately, per `LINEAR_EXIT_LANES.md`: the `linear_outbound_enabled` flip is gated on lane B's native naming mint** — `linear-outbound` is what mints `linear_identifier` for native cards, so flipping it off first leaves every new card without a readable name. That gate is lane B's and lane F's, not this document's, but it sits in the same window. | `LINEAR_CUTOVER_TOUCHPOINT_INVENTORY.md` epoch checklist; `LINEAR_EXIT_LANES.md` |
| 9 | **`video-form` / `graphic-form` deactivated** | `production-write` `intake_create` serves every enrolled client on both the Submit and Calendar surfaces, and F101 closes for Advanced single-team intake. | `ENDPOINTS.md`, `production-write` entry |
| — | **`log-linear-submission`** | **Never deactivate.** It is not a Linear endpoint. See §1.3 and §2(2). | PR #1346 body |
| — | **`kasper-queue`** | **Never deactivate for Linear reasons**, and nothing else is owed here. The `graphic_linear_issue_id` predicate repoint that the July inventory lists as epoch work is already done (F04); re-listing it as a blocker would send someone to re-fix a closed issue. | §3 |

**One cross-cutting order.** PR #1346 also inverts the reroute-flag failure
direction: today an unreadable `write_ui_reroute_clients` routes **every** client's
status changes and comments to the Linear webhooks. That inversion should land
before any deactivation in this table, because after deactivation the current
behaviour points every fallback write at a dead endpoint.

---

## 6. What I could not establish

Named specifically, because a gap papered over is how someone later executes a
plan that was never true.

1. **No live n8n workflow was inspected.** The absolute rule for this lane
   forbids touching n8n, and I read no workflow definitions. Everything about
   what a workflow *does server-side* — `editors-week`'s aggregation, the
   `send-urgent-slack` assignee resolution, the `linear-issue-statuses` `meta`
   derivation — comes from `LINEAR_CUTOVER_TOUCHPOINT_INVENTORY.md` (verified
   2026-07-14) and the 2026-07-03/05 audits. **Those readbacks are eight weeks
   old.** Any workflow could have changed since.
2. **The `deliverable_events` anon grant is a source-level finding, not a live
   one.** I established that `2026-07-06-b1-linear-data-model.sql:682-688,698`
   grants and policies anon SELECT, and that no migration in this repo revokes
   it. I did **not** query the live database to confirm the grant is still in
   place, and I did not attempt an anonymous read. It is possible the grant was
   revoked by hand-run SQL that never reached the repo — several tables here were
   created that way. **Verify live before relying on either the finding or its
   absence.**
3. **Response shapes are inferred from the browser's consumption, not from a
   captured response.** I read what `_kedPaint`, `wlFetchTweakComments`,
   `_calRefreshParentLinkFlags` and `loadLinearIssues` *require*. I did not call
   any endpoint. Fields the browser ignores are invisible to this method, and a
   native replacement that omits one may still break a consumer I did not find.
4. **I did not read PR #1346's diff.** I read its description and confirmed from
   the commit subject that `1c96322b` rebuilds Editors on `deliverable_events`
   and retires `editors-week`. The parity gap in §4.1 is derived from the schema
   (`deliverable_events` has no event-time member column) and from
   `CUTOVER_AUDIT_2026-07-13.md`'s F48 measurement — **not** from reading what
   #1346 actually implemented. If that PR carries a migration adding an
   event-time member, §4.1's gap is already closed and this document is wrong
   about it.
5. **RESOLVED after the first draft — the lane map landed on `main` while this
   PR was open** (#1351, then #1352). `docs/independence/LINEAR_EXIT_LANES.md`
   is now readable and §5 has been reconciled against it. Two of its facts
   corrected claims of mine and are folded in above: `workload_issues`
   **freezes** rather than empties when Linear dies (§4.2, where my first
   analysis had the failure backwards), and the outbound flip is gated on lane
   B's native naming mint (§5 row 8). The coordinator's merge order is
   F-monitoring → **B** → **A** → **D** → **C** → **E** → F-rest; nothing in §5
   contradicts it, and §5 remains a *code-dependency* ordering — where the two
   differ, the lane map is authoritative and this document is the companion.
   **Note the scope overlap:** lane **C** (`claude/lx-c-endpoints`, PR #1346)
   owns "the n8n Linear webhooks, Submit routing, urgent alerts, editors-week"
   — this document's exact subject. It is a planning companion to lane C, not a
   competing lane, and it changes no code lane C owns.
   Still unestablished: lane B and lane E have no open PR I could identify.
6. **Client-facing exposure of `linear-issue-statuses` is asserted, not
   measured.** Calendar renders for client links (`?c=&v=calendar`), and
   `_calRefreshParentLinkFlags` is on the Calendar load path. I did not trace
   whether a client-link boot actually reaches it or is short-circuited earlier
   by `_isClientLink`. If it is short-circuited, §4.3's auth posture is stricter
   than it needs to be, which is the harmless direction.
7. **I did not verify which endpoints are still live in n8n.** An endpoint could
   already be deactivated and its browser caller failing silently today. Six of
   the seven readers fail silently by design (bare `return` on catch), so a dead
   endpoint would not necessarily have been reported. The only way to know is a
   live probe, which is a write-adjacent action this lane does not have the
   go-ahead for.
8. **Counts of affected rows are absent on purpose.** Every count I could have
   quoted — how many cards carry a `linear_issue_id`, how many clients are
   enrolled in `write_ui_reroute_clients`, how many `deliverable_events` rows a
   week produces — requires a live read I did not take. Rather than derive them
   from a stale audit and publish a number later sessions would plan against,
   they are omitted. `AGENTS.md`'s 2026-09-05 rule applies: measure with the key
   the shipped code uses, or do not publish the measurement.
9. **This document was itself caught doing the thing it warns about.** The first
   draft carried the July inventory's Kasper-predicate caveat forward as live
   epoch work. It is not: `_calCompLinked` (:28124-28135) has accepted
   `graphic_deliverable_id` since the F04 fix pack, `_calCompKasperVisible`
   gates on that shared predicate (:45758), and
   `test/cutover-fix-pack-ui.js:158-196` pins all four Kasper decisions for a
   native-ID-only graphic. The Codex review on PR #1356 caught it. It is
   corrected in §3 and §5 above, and recorded here because the lesson
   generalises past the one row: **§2's re-verification was positional.** Where
   the inventory made a claim that forced me into the code to re-anchor a line
   number, I checked it. Where it made a purely behavioural claim, I inherited
   it. Treat every claim in §3–§5 that traces to the July inventory without a
   `main@d8866d9` line reference beside it as carrying that same risk, and
   re-check it in code before executing on it.
