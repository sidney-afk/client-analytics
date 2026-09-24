# Card ⇄ sub-issue rename: plan (phase 1 of 3)

Status: **plan only.** No code, no migration, no deploy. Written 2026-09-23 against
`origin/main` at `916843ec`. Builds on OPEN_REPAIRS entry 234 (2026-09-22). Every
database figure below comes from a read-only query run on 2026-09-23. They are
counts only.

**What the owner asked for (supersedes entry 234's "keep it loose"):**

1. Renaming a card renames its linked sub-issues. Renaming a sub-issue renames its
   card. This applies in both directions, every time.
2. **No backfill.** An existing mismatch stays until someone renames one side. That
   rename then overwrites the other side.
3. Nothing may break. A rename must never block, delay or roll back any other
   save, and approve and request-changes most of all.

**The plan in one paragraph.** Sub-issue titles keep their `Video N — ` /
`Thumbnail N — ` prefix, because the number is data. Only the part after the
dash is the shared name. Propagation runs on the server, asynchronously, through
a small outbox:

- A card save or a sub-issue title save only *records* that the name changed.
  Recording cannot fail the save.
- A separate drain step applies the name to the counterpart, retries on failure
  and logs what happened.
- Loops are prevented by an equality no-op plus an origin marker.

This splits into two releases:

- **Card → sub-issue** needs only a SQL migration. It can ship first and needs no
  Edge Function deploy.
- **Sub-issue → card** needs a new `title` operation in `production-write`, which
  means a gated Section 4 deploy with sealed-bundle capture.

---

## Entry 234 re-verified against current main

| Entry 234 said | Now |
|---|---|
| `policy.mjs:1461-1463` maxOrdinal parse | Holds, moved by one line: parse at `supabase/functions/production-write/policy.mjs:1462`, max at `:1463`. An out-of-format title still adds 0. |
| `policy.mjs:1478` `intake_id_conflict` | Moved: throws at `:1474` and `:1487`. The ordinal parse is at `:1479`. Behaviour is unchanged. |
| `…intake-append-v8.sql:404` full-title replay compare | Still at `:404`, but **v8's function has been replaced** by `migrations/2026-09-07-native-intake-named-append.sql`. There the replay compare is at `:259`, the ordinal regexes are at `:285`/`:289`, and the named-title check is at `:322-332`. The raised code is `idempotent_result_missing`, not `intake_id_conflict`. |
| `_shared/b4-write.ts:298-303` `gateway_required` | Unchanged: `:302` checks service role and `:303` returns 403. |
| `deliverable-write` has `operation:"title"` | True (`b4-write.ts:16,33,283`), but it validates nothing beyond a field whitelist and a trim. It is service-role only, so the browser cannot use it. |
| `production-write` has no title op | Confirmed: `policy.mjs:5-18` OPERATIONS has no `title`. **Today a sub-issue cannot be renamed from SyncLinear at all**; the only title input is on create (`220-production-attribution-views.js.part:2573`). |
| `160-calendar-organize-ui.js.part:2490-2495` client rename | Holds. The input is at `:2518`, the browser gate is `_calClientFieldEditBlocked()` at `170-calendar-links-status.js.part:964`, and **no server-side Collab check was found in `calendar-upsert`**. |
| "three" `/rest/v1/deliverables?select=` sites | There are **four**: `120-…:1078`, `150-…:102`, `290-samples-writes-review.js.part:432`, and `160-…:2331` (`_calFillLookupExisting`). |
| `150-…:563-572`, `:884-900` title matching | **Stale line numbers.** The matching is now at `150-calendar-hydration-import.js.part:388-397`, `:688-697` and `:706-722` (`_calBulkLinkNormName`). They are still Linear-era import paths. |
| `220-…:1138-1140` sorts children by title | Unchanged (`_prodChildOrder`). |

---

## A. Inventory: every place a name or title goes, and what a rename does to it

Two columns hold the names:

- The card name is `calendar_posts.name`. For Samples it is `sample_reviews.name`.
- The sub-issue title is `deliverables.title`, which is NOT NULL
  (`migrations/2026-07-06-b1-linear-data-model.sql:37`).

**The card name is also the card's reviewed "title" component**, with its own
`title_status`, `title_tweaks` and `client_title_approved_at`
(`supabase/functions/calendar-upsert/index.ts:58`).

### A1. Places that compare or match by title text (the dangerous ones)

| Where | What it does | After a rename | Plan |
|---|---|---|---|
| `production-write/policy.mjs:1452-1487` | Next ordinal = max parsed `N` in the batch | Safe only if the prefix is kept | Name-part-only edit (section B) |
| `migrations/2026-09-07-native-intake-named-append.sql:285,289` (v8 `:434,:438`) | The SQL version of the same max-ordinal logic | Same | Same |
| `…named-append.sql:259`; v8 `:404` | Replay compares the **full title** | A rename between an append and its retry fails the retry | Drain defers deliverables with an unsettled intake (E3) |
| `production-write/index.ts:6829,6854`; `migrations/2026-07-23-f203-production-issue-create.sql:103-104,327` | Create/replay compares the title | Same hazard | Same deferral |
| `production-write/index.ts:7002-7043` (`componentFillTitle`, `policy.mjs:128`) | Filling the missing half copies the sibling's title | Inherits whatever the sibling says now | Correct, since both siblings are kept in step (C) |
| `migrations/2026-09-06-native-card-materialization-boundary.sql:248`; `2026-09-07-legacy-intake-native-triage.sql:226` | Expected card name = video title, falling back to graphic title | A re-check after a rename sees a difference and holds a conflict | Check whether these still run on existing cards. If they do, compare on the name part, or skip `name` in the check (build step 0) |
| `linear-outbound/mapping.mjs:626`; `linear-inbound/index.ts:815,985`; `supabase/migrations/20260913*` confirmers | Sends titles to Linear and confirms them by title equality; inbound writes `title` back | A second rename in flight can look like a mismatch; there is a loop risk (card → deliverable → Linear → deliverable) | The drain writes the title the same way a staff edit does. The equality no-op stops the echo. If Linear is still mirrored at build time, the outbound confirmer must accept "superseded by a newer title" |
| `170-calendar-links-status.js.part:2141-2145` (`CAL_NATIVE_ORDINAL_RE`) | Browser preview of the next number | Correct only if the prefix is kept | Shared rule (B) |
| `180-calendar-native-post-media.js.part:751-755` | Creation check `endsWith(' — ' + name)` | Creation only | None |
| `150-…:388-397,688-697,706-722` | Linear import and bulk-link pair by title text | A wrong or missing auto-match | Expires with the Linear exit. Leave it alone |

### A2. Writers

| Where | Writes | After the feature |
|---|---|---|
| `calendar-upsert/index.ts:51,67,72` (via `170-…:965/984` → `_calFlushCardSave` `:1040` → `120-…:2749`) | Card name | **Unchanged code.** A DB trigger records the change (section G) |
| `sample-review-upsert/index.ts:51,60`; `270-samples-model.js.part:1788` | Sample card name | Same trigger pattern on `sample_reviews`, if Samples are in scope (owner decision 5) |
| `b4-write.ts:283` (`deliverable-write`, service role) | Deliverable title | Unused by the browser |
| **New** `production-write` op `title` | Deliverable title, name part only | Sub-issue rename entry point |
| `linear-inbound/index.ts:815` | Deliverable title from Linear | Recommended: does NOT propagate — the trigger skips writes tagged as Linear-inbound (decision 6) |
| Creation paths (`production-write/index.ts:4223-4439,7258-7268,7575-7614`; `150-…:539,1381`; the materialization SQL) | Initial copy | Unaffected |

### A3. Snapshots and ledgers: these keep the old text, by design

- **Notification outbox bodies.** `migrations/2026-09-09-native-notification-outbox.sql:269-270,330,392,514` and `2026-09-18-notification-creative-channel.sql:91-92,147,199` build the text when the notification is created. Queued and already-sent messages keep the old title. Acceptable.
- **Urgent Kasper Slack ping.** `n8n-backups/send-urgent-kasper-slack.2026-09-10.published.json` (read only; `b.name || b.postName`), sent from `140-…:2766,2794,2839` and `270-…:2438,2475`. It uses the name at click time. Acceptable.
- **Card change journal** (`migrations/2026-09-05-card-change-journal.sql:42-139`) and the `deliverable_events` / `calendar_post_events` payloads. These keep before and after values, which is where the audit trail of a rename lives. The drain adds its own `deliverable_events` / `calendar_post_events` row with `origin: rename_propagation`.
- **Linear-era snapshots** (`mirror_outbox.payload`, `linear_archive.title`, `workload_issues.title`). Stale by design.
- **Workload snapshot cache (PR #1511).** Not on main (`origin/claude/loom-workload-snapshot-cache`, migration `2026-09-23-workload-native-snapshot-cache.sql:67-72`). Its triggers watch `deliverables`, so a propagated title rebuilds the cache. It does not watch `calendar_posts`, which is fine because Workload never shows card names. **Rule for whichever lands second:** the propagated write must be a real `UPDATE deliverables` so those triggers fire.
- **Browser caches.** The last-good Workload board (`070-workload-source.js.part:59,80-99`, #1508) and the calendar localStorage (`150-…:25,1463`) show the old title until the next live load. The fingerprint at `070-…:233-237` includes the title, so the board repaints.

### A4. Read-only display, search and sort (update on the next fetch)

| Surface | Where | Effect |
|---|---|---|
| Workload | `migrations/2026-09-02-workload-native-view.sql:168`; search `080-workload-render.js.part:408`; display `080-…:1888,2792,2878-2922`, `090-…:755,825` | Shows the new title and finds it by the new text. Parent rows use `batches.name`, which is out of scope |
| SyncLinear | `220-…:1138` (sort), `:1678`; `260-production-refresh-boot.js.part:702,747,870,913` | **The row can move** because of the title sort. Keep the open row in place until the list closes (H2) |
| Calendar and client views | `190-calendar-approval-comments.js.part:172,264,513,1276,1794,1978`; `160-…:97`; `150-…:2533,2548` | `:1794` decides whether a card has a title to review (name not empty) |
| Samples | `270-…:1462,1497,2047`; `280-…:799,848,1837`; `290-…:1168,1372` | Display only |
| Kasper review | `320-kasper-dashboard-replies.js.part:2719`; `330-kasper-review-history.js.part:573,788,979,1168` | Display only; history is a snapshot |
| Submit form | `220-…:2573,2667`; `230-…:146` | Creation only |
| Batch picker | `170-…:2017,2573-2576` | Batch name, out of scope |
| SQL read views | `2026-07-25-slice5-production-read-path.sql:86`, `2026-09-09-native-attribution-browser-projection.sql:22`, and others | Pass-through |

### A5. Tests that assert titles today

- `test/intake-post-names.js`, `test/title-review-lifecycle.js`, `test/component-fill-gateway.js`, `test/create-post-picker.js`, `test/cal-review-needs-content.js`, `test/kasper-approval-urgent-ping.js`, `test/client-signoff-reconcile.js`
- The `test/workload-native-*` family and `test/calendar-upsert-edge-source.js`
- `docs/syncview-design/tests/prod-structure-subset.js:453`, `workload-board-browser.js`, `workload-render-browser.js`
- `qa/probes/p09,p15,p47,p71`

None should change behaviour. All must still pass.

---

## B. The name rule

**Today there are three copies, and they already disagree on edges:**

| | Server `policy.mjs` | SQL `named-append.sql:285` | Browser `170-…` |
|---|---|---|---|
| Separator | `" — "` (`:90`) | literal ` — ` | `' — '` (`:2084`) |
| Pattern | `^(?:Sample )?(Video\|Thumbnail) ([1-9][0-9]*)(?: — (.+))?$` (`:99-101`) | `^(?:Sample )?(?:Video\|Thumbnail) ([1-9][0-9]*)(?: — .+)?$` | **no parser**, composer only |
| Trim | Trims the title first (`:113`) | **does not trim** | collapses whitespace and trims (`:2092`) |
| Name cap 160 | **refuses** (`index.ts:7271`) | none (500 on the title) | **silently cuts** at 160 (`:2092`) |
| Drift test | `test/intake-post-names.js:176-184` covers browser and policy | **not covered** | covered |

The main split works the same in all three: prefix, then a number with no leading
zero, then an optional ` — name`. A name that itself contains ` — ` is swallowed
by the greedy `.+`, so it is fine.

**Recommendation: one rule, one source, three generated copies plus a drift test.**

- Keep `policy.mjs` as the source: `intakeTitleParts`, `intakeChildTitle`, and a new `renameTitle(oldTitle, newName)`.
- The browser can't import an Edge Function module, so it gets the same functions copied into a `src/index` fragment. The SQL gets `public.syncview_title_parts(text)` and `public.syncview_rename_title(text, text)`.
- One test runs a shared fixture table (below) through all three: the browser copy in Node, the policy module, and the SQL function source parsed and run in a local Postgres if one is available. If no Postgres is available, the SQL regex literal is extracted and compared byte-for-byte with the policy regex source, and the SQL function body is checked for the same trim and cap statements.
- The test fails on any difference.

**The rename rule (`renameTitle`):**

1. Clean the new name the way `intakeChildName` does: collapse all whitespace, including NBSP and newlines, to one space, then trim.
2. **Empty after cleaning:**
   - An in-format title becomes the bare `Video N`.
   - An out-of-format title is **left unchanged**, because a title can't be null and inventing text is worse.
3. **Longer than 160 characters:** refuse the edit on the side where it was typed, with a visible message. Do not silently cut it. The browser's silent `.slice` is fixed to match. On a propagated write, a card name over 160 characters is **not propagated** and gets logged as `name_too_long`. Measured today: 0 linked calendar deliverables have titles over 160; there are 2 among manual ones.
4. **Title in our format:** keep `[Sample ]Kind N` exactly as it is and replace only the part after ` — `.
5. **Title not in our format** (a human-written or hyphen title): the whole title becomes the new name. It stays out of format, so it still counts 0 toward numbering, exactly as today. Nothing gets worse (see D).
6. Emoji are kept. Leading and trailing spaces are trimmed. A card with no name is D-case 3.

**Fixture rows the drift test must include:** `Video 3`; `Video 3 — a — b`; `Video 3 - x`
(hyphen, out of format); `Video 3 — ` (whitespace name; today JS parses null but
SQL matches); `" Video 3 — x"` (leading space; today JS parses it but SQL does
not); `Video 03`; `video 3`; `Sample Thumbnail 12 — 🎬 name`; an out-of-format
title; a name with a newline; a 160-character name and a 161-character name.

**Known drift the build must fix, not just test:**

- **SQL doesn't trim.** Trim in the SQL helper.
- **SQL accepts a whitespace-only name.** Require non-blank.
- **The browser cuts instead of refusing.** Refuse instead.

---

## C. Who links to what (measured)

- A card links to at most one video and one graphic sub-issue: `calendar_posts.video_deliverable_id` / `graphic_deliverable_id`.
- A sub-issue points back with `deliverables.card_id` (a single column), so **a sub-issue can never belong to two cards through `card_id`**.
- The status bridge treats a link as real only when **both** sides agree (`migrations/2026-09-18-native-calendar-status-bridge.sql:119,269-277`). **Recommendation: the rename uses the same two-sided rule.**

| Measure (all cards, all clients) | Count |
|---|---|
| Cards | 12,800 |
| Cards with a video slot / graphic slot / both | 838 / 825 / 708 |
| Two-sided video links / two-sided graphic links | 832 / 820 |
| Deliverables named in two or more card slots | 8 |
| Deliverables whose `card_id` points at a card whose slots name something else | 17 |
| Deliverables whose `card_id` points at no card | 56 |
| Card+kind pairs with more than one live deliverable by `card_id` | 2 |
| Cards with an `other`-kind deliverable | 10 |
| Live (not posted/approved/canceled/duplicate) deliverables with no card | 1,733 |
| Cards with an empty name | 60 |

**Recommendations:**

- **Counterparts of a card** are the deliverables in its two slots, where that deliverable's `card_id` is the card. Other-kind rows, one-sided links, the 8 double-slotted and the 17 disagreeing rows are **skipped and logged** (`ambiguous_link`), never guessed. That follows the #37/#42 lesson to prefer "ambiguous" over a confident wrong answer.
- **Renaming the video sub-issue** renames the card, and the card renames the thumbnail sibling. This is two hops through the same outbox, so the sibling follows. It doesn't loop, because the third hop (the card again) is an equality no-op.
- **Sub-issues with no card and cards with no sub-issue:** the rename saves locally and nothing propagates. This is not an error and is not logged.

---

## D. Old mismatches (no backfill)

These are two-sided pairs excluding canceled and duplicate rows. A "mismatch"
means the card name differs from the title's name part (or from the whole title,
if the title is out of format), after trimming.

| Kind | Pairs | In format | …of which bare `Kind N` (no name) | Out of format | Mismatch (all) | Live pairs | Live mismatch |
|---|---|---|---|---|---|---|---|
| Video | 813 | 627 | 545 | 186 | 779 | 342 | 332 |
| Thumbnail | 803 | 652 | 564 | 151 | 743 | 316 | 282 |
| Other | 10 | 0 | 0 | 10 | 6 | 5 | 3 |

**So roughly 95% of linked pairs disagree today. Most are a bare `Video N`
sitting next to a named card.** Other edge counts: 95 card names already contain
` — `, 32 pairs have untrimmed text, 1 title has two separators, and 0 titles use
a hyphen look-alike in the linked set.

**What a rename does to a side that disagreed:** the new name overwrites it, as
the owner ruled. Worked examples:

| # | Before: card / sub-issue | Action | After: card / sub-issue |
|---|---|---|---|
| 1 | `Morning routine` / `Video 4` | card renamed `Gym day` | `Gym day` / `Video 4 — Gym day` |
| 2 | `Old` / `Video 4 — Something else` | card renamed `New` | `New` / `Video 4 — New` |
| 3 | *(empty)* / `Video 4 — Launch` | sub-issue name edited to `Launch v2` | `Launch v2` / `Video 4 — Launch v2` |
| 4 | `Promo` / `Promo clip FINAL - edit 2` (out of format) | card renamed `Promo B` | `Promo B` / `Promo B` (stays out of format, still counts 0) |
| 5 | `Promo` / `Promo clip FINAL` (out of format) | sub-issue renamed `Promo C` | `Promo C` / `Promo C` |
| 6 | `A` / `Video 4 — A`, sibling `Thumbnail 4` | video renamed `B` | card `B`, video `Video 4 — B`, thumbnail `Thumbnail 4 — B` |
| 7 | `X — part 2` / `Video 4` | card renamed `X — part 3` | `X — part 3` / `Video 4 — X — part 3` (parses back to `X — part 3`) |
| 8 | `Gym` / `Video 4 — Gym` | card cleared to empty | *(empty)* / `Video 4` |
| 9 | `Gym` / `Promo clip` (out of format) | card cleared to empty | *(empty)* / `Promo clip` (unchanged, logged `empty_name_not_propagated`) |

**Can we give an out-of-format title a `Kind N` prefix?** Not safely.

- A number would have to be invented. The batch's used numbers can't be known when out-of-format siblings don't carry one.
- Any number we pick could collide with a future append. That is exactly the `maxOrdinal` hazard entry 234 describes.

**Rule:** out-of-format stays out-of-format and receives the plain name. It
already counts 0 toward numbering, so numbering is no worse than today.

---

## E. Failure and races

**E1. The edited side always saves.** The card save (`calendar-upsert`) and the new
`production-write` title op do exactly what they do today. The only addition is an
`AFTER UPDATE OF name` / `AFTER UPDATE OF title` trigger that:

- fires only when the value actually changed (`IS DISTINCT FROM`);
- inserts one row into a new `rename_propagation_outbox`: `source_table`, `source_id`, `new_name`, `source_changed_at`, `origin`, `attempts`, `state`;
- wraps the insert in `BEGIN … EXCEPTION WHEN OTHERS THEN RAISE WARNING … END`, so **a failure to record can never fail the save**. It takes no locks on the counterpart.

This is the same pattern as the status bridge, except the bridge writes the
counterpart in the same transaction. The rename deliberately does not, so it can
never delay or roll back an approve or request-changes save that touches the same
rows.

**E2. Drain.** `public.rename_propagation_drain()` is `security definer` with
`search_path` pinned. It is revoked from `public`, `anon`, `authenticated` and
`service_role` by name, then granted as needed (the CLAUDE.md lesson). It runs:

- from `pg_cron` every minute;
- when poked by the browser after a rename, through a narrow RPC that only calls the drain.

For each pending row the drain:

- resolves the two-sided counterparts (C);
- applies `renameTitle` / the name part;
- **skips if the target already equals the result** (the no-op);
- writes with `set_config('syncview.rename_origin','propagation',true)`, so the triggers on the other side do not enqueue again. That plus the no-op makes loops impossible;
- writes an events-ledger row.

**On failure:** retry with backoff (1, 2, 5, 15 and 60 minutes, then `failed`).

- A `failed` or `skipped` row is **never silent**. It goes to the WR-101 server logbook through the same `write-diagnostics` path (`120-calendar-flags-write-repair.js.part:1458` `_writeRefusalBeacon`; server side applied per #241).
- On the browser, `_writeUiReportFailure('calendar'|'production','rename', err, ids)` (`120-…:2191`) adds the local ring entry.

**The "name syncing" indicator.** A small chip on the card and on the sub-issue row
while an outbox row for it is pending. It reads the outbox through a read-only view
filtered to the viewer's client. It turns into "name didn't sync — retry" on
`failed`, with a button that re-queues the row.

**E3. Replay and title-comparison hazards** (the in-flight save and retry case).
The drain **defers**, and never drops, any deliverable that:

- was created in the last 10 minutes, or
- has an open intake request, component fill or `mirror_outbox` row.

This covers `named-append.sql:259`, `production-write/index.ts:6829,6854` and the
f203 replay. A deferred row retries later. The card side has no replay compare on
`name`: v2 sends an empty `comments_base_at` (`170-…:1336`), so the last write
wins.

**E4. Both sides renamed at once.** Each side records `source_changed_at`. When the
drain applies a row, it first checks whether the target's own name changed **after**
this row's `source_changed_at`, using a newer outbox row from the target, or the
journal. If it did, this row is `superseded` and the newer rename wins on both sides.

To make that one cheap comparison, add two nullable columns:
`calendar_posts.name_changed_at` and `deliverables.title_changed_at`. The triggers
set them, and nothing is backfilled.

**E5. Offline, staged or debounced edits.** The calendar's 650 ms debounce, per-card
serialization and re-flush (`130-…:195`, `170-…:1370`) mean only the value the
server actually stored fires the trigger. Intermediate keystrokes never propagate.
A staged or offline edit that saves later is simply a later rename, and E4 orders it.

**E6. Linear, while it is still mirrored.** A propagated title is written like any
staff title edit, so it is mirrored out once. The inbound echo matches, so it is a
no-op. A Linear-side rename arriving through `linear-inbound:815` sets
`syncview.rename_origin` to `linear` and is not propagated (decision 6).

---

## F. Permissions

**Today:**

- **Card names:** staff (admin, smm, creative) and client-Collab links can rename. The client gate is browser-only; `calendar-upsert` accepts any client token for its own slug (`_shared/browser-write-auth.ts:46`).
- **Sub-issue titles:** nobody can rename them in SyncLinear.

**Options for client-originated card renames:**

| Option | What happens | Risk |
|---|---|---|
| **a. Propagate all renames (recommended)** | The trigger does not care who saved. A client's rename reaches the sub-issue | Editors see client wording in their queue. That is the owner's "always" rule, and the journal records who did it |
| b. Staff-only propagation | Needs the actor on the card save, which means changing `calendar-upsert`. That has **no CI deploy path** (`docs/ops/EF_DEPLOY_MANIFEST.md:26`) | Partial coverage, and it contradicts the owner's rule 1 |
| c. Client renames wait for staff approval | New queue and UI | More work, and a delay the owner didn't ask for |

**The server-side Collab gap exists whatever we choose.** It is logged as a
separate follow-up, not fixed here.

**Sub-issue rename after the feature:**

- admin and smm, which is the `staffOperationAllowed` default (`policy.mjs:295-306`);
- creative on its own team, if the owner agrees (decision 3);
- clients: none (`clientOperationAllowed` `policy.mjs:662`).

---

## G. Release

**Build step 0 (read-only, before code):** confirm whether the
materialization-boundary and legacy-triage checks (A1) still run on existing
cards. If they do, change them to compare the name part.

**Release 1: card → sub-issue. SQL only, no Edge deploy.**

- One migration adds:
  - the shared SQL helpers;
  - the outbox table (RLS on, no anon writes);
  - the two `*_changed_at` columns;
  - the trigger on `calendar_posts.name`;
  - the drain and its cron job;
  - the pending-state read view.
- The `deliverables.title` trigger ships in the same migration **disabled**, behind the `syncview_runtime_flags` flag `rename_from_subissue`.
- Plus the browser: the shared rule fragment, the "syncing" chip, the browser-side cap fixed to refuse, and the drift test.
- The browser can ship first safely: with no outbox view, the chip reads nothing and hides.
- **Rollback:** `alter table … disable trigger` and unschedule the cron job, both one line. The outbox rows remain as a record.

**Release 2: sub-issue → card. Section 4 deploy.**

- Add `title` to `OPERATIONS` (`policy.mjs:5`) with a role gate.
- A handler in `production-write/index.ts` that:
  - accepts `{deliverable_id, name, expected_updated_at}`;
  - composes the title with `renameTitle`;
  - uses `assertCas`;
  - has its own reconcile-replay branch comparing the **name**, not the full title (`index.ts:2048`).
- Re-pin the `production-write` digest with `node scripts/ef-fingerprint.js <sha> --slugs=production-write --expected-only`.
- Then the owner's standard ceremony (CLAUDE.md):
  1. Run `& "$env:USERPROFILE\.syncview\f27-capture.ps1"`.
  2. Drag the `.sourcebundle` into `SyncView Backups/` **before** dispatching.
  3. Dispatch `deploy-f27-section4-closures.yml` with main's tip SHA and the bundle sha256 and length.
- **DO-NOT-MERGE window:** from handing over the SHA until the owner reports green.
- After deploy: update `ROLLBACK.md:124` (enforced by `scripts/rollback-row-freshness-check.js`), then turn on `rename_from_subissue` and ship the SyncLinear title input.
- **Rollback:** turn off the flag, which stops propagation immediately. If the op itself misbehaves, run `restore-captured-prior-three` with the fresh bundle.
- The UI input may merge before the deploy only if it is hidden behind the same flag. Otherwise it would call an op that doesn't exist.

---

## H. Tests and proof

**H1. Unit tests (Node):**

- `test/title-rule-drift.js`: the fixture table in B through the browser copy, `policy.mjs`, and the SQL helper (a local Postgres if available; otherwise a regex-source and body comparison). **Fails on any drift.**
- `renameTitle` cases D1–D9.
- Policy role matrix for the `title` op.
- Replay branch: the same name replays and a different name gives 409.
- Drain logic as a pure function: two-sided resolution, the `ambiguous_link` skip, the no-op, supersede-by-newer, and deferral while intake is open.

**H2. Browser tests** (mocked, alongside `prod-write-gateway-browser.js`):

- Card rename shows the chip, then it clears.
- The failed state shows retry.
- A 161-character name is refused with a message.
- The SyncLinear title edit keeps the open row in place.
- Approve and request-changes still succeed while a rename is pending or failing, **the owner's top priority, asserted directly**.

**H3. Live proof, test client only.** Every step on the test client; read back through SQL:

1. Card → video + thumbnail (D1, D2, D6 via card).
2. Video → card → thumbnail (D3, D6).
3. Out-of-format titles (D4, D5).
4. Separator in the name (D7).
5. Emptying the name (D8, D9).
6. A 160-character name and a 161-character one.
7. Emoji, leading and trailing spaces.
8. Failure: point the drain at a locked row and see retry, then `failed`, the logbook entry and the chip.
9. A simultaneous rename on both sides (E4).
10. A rename during an in-flight intake append (E3 deferral), then the append's retry succeeds.
11. **Approve and request changes on a card whose rename is pending.**
12. A loop check: the outbox row count settles.
13. Disable the flag and the trigger, then confirm the rollback.

---

## I. Owner decisions

1. **Should a client's card rename change the editor's task title too?** Recommendation: yes, always, as you asked. We record who made each change.
2. **When a name change arrives from the task side, does the card's title approval reset?** Today a name change doesn't reset it on the server. Recommendation: no reset, to match today.
3. **Who may rename a task in SyncLinear?** Recommendation: admins and social media managers. Editors only for their own team's tasks, if you want that.
4. **Old tasks whose titles aren't in the "Video 4 — name" format:** on a rename they just take the new name and keep no number. Recommendation: yes. We should not invent numbers.
5. **Are Samples included?** Recommendation: yes, in the second release, with the same rules.
6. **A title changed inside Linear itself, while Linear is still connected:** should it rename the card? Recommendation: no. Only changes made in SyncView should spread.
7. **Two releases:** calendar renames first, with no deploy ceremony, then task renames after the gated deploy. Recommendation: yes.
