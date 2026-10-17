# Retiring `calendar-upsert`: callers, traffic, plan (phase 1, read only)

Session Sunset, 2026-10-16. Nothing was changed: no function, caller, flag or
n8n workflow. Lighthouse and the owner decide before any code moves.

## The one-paragraph answer

`calendar-upsert` is still the **only** writer of a Calendar card's own fields
(caption, dates, name, links, thumbnail, client approvals, Kasper approve and
finish, archive, create, urgent markers, settings row). The native gateway
(`production-write`) covers only **video and graphic statuses** (through the
`production_native_calendar_status_project` trigger), **comments** (client
comment gateway, on for everyone) and the **component fill** deliverable. It
has no operation that writes a card field. So every caller below still needs
`calendar-upsert`, and retiring it means first building one native "card
patch" operation that carries the same guards. All eleven page callers funnel
through four send helpers in `src/index/120-calendar-flags-write-repair.js.part`
(`_calUpsertFetch`, `_calUpsertFetchGuarded`, `_calUpsertFetchClientLink`,
`_calUpsertFetchPinned`), so the page can move with one routing switch.

## Callers

What "native covers" means: the same user action already reaches
`production-write` for that part of the write.

| # | Caller | User action | Writes on `calendar_posts` | Native covers |
|---|---|---|---|---|
| 1 | Page: `_calFlushCardSave` (170) | Staff edits any card field, status pick, date or link move, Linear link set or clear, caption generate result, Retry, journal replay | Edited keys (v2) or whole card (new row / v1), comment cells merged | Video and graphic **status** only (pushed first). Caption and title status, every scalar field: no |
| 1b | Same helper, client review link (170, 185, 190) | Client approves, comments, requests changes | `client_*_approved_at`, statuses, comment cells | Comments yes (comment gateway on). Approval stamps and statuses: no |
| 2 | Page: `_kasperPersistPostWrite` (305) | Kasper approve, undo, comment, request tweak, dismiss, finish, close | `kasper_*` fields, statuses, every comment cell | Video and graphic status, tweak comment. `kasper_*` fields: no |
| 3 | Page: `_calPersistUrgentSentForPost` (140) | Urgent ping to the editor | `video_urgent_*` | No |
| 4 | Page: `_calPersistKasperUrgentForPost` (140) | Urgent ping to Kasper | `kasper_urgent_*` | No |
| 5 | Page: `_calSaveSettings` (130) | Calendar setting toggle | The `__cal_settings__` row | No |
| 6 | Page: `_calAdoptDeliverableLinks` (150) | Automatic, on load | `linear_issue_id` / `graphic_linear_issue_id` | No |
| 7 | Page: `_calBulkUpsertPosts` (150) | Bulk import | Whole new rows | No |
| 8 | Page: `_calFillWriteCardLink` (160) | Organize, fill a component | Deliverable id and link pair | Deliverable yes (`component_fill`). Card link: no |
| 9 | Page: archive (180) | Archive one card or a selection | `status = Archived` | Sub-issue move to Backlog yes. Card status: no |
| 10 | Page: restore (186) | Restore from Archived | `status` | Work item move yes. Card status: no |
| 11 | Page: `_writeNativeSubmissionCardsToCalendar` (200) | Intake turns submissions into cards | Whole new rows | Native deliverables yes. Card row: no |
| 12 | Function: `caption-generate` | Generate caption (new path, switch on for the test client only) | `caption` | No |
| 13 | Function: `calendar-auto-posted` | Timer marks scheduled posts Posted (test client only) | Status fields | No |
| 14 | n8n: "SyncView Calendar — Generate Caption" (active) | Generate caption for every other client | `caption` | No. 14 runs in 14 days, last on 2026-10-09 |
| - | n8n: "SyncView Calendar — Upsert Post" | Old Sheets-era writer | - | Inactive. Only a staff repair pinned to `webhook` still points at its URL |

**Scripts and harnesses that post to it directly** (dormant most days, so a
quiet log does not prove they are gone):

- `scripts/client-signoff-reconcile.js --apply`, run by
  `.github/workflows/client-signoff-reconcile.yml`, posts sign-off repairs.
- The nightly and morning harnesses: `qa/golden_lib.js` and
  `qa/sxr_courier_lib.js` (calendar and samples nightly), `qa/probes/lib.js`
  and the `qa/probes/` scripts, `qa/ef-writepath/`, and the dawn check.
- Rehearsal and evidence tooling that only reads or replays a saved copy
  (`qa/linear-exit-rehearsal/`, `scripts/a1-calendar-upsert-parity.js`,
  `scripts/calendar-upsert-live-delta.js` and others). These need no move and
  are retired in step 7.

Not callers: reorder goes to `calendar-reorder`; the Workload warm-up list
(067) only lists the name; `production-write` mentions it in comments only.

**Tests that name it** (they move or go in the delete step): source and deploy
contract (`calendar-upsert-edge-source`, `calendar-upsert-routing`,
`calendar-upsert-live-delta-lane`, the f27 rollback and deploy lanes,
`deploy-single-function`, CORS and typecheck ratchets); auth and attribution
(b0, b1, b4, `browser-writer-auth`); card save and guards (`calendar-write-guard-browser`,
`calendar-card-write-jobs`, `lost-work-conflict-gate`, `calendar-v2-status-repro`);
client review (`calendar-client-approve-function-browser`,
`docs/syncview-design/tests/client-review-write-browser.js`, the golden
fixture); Kasper and urgent ping; native bridge (`prod-write-gateway-browser`
and the two status bridge tests); feature tests for fill, restore, intake,
thumbnail revisions, caption-generate and auto-posted;
`test/fixtures/write-path-inventory.json`.

## Live traffic, 2 to 15 October (14 full days)

From the function's own log line (`fn: calendar-upsert`, one per save) and the
`calendar_post_events` ledger. "Real" means every client except the test client.

| Who (logged role) | Real clients | Test client |
|---|---|---|
| Staff (`smm`) | 256,434 | about 430 |
| Admin, Kasper (logged as admin) | 19,052 ok, 78 conflicts | about 2,190 |
| Client review link (`client`) | 1,352 | 877 |
| No role (probes, server calls) | 5 | 4,049 |
| Errors | 2 errors, 1 read failure | about 40 |

**About 99% of that was saves that changed nothing.** The ledger, which only
records real changes, holds 2,439 events for real clients in the same window.
Per day, staff saves ran 15,000 to 41,000 with bursts of about 800 a minute,
each card re-saved about 250 times a day. That is the on-load link adoption
loop (caller 6) fixed in #2065 on 2026-10-14. On 15 October, the first full day
after it, real traffic was **909 staff, 262 admin, 42 client** saves. That is
the true baseline: roughly 1,200 saves a day.

Real-client changes by action (ledger, 14 days, 2,439 in all): status change
1,529, comment add 266, create 190, Kasper approve 100, client approvals 244
(graphic 88, video 80, caption 76), Kasper finish 60, comment delete 26,
archive 20, urgent ping 4.

## Owner decisions (2026-10-16)

1. **A separate small Edge Function**, `calendar-card-write`, not a new
   `production-write` operation. It ships on the one-function lane
   (`deploy-single-function`), so a fix never needs a Section 4 capture.
2. **Client review links move too, but last**, after the test client and the
   staff paths have run cleanly for a while. Clients see no change at all: same
   link, same buttons. On the client path `calendar-upsert` stays switched on as
   a **fallback**: a native save that fails goes to `calendar-upsert` and the
   client never sees an error. `calendar-upsert` is deleted only after no client
   save has needed that fallback for 14 days.
3. **The n8n Generate Caption workflow** has not run since 2026-10-09
   (`caption_generate_ef_clients` is `{"all": true}`). First the page's fallback
   to it is removed, so a failed switch read uses the function, not n8n (PR
   #2102). Once that is live, Lighthouse deactivates the workflow (deactivate,
   not delete). Sessions never touch an n8n workflow.

## Plan

Each step has a switch to go back. Nothing moves to the next step until the
previous one has run clean on the test client for at least two working days.

**Step 0. Re-measure (read only).** Repeat the counts above a week after #2065
to confirm the loop is gone from every open tab, and list any outbox repairs
still pinned to `webhook` or `supabase`. Way back: nothing to undo.

**Step 1. The function, and the test client behind a switch (built
2026-10-16, live v1 since 2026-10-16 with the test client on the switch).** `supabase/functions/calendar-card-write`: the same
request and answers as `calendar-upsert`, with every guard ported line for line
from the live writer into `logic.mjs` (phantom row, comment three-way merge
through `calendar_merge_comments`, link clobber and `__CLEAR_LINK__`, duplicate
link, both urgent marker guards, stale-save conflict, `thumb_rev`, graphic tweak
baseline, the event ledger with the live role overrides and source rule). It
requires the staff key, refuses a client token for now, and checks its own
switch `calendar_card_write_clients` (`{"clients": ["<slug>"]}` or
`{"all": true}`; anything else is off). The page sends a staff save there only
when the switch lists the client and the tab has a staff identity; everything
else stays on `calendar-upsert`, and a refusal that guarantees nothing was
written (`client_not_enabled`, `switch_unreadable`) goes on to
`calendar-upsert` at once. Proof: `test/calendar-card-write-parity.js` runs both
writers' guard code on thousands of generated saves and compares every answer;
`test/calendar-card-write-routing-browser.js` drives the routing in a browser.
To start: deploy the function, then add the test client to the switch. Way
back: take the client off the switch (tabs pick it up within 30 seconds), no
deploy.

**Step 2. Staff paths for the test client.** Watch the function's log
(`fn: calendar-card-write`), the ledger and the write-refusal log for two
working days of real use on the test client, covering the eleven page callers.
Way back: the switch.
**Owner decision, 2026-10-16 (overrides the two-working-day wait for steps 1
and 2 only):** the owner asked not to wait two days and to prove the test
client with a dedicated session instead. Session Vigil Round made one full round
of real staff saves on the test client (23:14 to 23:19 UTC, every save landed
through `calendar-card-write`, no refusals), and Lighthouse then added the
owner's two own clients (23:34 UTC). Everyone else follows only after eight
clean three-hourly watcher runs that include real saves on those two clients.
The way back is unchanged: the switch.

**Step 3. Server callers and harnesses.** `caption-generate` and
`calendar-auto-posted` read the same switch and call `calendar-card-write`
(with the automation key). The sign-off reconcile script and the nightly,
morning and probe harnesses listed above move too, each proven by one run on
the test client. Way back: the switch.

**Step 4. Staff saves for everyone.** Widen the switch in two batches (five
clients, then `{"all": true}`). Watch the write-refusal log, the ledger by
source and the `calendar-upsert` log count. Way back: take clients off the
switch.

**Step 5. Client review links, last, with the fallback.** The function accepts
the link token, limited to what a link can write today (approval stamps,
comments, the one client status move). The page sends a client save to
`calendar-card-write` first; any answer other than success or a conflict sends
the same save to `calendar-upsert`, so the client never sees an error, and the
page reports each fallback to the write-refusal log as its own code so it can be
counted. Same link, same buttons, nothing visible changes. A second flag (or a
`links` field on the same row) turns this on for the test client first, then
everyone. Way back: the flag.

**Step 6. Switch off.** All of these:

- No client save has needed the fallback for 14 days.
- `calendar-upsert` has logged zero real-client calls for 14 days.
- Every scheduled caller above (sign-off reconcile, nightly, morning) has run
  at least once on the native path.
- A review page opened before the move can no longer post to it. Zero calls
  does not prove that, because a client can leave an old tab open for weeks.
  Either the page checks its own build on load and refuses to save from a stale
  copy (and that check has been live for 14 days), or every active client has
  been reissued a fresh link and confirmed, as the freeze in `AGENTS.md`
  requires.

Then download and keep the live source in `SyncView Backups/`, and deploy a
version that answers every call with a clear refusal. Way back: a restore
lane, built and rehearsed on a throwaway copy **before** this step. It deploys
the saved bundle by its hash and checks the result. The current live-delta
lane cannot do this: it only applies its own one-line change and only rolls
back inside the same run.

**Step 7. Delete.** After 14 more quiet days: delete the function, its repo
folder, the n8n URL constants, the pinned-repair branch, the live-delta lane,
its manifest row and warm-up entry, and move or retire the tests above. Way
back: the saved live source and git history.
