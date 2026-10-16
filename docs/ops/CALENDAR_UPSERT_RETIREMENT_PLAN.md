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

## Plan

Each step has a switch to go back. Nothing moves to the next step until the
previous one has run clean on the test client for at least two working days.

**Step 0. Re-measure (read only).** Repeat the counts above a week after #2065
to confirm the loop is gone from every open tab, and list any outbox repairs
still pinned to `webhook` or `supabase`. Way back: nothing to undo.

**Step 1. Build the native card patch (no switch on).** One new
`production-write` operation that writes card fields with every guard
`calendar-upsert` has today: phantom row, comment three-way merge through
`calendar_merge_comments`, link clobber and `__CLEAR_LINK__`, duplicate link,
both urgent marker guards, stale-save conflict, `thumb_rev` minting, graphic
tweak baseline and the event ledger (with the real `X-Syncview-Source`, which
the live function drops: it records every save as `ui`). A client link may only
write approval stamps, comments and the one client status move it can already
make. Proof: replay the golden client-review fixture and a recorded set of staff
saves through both writers and compare the stored rows field by field. Ships at
a Section 4 deploy (capture first). Way back: the operation is unused until
step 2, so no rollback is needed beyond the Section 4 bundle.

**Step 2. Test client, staff saves, behind a flag.** New roster flag
`calendar_card_native_clients`, read fresh at save time like
`calendar_upsert_ef_clients`. One branch inside the four send helpers sends
listed clients to the native operation; all eleven page callers follow. Turn on
for the test client only. Way back: remove the slug from the flag; live tabs
pick it up through the realtime subscription, no deploy.

**Step 3. Test client, client review link.** A second flag (or a `links`
field on the same row) so client links move separately. The native path must
accept every link clients hold today; otherwise this repeats the 2026-07-15
outage (see the freeze in `AGENTS.md`). Way back: same one-row flag change.

**Step 4. Server callers and harnesses.** `caption-generate` and
`calendar-auto-posted` read the same flag and call the native operation. The
sign-off reconcile script and the nightly, morning and probe harnesses listed
above move to the native operation too, each proven by one run on the test
client. The n8n Generate Caption workflow
stops being a caller only when `caption_generate_ef_clients` covers every client
(owner's switch) or the owner approves an edit to it. Way back: the flag.

**Step 5. Everyone.** Widen the roster in two batches (five clients, then all).
Watch the write-refusal log, the ledger by source and the `calendar-upsert` log
count. Way back: remove slugs from the roster.

**Step 6. Switch off.** Three conditions, all needed:

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

## Decisions for Lighthouse and the owner

1. Build the native card patch as one new `production-write` operation (above)
   or as a separate small function. One operation keeps one gateway; a separate
   function avoids a Section 4 capture for every fix.
2. Whether client review links move in step 3 at all, or keep `calendar-upsert`
   until every client is on a fresh link.
3. Whether the n8n Generate Caption workflow is retired by the caption switch
   or edited (needs explicit go-ahead).
