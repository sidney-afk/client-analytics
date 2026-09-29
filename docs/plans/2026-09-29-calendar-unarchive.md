# Calendar and Samples: see recently archived cards and restore one

**Status:** Decisions D1 to D6 are final (Lighthouse and the owner, 2026-09-29). Step 1
is this plan plus the static mock-up in `docs/syncview-design/mockups/calendar-unarchive/`.
**Nothing is built.** Waiting for the owner to review the mock-up, then step 2 (the build).
**Written by the session named Harbor.** Counts only, no client names or slugs (public repo).
Measured by reading the code at main `566402637b5751a71e43b80ff1c95e6ed5fb3997`. Nothing here was checked against the
live database; every "live" claim is marked as read from repo notes, or as a
measurement to take in the build.

## 1. The problem

On 2026-09-29 an SMM revived a work item in SyncLinear whose Calendar card was
archived. The item showed nowhere else, because the card stayed hidden and nothing
tells the item that its card is archived. Lighthouse restored the card by hand.
Today there is no way for staff to see or restore an archived card. The only
restore ever done was a one-column hand write (EXECUTION_LOG.md around line 1162).

Goal: in each client's Calendar, and on each client's Samples page, staff (SMMs
and admins) open the toolbar **More** menu, choose **Archived cards** (Samples:
**Archived samples**), see the recent ones, and restore one, with the card and its
work items put back exactly as they were.

## 2. What archiving does today (the facts a restore must respect)

| Piece | What happens on archive | Source |
|---|---|---|
| Card status | Browser sends only `{id, status: 'Archived'}` to `calendar-upsert` (a minimal write that deliberately skips the normal card-save path, which would recompute the status). Nothing else on the row changes. | `_calArchiveOne`, `180-calendar-native-post-media.js.part:994-1058` |
| Which endpoint | `calendar-upsert` Edge Function for clients on the function route, otherwise the n8n webhook. Chosen by `_calUpsertUrlForClient`. Not `production-write`. | `120-calendar-flags-write-repair.js.part:455` |
| Previous status | Not stored on the card. Recorded in two places: `calendar_post_events` (an `archive` row with `from_status`, overall status only, written best-effort after the reply, browser-readable) and `card_change_journal` (full `row_before`/`row_after`, exact, but readable by the service role only). The n8n route may not write the event at all (not read). | `calendar-upsert/index.ts:481`, `2026-09-05-card-change-journal.sql` |
| Component statuses | `video_status`, `graphic_status`, `caption_status`, links and both `*_deliverable_id` columns are untouched. The overall status is derived from them, and the page recomputes it on load. | `130-calendar-model-cache.js.part`, `STATE_OF_THINGS.md` |
| Open video and graphic work items | Parked in Backlog by the **browser**, after the archive write, through `production-write` `status`. Best-effort: a failed park never fails the archive. No server-side parking exists. | `_calArchiveParkSubIssues`, `180:1067-1104`; #1835 |
| Prior state of a parked item | No dedicated field. Only `deliverable_events` (`from_status`, `to_status='backlog'`, `payload.surface='calendar'`, browser-readable) and the journal. | OPEN_REPAIRS 226, 284, 285 |
| Workload | **Nothing hides a work item because its card is archived.** Workload and Production read the item's own markers only. Parking in Backlog is the only mechanism, and Backlog is kept off Workload for real clients (owner ruling 2026-08-23). This corrects the assumption in the request. | `067-workload-board-source.js.part:834-938, 2225` |
| The status bridge | The trigger that copies a work item's status onto its card **skips archived cards**, so a revived item never reaches its card. This is the 2026-09-29 mechanism as far as the code shows. Not reproduced. | `2026-09-18-native-calendar-status-bridge.sql:278` |
| Refused actions while archived | Filling a component (`component_fill_card_archived`, the message says "un-archive it first") and native intake reconcile (`card_archived`). | `2026-08-31-production-component-fill.sql:231` |
| Client view | Same filtered read as staff, so an archived card is absent. The client Sheet also shows only cards whose components are all Approved, Scheduled or Posted (`_calIsClientReady`). No separate client count of archived cards exists. | `150:1037`, `160` |
| Order | Archive does not touch `order_index` or the date. Gaps are tolerated. New cards take `max(live order_index) + 1`, so an archived card can later share its slot with a live card. Ties resolve nondeterministically on reload. | `180:2055-2103`, `160:2170` |
| Local ledger | The archiving browser also keeps a per-client localStorage list (`syncview_cal_archived_v1_<slug>`) that hides the card for up to 24 hours (a 60 second trust window). It must be cleared on restore or the card stays hidden in that browser. | `134-calendar-prefs-mount.js.part:83-205` |
| Samples | Separate table (`sample_reviews`), separate function (`sample-review-upsert`, frozen), own kebab, own ledger, same Backlog park (#1835). The Calendar More menu does not appear there. | `270-samples-model.js.part` |
| Who can archive | Browser only: the button is hidden and the function returns early on a client link. **The live `calendar-upsert` and `sample-review-upsert` are the owner's un-gated builds** (v43 and v49) and cannot tell staff from a client link. So "staff only" is a browser rule today, for archive and for any restore that goes through the same function. | AGENTS.md freeze note; `calendar-upsert/index.ts:8-24` |
| Volume | About 12,993 archived Calendar posts and 7,652 archived samples across all clients (OPEN_REPAIRS 284). Per client and per window queries are a must. |  |

## 3. Behavior (exact)

### 3.1 Entry point


- New item **Archived cards** in the Calendar toolbar More menu (`kebabHtml` in
  `160-calendar-organize-ui.js.part:333-351`), after Import, under its own divider.
  On the Samples page the menu (`sxrKebabMenu`, `270-samples-model.js.part`, today
  only "Share with client") gets **Archived samples**, under its own divider.
- Shown only when a client is open, the page is not a client link, and
  `_syncviewStaffCan('restore-archived')` is true. That new capability maps to roles
  **admin and smm only** (Decision D6). Creative seats (editor and designer) and
  client links never see it. Reason: restoring changes what the client and Kasper see.
- The opener and every function behind it return early on `_isClientLink` and when
  `_syncviewStaffIdentityValid()` is false, exactly like archive does.

### 3.2 The list

- A modal (same pattern as the Caption prompt modal, `#calPromptOverlay`).
- Read: the same public-key REST read the Calendar already uses, one call for this
  client only, paged by a **cursor** (the last row shown), never by widening a
  limit: `calendar_posts?client=eq.<slug>&status=eq.Archived&updated_at=gte.<floor>&order=updated_at.desc,id.desc&limit=26`,
  and for every page after the first, add
  `&or=(updated_at.lt.<last.updated_at>,and(updated_at.eq.<last.updated_at>,id.lt.<last.id>))`.
  The 26th row only tells the modal whether "Show older" is needed.
  No new privilege and no write. One helper, `_calRestoreListFetch`, so it is the only
  place to change when #1691 phases 1 and 2 close public reads.
- **"Recently" = archived in the last 30 days**, newest first, 25 per page.
  "Show older" continues from the cursor. When the current floor is exhausted, it
  moves the floor back 30 days (60, then 90) and keeps the same cursor, so no row is
  skipped or repeated, however many cards were archived in the first 30 days. It
  stops at 90 days. Why 30: the
  rollback and event data that a restore leans on (journal target 90 days, events
  best-effort) is freshest there, and it keeps the query small against about 13k
  archived rows. The archive time shown is the `archive` event `ts` when one exists,
  else the row's `updated_at`. Ordering uses `updated_at`, which the archive write
  bumps.
- Each row: card name, scheduled date, component statuses in words, who archived it
  and when (from the event, else "unknown"), and a **Restore** button. No bulk
  restore in v1 (one at a time keeps the confirm honest).
- Empty state: "Nothing archived in the last 30 days." with the Show older button.
- Read failure: inline message and a retry button. Never a blank modal.

### 3.3 Restore, step by step

1. **Confirm dialog** (`showConfirm`) naming the card, its scheduled date (flagged if
   it is in the past), the status it will return to, whether the client will see it
   again, and the work items it will move (3.4). Two buttons: **Restore** and Cancel.
2. **Fresh re-read of the one row.** If it is no longer `Archived` (someone else
   restored it), stop with "Already restored" and refresh the list. No write.
3. **Duplicate check (Decision D5).** If a live card in this client already holds the
   same video or graphic work item id, or the same Linear link, block the restore and
   **name that live card** in the message ("A live card, “<name>”, already uses the
   video work item of “<this card>”. Unlink it there first, then restore this one.").
   Two cards driving one work item is worse than a refused restore. Nothing is written.
4. **Compute the status.** Use the same overall-status function the page applies on
   load, over the row's component statuses. If none are set, use `In Progress`.
   Cross-check with the archive event's `from_status`; a mismatch is not an error
   (statuses move after the event), but is written to the diagnostics queue as
   `restore_status_differs` so we can see how often.
5. **Write** `{ id, status }` and nothing else through `_calUpsertFetch`, the same
   helper and route as archive. No `_calFlushCardSave`, no comments, no order field.
   On `!json.ok` or a network failure: keep the card in the list, show the real
   reason, log it (section 5), change nothing else.
6. **Ledger and view.** Call `_calArchivedRemove(slug, [refs])`, drop the row from
   the modal, then reload the Calendar (not just insert locally) so the card lands
   with server truth.
7. **Position.** Keep the old `order_index` if no live card in that client shares it.
   If one does, send the restored card through the existing `calendar-reorder` path
   with `max(live) + 1`, so it appears at the end instead of tied. The original date
   is kept.
8. **Work items** (3.4), only after step 5 succeeded and the card is live (the
   status bridge skips archived cards).
9. Success message ("Restored", "<name> is back in the Calendar.") with one line per
   work item: "moved back to SMM approval", "moved to To do", "stays Done", "left
   alone, it moved since", or "not moved: someone else changed it first, their change
   was kept".

### 3.4 Video and graphic work items (Decision D2, final)

Restore puts everything back **exactly as it was**. There are no checkboxes. The
confirm dialog lists each linked work item and where it will go. Calendar cards have
a video and a graphic item; Samples have a video and a thumbnail item.

What the archive left alone and restore therefore leaves alone: the caption, links,
component statuses, dates, comments and approvals. The overall status is recomputed
from the component statuses, as on page load (the Calendar rule is the one at
`170-calendar-links-status.js.part:634`; the Samples counterpart is located in the
first build step).

For each linked work item, read its current status (`production_deliverables_browser_v1`)
and its `deliverable_events`, then apply the **first rule that fits**:

| # | Situation | Result | Dialog wording |
|---|---|---|---|
| 1 | Item is finished now (done, posted, canceled). The archive never parks a finished item. | Leave it. | "stays Done" |
| 2 | Item is in Backlog, and its latest move into Backlog is the archive's own park: an event with `to_status=backlog` and `payload.surface` `calendar` (Samples: `sxr`), at or after the archive time (the card's `archive` event `ts`, else its `updated_at`), and nothing later. That event's `from_status` was an ordinary status. | Move it to exactly that `from_status` (`todo`, `in_progress`, `smm_approval`, `client_approval` and so on). | "back to SMM approval" |
| 3 | As rule 2, but the event's `from_status` was `backlog`: it was already in Backlog before the archive. | Move it to To do. | "to To do" |
| 4 | Item is in Backlog, but its latest move into Backlog is not the archive's park (a person moved it there later, or another surface did). | Leave it. | "left alone, it moved since" |
| 5 | Item is in Backlog and there is no readable park event at all (assumption A1). | Leave it. | "left alone, no record of where it was" |
| 6 | Item is in any other open status, or was archived or removed itself. Someone moved it after the archive. | Leave it. | "left alone, it moved since" |

Mechanics:

- The move goes through the existing guarded `production-write` `status` operation
  (Calendar: `_calPushStatusToLinear`; Samples: `_sxrPushStatusToLinear`) with
  `expected_status='backlog'` and the item's `expected_updated_at`. On `write_conflict`
  the other person's change is kept and the message says so. **A failed or conflicted
  move never undoes the card restore.**
- Order: card first, then items (the status bridge skips archived cards, so the card
  must be live first). The bridge then re-derives the card status from the items; the
  Calendar is reloaded afterwards so the person sees the final truth.
- The card repair carried by an item move must be built from the **restored** card,
  not the pre-archive row, to avoid the OPEN_REPAIRS 284 caveat where a replay writes
  an old overall status back. (The Samples archive deliberately stamps the card as
  Archived on its park write; the restore move must stamp it as live.)

**OPEN QUESTION OQ1, needs the owner's answer before the build moves any item into
`smm_approval` or `tweak`.** The database trigger
`production_notification_status_intent_after`
(`migrations/2026-09-09-native-notification-outbox.sql:229-285`) queues a message to the
client's channel whenever staff move an item into `smm_approval` or `tweak` from the
UI (`source='ui'`, `action='status_change'`, staff caller, not a test client). Rule 2
with `from_status=smm_approval` (or `tweak`) would therefore send the client a second
"ready for SMM approval" ("needs tweaks") message. The instruction is to stop and report
if a restore sends any client or Kasper notification, so I am reporting it now:

- (a) Accept the message.
- (b) Put those items back but silence the message. That needs a change to
  `production-write` (or its shared code) and so the sealed capture and an owner deploy.
- (c) Leave those two kinds of item in Backlog and say "left in Backlog so the client
  is not told again" in the dialog. **My recommendation.** No deploy, no message.

Every other target (`todo`, `in_progress`, `client_approval`) is not announced by that
trigger; a Postgres test proves it (section 7) before the build relies on it. The
other trigger that mentions Kasper, `syncview_kasper_urgent_ping_ledger`, only writes
a ledger row when a ping marker appears on the card; a restore never sets one, and a
test asserts that. A restored card at Kasper Approval does reappear in Kasper's queue
(a view, not a message), and the dialog says so. In the 2026-09-28 park run, 14 of 46
parked items came from `smm_approval`, so this is a common case.

Not restored: Linear (cancelled), and nothing else needs restoring (comments and
approvals are never deleted by archive; see 4.5).

### 3.5 The client's own view

- A restored card reappears in a client link only if it passes the existing
  `_calIsClientReady` rule (all components Approved, Scheduled or Posted, or
  collaborative mode). No new client code. **The client approve and request-changes
  paths are not touched**, and a test asserts the restore code references neither.
- A client tab that is already open picks the card up on its next poll or realtime
  reload (up to about a minute, same as archive in reverse).

### 3.6 Samples (Decision D4: in this PR, same logic)

Samples are archived by `archiveSxrCard` / `_sxrArchiveOne` (`270-samples-model.js.part:2748-2790`),
which sends `{id, status: 'Archived', updated_at}` through `sample-review-upsert`
(frozen, untouched) and then parks the sample's video and thumbnail work items in
Backlog with the card stamped Archived. Restore mirrors the Calendar design:

- **Menu:** **Archived samples** in the Samples page's own menu, same gate as 3.1.
- **List:** `sample_reviews` (`SXR_TABLE`) with `status=eq.Archived`, same cursor,
  30 days and Show older to 90, through one helper `_sxrRestoreListFetch`. Samples have
  no dates, so the row shows only who archived it, when, and the current statuses.
- **Write:** the same shape archive uses, `{client, sample:{id, status, updated_at},
  comments_base_at: ''}` through `_sxrUpsertFetch(..., 'ui')`, where `status` is the
  recomputed overall status (never `Archived`). No other field is sent.
- **Ledger:** `_sxrArchivedRemove` (the Samples ledger, `syncview_sxr_archived_v1_<slug>`).
- **Position:** `order_index` tie handling through `sample-review-reorder`, as in 3.3 step 7.
- **Work items:** rules 1 to 6 above, with `payload.surface` `sxr` (the park passes
  `surface: 'sxr'`, `270:1743`; confirmed against a real park event in the build) and
  `_sxrPushStatusToLinear`.
- **Block (D5):** a live sample in the same client using the same work item blocks the
  restore and is named in the message.
- **Untouched:** the Samples client approve and request-changes paths.

## 4. Edge cases and how each is prevented

| # | What could go wrong | Prevention |
|---|---|---|
| 4.1 | Two staff restore the same card | Fresh re-read before the write (3.3 step 2). The write itself is idempotent. Second person sees "Already restored". Residual: both pass the re-read in the same second and both write the same status. Harmless. |
| 4.2 | One restores while another edits | An archived card cannot be opened for editing, so the only edits in flight are on other cards. A stale tab that still holds the card as live and edits it after someone else archived it is the existing archive race, unchanged. After restore, the reload replaces any stale copy. |
| 4.3 | One restores while another **archives the same card again** | Last write wins; no CAS exists on this frozen writer (the browser disables the field guard on v2). Outcome is one of two valid states and the list refreshes. Documented, not preventable without changing the frozen writer or adding a function (D1). |
| 4.4 | Restored card comes back in a status nobody chose | Status is derived from components (same code as page load), shown in the confirm dialog before the write, and never `Archived`. |
| 4.5 | Stale approvals: a card archived at Client Approval returns to the client queue with old `client_*_approved_at` or `kasper_approved_at` values | Left as they were (they describe real past actions). Confirm dialog shows the returned status and "the client will see this card again" when `_calIsClientReady` is true. The card write itself is not a notification event (the trigger only fires on work item status events). Item moves into `smm_approval` or `tweak` are announced to the client: see OQ1 in 3.4. Because that trigger skips test clients, a test client run cannot prove "no message sent"; a Postgres test does (section 7). |
| 4.6 | Restored card is tied with a live card on `order_index`, or lands in the past | Tie: end of list via `calendar-reorder` (3.3 step 7). Past date: flagged in the confirm dialog, date kept. |
| 4.7 | Two cards (or two samples) claim one work item | Blocked by the duplicate check (3.3 step 3, D5); the live card is named in the message. |
| 4.8 | Restore undoes a person's own Backlog decision, or moves an item somebody moved since | Rules 4 to 6 in 3.4 leave those items alone and say so. |
| 4.9 | Work item move fails or conflicts | Card stays restored; per-item message; nothing rolled back. The item is exactly where it was, i.e. the state today. |
| 4.10 | The status bridge rewrites the card status after the item move | Expected and correct (it derives from the item). The card is reloaded after step 8 so the person sees final truth. |
| 4.11 | Local ledger keeps the card hidden in the restoring browser | `_calArchivedRemove` (3.3 step 6); test covers a ledger entry younger than 60 seconds. Other browsers drop the ref once they see a live row (`_calCleanArchiveLedger`). |
| 4.12 | A client link reaches restore | Menu absent, opener and write functions return early on `_isClientLink`, capability check fails (admin and smm only, D6). **Server side cannot enforce it** on the live un-gated `calendar-upsert` (same as archive today). Not made worse. Decision D1: the writers stay frozen and unedited. |
| 4.13 | The n8n route (clients not on the function route) does not log the event | Archive time falls back to `updated_at`, "archived by" shows "unknown". Restore write works the same because archive already uses `{id, status}` there. n8n is not edited. |
| 4.14 | Public-key reads of `calendar_posts` and `calendar_post_events` are closed later (#1691 phases 1 and 2, `migrations/2026-09-26-scoped-read-policies.sql`, not applied) | All reads sit behind `_calRestoreListFetch` and `_calRestoreEventsFetch`; a test asserts no other read of these in the new code. The modal then fails with the inline retry message, not silently. |
| 4.15 | 13k archived rows make the read slow | Per-client, date-windowed, limit 26. Phase 2 measures the query time on the largest client and adds an index request to Lighthouse if it exceeds one second (no migration in this PR unless measured). |
| 4.16 | Card is restored but the list still shows it | Row is removed on success and the list re-read on reopen. |
| 4.17 | Restore succeeds, but the archived-then-revived work item case from 2026-09-29 is not prevented | Correct: prevention (a warning when someone moves an item whose card is archived) is a different change, in `production-write`, which needs the F27 capture deploy. Follow-up recommended (section 8), not in this PR. |
| 4.18 | A refusal is invisible | Section 5. |

## 5. Write path and logging

- **Card write (D1):** `calendar-upsert` (or the n8n webhook, whichever archive already
  uses for that client), payload `{client, post:{id, status}}`, same headers from
  `_calUpsertHeaders`. **Samples:** the existing `sample-review-upsert` route through
  `_sxrUpsertFetch`. **No Edge Function change, no migration, no deploy, no
  fingerprint or pin change.** The frozen writers (`calendar-upsert`,
  `sample-review-upsert`) are not edited or re-gated, and a test asserts
  `supabase/functions` has no diff.
- **Order tie fix:** existing `calendar-reorder` (Samples: `sample-review-reorder`), unchanged.
- **Work items:** existing `production-write` `status` operation via the existing
  push helper. No browser table writes anywhere: a source test fails if the new code
  contains a `PATCH`, `POST` or `DELETE` to `/rest/v1/`.
- **Reads:** public-key REST, read only (3.2, 3.4).
- **Refusal logging:** every failed restore write and every refused item move calls
  `_writeUiRecordFailure('calendar', 'status', error, { kind: 'restore', ... })` (Samples: surface `sxr`).
  The operation name `status` is reused on purpose: a new name such as `restore`
  would fall into `other` unless `_shared/write-refusal-diagnostics.mjs` changed, and
  that file is in the `production-write` closure, so it would force a sealed capture
  and owner-run deploy for no user benefit. The context `kind:'restore'` is enough to
  tell them apart. No new refusal code is introduced; a test checks every code used
  already has a sentence in `WRITE_UI_FAILURE_CODE_TEXT`. Loud errors also show the
  existing notice, as the archive path does.
- The journal (`card_change_journal`) and `calendar_post_events` record the restore
  automatically (`status_change`, from `Archived`); nothing to add.

## 6. Decisions (final, 2026-09-29) and what is still open

| # | Decision | How this plan applies it |
|---|---|---|
| D1 | Use the existing `calendar-upsert` route, and for Samples the existing `sample-review-upsert` route. No new function, no deploy. Both writers stay frozen and unedited. | Section 5. A test asserts `supabase/functions` has no diff. |
| D2 | Restore puts everything back exactly as it was; each work item goes back to its exact prior status; no checkboxes; the dialog lists each item and where it goes; guarded moves; a conflict keeps the other person's change; a failed move never undoes the card restore. | 3.4, rules 1 to 6. |
| D3 | "Recently" is the last 30 days, Show older up to 90. | 3.2. |
| D4 | Samples are in this PR, same logic, from the Samples page's own menu, clearing the Samples ledger. | 3.6. |
| D5 | Block the restore when a live card already uses the same video or graphic work item, and name that card. | 3.3 step 3, 3.6. |
| D6 | Only admin and SMM roles can restore. Never creative seats, never client links. | 3.1. |
| OQ1 | Moving an item back into `smm_approval` or `tweak` makes the database message the client. | 3.4. **Open. The build does not move those items until the owner answers.** |
| A1 | An item in Backlog with no readable park event is left alone ("left alone, no record of where it was") rather than guessed. | 3.4 rule 5. Assumption, not a decision. |

## 7. Tests (step 2)

**Unit tests** (`test/calendar-unarchive.js`, registered in
`test/suite-classification.json`; pure helpers extracted so no browser is needed):
- restored status from component statuses (all Approved, mixed, none set, an
  unknown name) and never `Archived`, for Calendar and for Samples;
- cursor paging: 60 archived rows inside the first 30 days page through with no
  repeats or skips, including rows that share one `updated_at`; the floor widens only
  when the window is exhausted; paging stops at 90 days;
- work item outcome, one case per rule 1 to 6 in 3.4 (Calendar surface `calendar`,
  Samples surface `sxr`), including `from_status` of each ordinary status, a later
  person move into Backlog, and a missing event;
- `order_index` tie detection and end-of-list value;
- duplicate link detection (work item id, Linear link, none);
- capability map: admin and smm true, creative false, client and unverified false.

**Source-shape tests** (same file or `calendar-unarchive-source.js`):
- no `/rest/v1/` write method in the new code; only the three named write endpoints;
- opener and writers contain the `_isClientLink` and identity guards;
- the new code references neither the client approve nor the request-changes
  functions (Calendar or Samples), and no file under `supabase/functions` changed;
- every refusal code used has a message sentence (`write-ui-failure-messages` rule).

**Postgres test** (`test/calendar-unarchive-notifications-postgres.js`, Postgres
profile, next to the other trigger tests): replays a restore move into each
target status against the notification trigger and asserts `todo`, `in_progress` and
`client_approval` create no `production_notification_intents` row while `smm_approval`
and `tweak` do (documenting OQ1); after the owner answers OQ1, it also asserts the
chosen behaviour. It also asserts a restore never sets the Kasper ping marker.

**Mocked browser test:** new phase `CAL_RESTORE` added to `PHASES` in
`docs/syncview-design/tests/prod-write-gateway-browser.js`, same mocking as the
archive cases there (`calendarWrites`, `writes`); a matching `SXR_RESTORE` phase (or a sibling
file with the same mocks if the Samples page cannot be driven from this harness) covers
Samples. Cases: menu absent on a client
link and for creative; menu present for admin and smm; list shows only archived rows
from the last 30 days, newest first; Show older; empty state; read failure and retry;
confirm text (status, past date, client-visible line); cancel writes nothing;
Restore sends exactly one `calendar-upsert` (Samples: `sample-review-upsert`) body `{id, status}` with a non-Archived
status; ledger cleared and card back after reload; already-restored race (re-read
returns live row, zero writes); duplicate link blocked, zero writes; write failure
keeps the row and logs one refusal; work item moves sent with expected values;
conflict on an item keeps the card restored; every rule 1 to 6 outcome shows the right
line in the dialog; tie sends one `calendar-reorder`.
The exit line of each suite is quoted verbatim in my report. The whole file must pass, as must `prod-boot-budget.js`, `npm run build:index`,
`npm run check:index`, `repo-map-sync`, and
`node scripts/repo-identity-exposure-check.js --diff="origin/main"` after committing.

**Real browser, test client only** (uses `qa/master.js` scaffolding, unique card ids,
archive on exit, Linear mocked): create a card with a video and a graphic item, set
component statuses, archive it, confirm it is parked, open the list, restore,
confirm card status, position, items back to their exact prior status, ledger, client
link view of it, and that no notification fired. The same round trip for a sample. Then the negative paths: restore from a second
tab (already restored), duplicate link, item moved by hand before restore. Also
**reproduce the 2026-09-29 sequence** (revive an item under an archived card) to
confirm the mechanism in section 2. Add the archive-then-restore round trip to
`qa/probes/nightly-manifest.txt`. If this sandbox's browser cannot reach the live
backend through its proxy (docs say it may not), I will say so plainly and give
Lighthouse the exact command to run rather than report a pass.

**Measurements to take before shipping:** archived-list query time on the largest
client; count of archived cards in the 30 day window per client (counts only);
how many parked items came from each status (counts only), so the dialog wording is accurate. Notification safety is proven by the Postgres test in section 7, not the test client, because the trigger skips test clients.

**Before and after screenshots:** Calendar More menu, the list, the confirm dialog,
the restored card, and the work items back, each before and after, from the test
client.

**Mock-up:** `docs/syncview-design/mockups/calendar-unarchive/index.html` (static, the
app's own styles) with one picture per screen in `screens/`: the More menu item, the
list, its empty and error states, the two confirm variants, the success messages and
the blocked message, for Calendar and for Samples. The build must match it, and the
owner reviews it before step 2 starts.

## 8. Not in this PR (recorded so it is not lost)

- A warning or refusal when someone moves a work item whose card is archived
  (the actual cause of 2026-09-29). Lives in `production-write`; needs the sealed
  capture and owner deploy.
- A server-side staff check and compare-and-set on `calendar-upsert` and
  `sample-review-upsert` (frozen writers; needs the owner's explicit approval).
- Bulk restore.

## 9. Delivery

One branch, one PR. Step 1 (this plan and the mock-up) is done when the owner has
reviewed the mock-up. Step 2, only after the owner's yes: build in the same PR. Edit
`src/index/` fragments (never `index.html`), `npm run build:index`, append an
`OPEN_REPAIRS.md` entry (next number, checking for duplicate headers after any merge),
update `STATE_OF_THINGS.md` and `REPO_MAP.md`, address any Codex findings on the PR,
and stop and report if a restore or work item move sends any client or Kasper
notification. Lighthouse merges. No merge, deploy or dispatch is part of my work.
