# Trial versions of a card, the Frame folder import, and the SMM's status change: plan

Session Variantplan, 2026-11-02. Plan only: no code, no migration, no deploy in this PR.
Covers Sidney's items 5 (trial versions of a card), 1 (Frame folder import with a matching step)
and 2 (the SMM changes a trial's status from the content calendar).
Sister plans: `posting.md` (Postplan, the Post tab) and `links.md` (Linkplan, Post for Me and Frame.io facts).

---

## 1. What exists today (measured 2026-11-02)

**The big finding: a version is already a row of its own.** Sidney's "copies of the card" mostly exists.
What is missing is that a version carries only a video, not its own thumbnail and caption.

- **Data.** `studio_trial_versions` holds one row per version, letters A to G
  (`supabase/migrations/20261026200000_studio_trial_versions.sql:18`). SyncView added the card link
  (`post_id`), the video link (`frame_url`), one OK per reviewer (`smm_ok_at`, `kasper_ok_at`, `client_ok_at`),
  the change note and the trial timer (`20261027090000_trial_reels.sql:34`), and the client's "Not this one"
  (`20261028150000_trial_reels_client_pass.sql:15`). The card's switch and winner are `trial_reel_cards`
  (`20261027090000_trial_reels.sql:48`). No browser role can read either table.
- **The card has no new column.** The card's own `thumbnail_url`, `caption` and `asset_url` stay single.
  "The version on the card" (A, then the winner) is copied to `asset_url` through today's Production attach;
  the function never writes the card (`supabase/functions/trial-reels/index.ts:8`).
- **Writer.** One Edge Function, `trial-reels` (651 lines, rules in `logic.mjs`). Actions at `logic.mjs:20`:
  list, read, switch_set, version_link_set, version_drop, version_restore, version_new_cut, version_add, answer,
  trial_start, winner_set, winner_undo, plus list_many. A client link may only list, read and answer (`logic.mjs:22`).
  Admin and SMM may do everything; an editor may paste links and say a new cut is ready (`logic.mjs:47`).
  Every change goes to `calendar_post_events` as `trial_<action>` (`logic.mjs:582`) and is broadcast to open pages
  (`index.ts:104`).
- **Approval rules.** Each reviewer answers one version at a time (`logic.mjs:314`). When every live version has
  this reviewer's OK, the page calls today's part approve, so the card status, Production, the status bridge and
  the drift robot move exactly as for any card (`docs/features/TRIAL_REELS_PLAN.md` section 5). Per-version routing:
  each version has its own place (with SMM, with Kasper, with the client, approved, waiting for a new cut).
- **Screens.** Staff card: the switch and the versions live inside the Video row
  (`src/index/189-trial-reels-card.js.part:11`). Review page (client link, SMM Review tab, Kasper): one version at a
  time, "Video B of 5", a dot per version and an arrow each side (`194-review-trial-versions.js.part:8`). Production:
  one Deliverable file row per version on the video sub-issue (`245-production-trial-versions.js.part:8`).
- **Frame.io.** `frameio-view` already reads Frame's V4 API with SyncView's own Adobe login (`frameio-token`). It
  resolves `f.io/...`, `next.frame.io/share/<id>[/view/<file>]` and `next.frame.io/project/<p>/view/<file>`
  (`frameio-view/logic.mjs:42`), and already opens folders, but only takes the **first** video in one
  (`logic.mjs:127`). It never lists a folder. A risk to fix on the way: a `/share/<id>/view/<file>` link is looked up in
  the first page of the share's asset list only (no `page_size`, no cursor), and when the file is not found it silently
  falls back to the share's first asset (`logic.mjs:151`). Frame's share list is flat and recursive (Linkplan, V4
  reference), so a file inside a shared folder is normally found; the wrong video appears only past the first 50 rows.
  The fix is to follow the cursor and refuse instead of falling back.
- **SMM status today.** The SMM can approve a version only on the Review tab, at the SMM stage. On the calendar card
  a version row has its link, a pencil, Drop and (after 24 h) the trophy. There is no way to say "the client approved
  this" or "change asked" from the card. That is item 2.
- **Posting.** The Post tab has a Trial reel switch on Instagram (`299-instagram-upload.js.part:673`), but it is not
  tied to the card's versions; the SMM downloads the video from Frame by hand (`docs/ops/INSTAGRAM_UPLOAD.md:110`).
- **Live use (read-only SQL, 2 Nov).** `trial_reels_pages` = all clients since 2 Nov. 52 switch rows, 34 on; only
  **1** card of **1** real client is on, with **3** versions. 161 version rows in all, every one linked to a card;
  at most 5 versions on a card; 5 winners. So a data move is tiny, and almost all of it is the test client.
- **Open trial work elsewhere.** Session Trialchange is fixing a Safari player error on the review stage. Nothing here
  touches the player; build PR 6 below waits for that fix to merge before it edits `195`/`194`.

---

## 2. The proposal

**Keep versions as they are (rows in `studio_trial_versions`) and give each version its own thumbnail and caption.
An empty field means "same as the card".**

That one rule does most of the work:

- **Nothing moves.** Today's trial reels are exactly versions whose thumbnail and caption are empty, so they show the
  card's. No backfill, no copy, nothing lost. Rollback is dropping two columns.
- **Version A is the card.** A's thumbnail and caption are the card's own fields. Only B, C... need their own.
  The card in Month, Week, Sheet, Production, analytics and the Sheet copy stays one card, as today.
- **The switch moves from the Video row to the card.** It is the same switch (`trial_reel_cards`); only its place on
  screen changes. It reads "Versions". Each version shows three things: video, thumbnail, caption.
- **One answer per version, for all its parts.** A reviewer approves "Version B" as a whole. A change is asked on one
  part of one version (video, thumbnail or caption), so the note reaches the right person (editor or designer).
  When every live version has this reviewer's OK, the page calls today's approve on each part the card has (video,
  thumbnail, caption), as it does today for the video alone. The card status, Production and the status sync move only
  through today's saves.
- **The winner goes onto the card.** When the SMM picks the winner, the page writes the winner's video through
  today's Production attach (as now) and its thumbnail and caption through today's card save (`calendar-card-write`,
  both fields already in its allowed list, `calendar-card-write/logic.mjs:15`). Each version row keeps its own copy,
  so Undo puts A back.
- **Frame folder import** fills the versions' video links in one step (section 4.3).
- **The SMM's status menu** on each version row on the card: Approved (the client told me), Change asked, Dropped,
  back to Waiting (section 4.4). Logged like every other trial change, and shown at once on every board.

### Alternative 1: each version is a real card (a `calendar_posts` row with a parent)

- *Buys:* literally "copies of the card"; every field (title, CTA, alt caption) can differ for free.
- *Costs:* a new card column has to enter `calendar-card-write`'s list **and** the frozen `calendar-upsert`. Every view
  (Month, Week, Sheet, Kasper's queue, the client link, Today, the posted detector, analytics, the Sheet copy) would
  have to hide the children, or show the card three times. Each child would need its own Production sub-issues, so the
  status bridge and the drift robot would see three times the work items. A Section 4 change is likely.
  Roughly three times the work and the bug surface. **Not recommended.**

### Alternative 2: versions only for video (today), plus a free-text "hook" line per version

- *Buys:* almost nothing to build; the thumbnail and caption stay on the card.
- *Costs:* does not do what Sidney asked: a trial cannot test a different thumbnail or caption. **Not recommended**,
  but it is the fallback if the build has to stop after PR 3.

---

## 3. Backend

### Tables and columns

One migration, additive only, on `studio_trial_versions`:

| column | type | meaning |
|---|---|---|
| `thumbnail_url` | text, null, `https://` only, at most 2048 | this version's thumbnail; null = the card's |
| `caption` | text, null, at most 4000 | this version's caption; null = the card's |
| `change_part` | text, null, `video` / `thumbnail` / `caption` | which part a change was asked on; null = video (today) |
| `client_ok_by` | text, null, `client` / `smm` | who gave the client OK; null = the client (today) |

- **How existing data moves:** it does not. Every existing row reads as "same as the card", "change on the video",
  "client OK by the client", which is exactly what those rows mean today.
- **Marker:** `-- ef-auto-deploy: functions-cope-without-this`. `trial-reels` reads rows with `select *` and names a new
  column only in the actions that set it, which refuse with `fields_unavailable` until the migration is applied (the
  same pattern as `client_pass_at`, `20261028150000_trial_reels_client_pass.sql:10`).
- **Grants:** unchanged (a new column takes the table's grants; the table stays service-role only). The migration reads
  back what `anon`, `authenticated`, `public` and `service_role` hold, as the earlier ones do.
- **Rollback:** `alter table public.studio_trial_versions drop column thumbnail_url, drop column caption,
  drop column change_part, drop column client_ok_by;` plus switching the page flag off. Data written into those
  columns while live is lost on rollback; the card itself is never affected.
- **Lighthouse applies it** (a merge that adds a migration file; the cope marker lets `trial-reels` deploy anyway).

### Edge Functions

| function | change | deploy lane | Section 4 re-pin |
|---|---|---|---|
| `trial-reels` | new `version_fields_set` (thumbnail, caption; admin, SMM, creative); `answer` takes `part` for a change; new `smm_set` (section 4.4); `versions_import` (several letters' links in one atomic write); `read`/`list` return each version's fields with the card's values filled in where empty (`effective`) | merge lane, automatic | none |
| `frameio-view` | new `part: "list"` (staff key only): the videos in a share or folder, up to 50, with name, duration, Frame's thumbnail, created time and a per-file link. Fix the folder `/view/<file>` lookup (above). Still read-only, writes nothing | merge lane, automatic | none |
| `production-write`, `deliverable-write`, `batch-write` | **not touched**. The video still goes onto the card through the existing `attachment` action | n/a | none |
| `calendar-card-write` | not touched (thumbnail and caption are already allowed) | n/a | none |
| `calendar-upsert` (frozen) | not touched | n/a | none |

No new table, no new function, no n8n change.

### The page flag

`trial_versions_v2` in `syncview_runtime_flags`, shaped like the others: `{"clients": ["sidneylaruel"]}` first, then
`{"all": true, ...}` after the live checks. Off = today's trial reels exactly. The function checks it for the new
actions too, so an old page cannot write fields a new page would then show differently.

---

## 4. Screens

House rules followed: no coloured left edges; skeletons have the real rows' shape; a hover lights only what is under the
mouse; every opened page has a Back button. Sizes checked at 1440 and 390 wide.

### 4.1 The staff card (Calendar)

The switch moves from inside the Video row to the card's footer, next to the pencil: "Versions". Off, the card is
exactly today's.

```
1440, card opened, Versions on, 3 versions                390, the same card
+--------------------------------------------------+      +------------------------------+
| Reel: Morning routine          Client Approval   |      | Reel: Morning routine        |
| Thumbnail  [ img ]   Caption "Three things..."   |      | Client Approval              |
| Video      f.io/...                              |      | Versions · 3   2/3 approved v|
| Versions · 3     2/3 approved           [Import] v|      +------------------------------+
|  A  on the card   [thumb] "Three things..."  ●●○ |      | A  on the card   ●●○      ...|
|  B                [thumb] "Stop doing..."    ●●● |      | B  [thumb] Stop doing...  ...|
|  C  change asked  [thumb]  same as the card  ●○○ |      | C  change asked           ...|
|  + Add version                                   |      | + Add version  · Import      |
+--------------------------------------------------+      +------------------------------+
```

- A row opens (click the letter) into three fields: Video link, Thumbnail link, Caption. Empty thumbnail or caption
  shows a faint "Same as the card". A's three fields are the card's own fields, labelled "on the card".
- The dots are SMM · Kasper · Client for that version (today's hover text stays: "SMM: approved · Kasper: waiting ·
  Client: approved").
- The "..." on each row is the SMM's status menu (4.4).
- **States.** Loading: the Versions line shows its label and a grey bar where the count goes, rows as grey lines of the
  same height. Error: the line reads "Versions could not be read. Retry" and keeps the last good list if it has one.
  Empty (switch just turned on): "Versions · 1" with A filled from the card and "+ Add version · Import from Frame".
  One version: as empty (a card with one version reviews like a normal card, as today). Many (7): rows scroll inside
  the card only past five on 390; at the seventh, "Add version" turns into "7 is the most".

### 4.2 The review page (client link, SMM Review tab, Kasper's Review Session)

**Arrows or side by side?**

| | 1440 | 390 |
|---|---|---|
| Side by side | three 9:16 players fit (about 300 px each) with captions under them. But three videos load at once (three Frame renditions; Safari is already fragile here), three sets of buttons, and a comment no longer clearly belongs to one version | does not fit. Three players at about 115 px wide are too small to judge; it becomes a swipe, i.e. arrows anyway |
| Arrows (today) | one player, big; a reviewer can lose track of what the others looked like | one player, full width; natural swipe |

**Recommendation: keep one version at a time (today's arrows), and add a strip of version tiles above the player.**
Each tile is the version's thumbnail with its letter and this reviewer's answer dot. It gives the side-by-side
comparison where it matters most (the thumbnails and hooks), costs one image per version instead of one video, and
works the same at both widths. Click a tile, an arrow, the arrow keys, or swipe.

```
1440                                                         390
+-------------------------------------------------------+    +----------------------------+
| < Back       Reel: Morning routine                    |    | < Back   Morning routine   |
|  [A ●] [B ○] [C ○]          Version B of 3            |    | [A●][B○][C○]   B of 3      |
|   ^ thumbnails, the one on screen outlined            |    | +------------------------+ |
| +-------------+  Thumbnail [ img B ]                  |    | |                        | |
| |             |  Caption   "Stop doing this..."       |    | |   player (version B)   | |
| |  player B   |                                       |    | |                        | |
| |   9:16      |  [ Approve version B ]                |    | +------------------------+ |
| |             |  [ Ask for a change ]  [ Approve all ]|    | Thumbnail [img]  Caption...|
| +-------------+                                       |    | [ Approve version B ]      |
|   <                                         >         |    | [ Ask for a change ]       |
+-------------------------------------------------------+    +----------------------------+
```

- The thumbnail and caption shown are the version's (or the card's, when the version has none).
- "Ask for a change" asks which part: Video, Thumbnail, Caption (today's inline "what should change" step, with the
  part picked first). The note goes out as today's tweak note, "Version C, thumbnail: ...", on that part.
- Once a winner is picked, the client sees only the winner (today's rule).
- **States.** Loading: the strip shows grey tiles of the real size, the player its usual skeleton. Error reading
  versions: today's page (the card reviews as a normal card) plus a quiet "Versions could not be read" line; never a
  wrong answer. One version: no strip, today's page. Many (7): the strip scrolls sideways on 390, no wrap; on 1440 all
  seven fit. Kasper's queue counts the card once, as today.

### 4.3 Import from a Frame folder

Opened from "Import" on the Versions line. A sheet over the card (desktop) or a full page with Back (phone).

```
Step 1                                     Step 2 (the minimalist matching step)
+-------------------------------------+    +-----------------------------------------------+
| < Back   Import versions from Frame |    | < Back   Folder "Morning routine v2" · 6 videos|
| Paste a Frame share link            |    | Card: Reel: Morning routine                    |
| [ https://f.io/...              ]   |    |                                                |
| [ Show videos ]                     |    | [thumb] hook_A_final.mp4   0:24   [ A v ]      |
+-------------------------------------+    | [thumb] hook_B_final.mp4   0:23   [ B v ]      |
                                           | [thumb] hook_C_final.mp4   0:25   [ C v ]      |
                                           | [thumb] broll_test.mp4     0:08   [ Skip v ]   |
                                           | [thumb] hook_A_old.mp4     0:24   [ Skip v ]   |
                                           |                                                |
                                           |            [ Cancel ]  [ Add 3 versions ]      |
                                           +-----------------------------------------------+
```

- **What the person pastes:** one Frame share link (`f.io/...` or `next.frame.io/share/...`) to a folder, or to one file.
  A single file opens step 2 with one row.
- **What SyncView lists:** every video in the folder (not images, not subfolders), newest first, with Frame's own
  thumbnail, the file name and the length. Each row has one control: a letter picker (A to G, or Skip).
- **How a video is matched:** the picker is pre-filled only when the file name clearly says a letter or a number
  ("_A", " B.", "v2", "hook 3"); everything else starts on Skip. Two rows can never hold the same letter: picking a
  taken letter moves it and sets the other row to Skip. A letter that already has a link on the card shows
  "replaces"; replacing follows today's link rules (a version with a change asked takes its new cut; an approved one
  asks first). Nothing is written until "Add 3 versions"; then all links go in one write (`versions_import`), all or
  nothing.
- **Wrong folder:** step 2 always shows the folder's name above the card's name, so a mismatch is visible before
  anything is added. Cancel writes nothing. A wrong import is undone with today's Drop or by pasting the right link.
- **Private folder:** SyncView reads Frame as its own login, so a link from another Frame account, a share that is
  switched off, or an expired share answers in plain words with the fix: "SyncView cannot open this folder. In Frame,
  make a share link for it and paste that." (today's `share_off`, `share_expired`, `link_not_found` messages). A
  `next.frame.io/project/...` folder address (not a share) is refused with the same advice in v1; Linkplan confirms
  whether it can be read directly.
- **Folder with 40 videos:** all listed (up to 50, Frame's page size today), with a filter box above the list from 12
  videos on. At most 7 can get a letter; the eighth pick says "7 versions is the most". Over 50: "Showing the 50
  newest"; paging is cut from v1.
- **States.** Loading: rows of the real shape (thumbnail square, two text bars, a picker) for up to 6 rows. Error: the
  plain message under the link box, link kept for editing. Empty folder: "This folder has no videos." One video: one
  row, pre-set to the first free letter. Many: as above.
- **Which link is stored per version:** `next.frame.io/share/<share>/view/<file>`, so the client player, Production's
  availability check and "Open in Frame" all work as they do with today's pasted links. Needs the lookup fix in section 1
  (follow the cursor, refuse instead of falling back). The link carries the Frame file id, so no extra column is needed; a signed media address is never stored.
- **Frame facts this relies on (from Linkplan, V4 reference read 2026-11-02, see `links.md`):** the token frameio-view
  already holds is enough (nothing new from Sidney). The list uses `folders/{id}/children` with `include` set to the
  thumbnail and metadata only (name, Duration). Never ask for `media_links.original`: it answers 403 without download
  rights. Media links are null while a file is transcoding, so a still-processing video shows as a row with "Still
  processing in Frame" and its picker disabled. Pages follow a cursor (`after`, `links.next`), so going past 50 is
  cheap if it is ever needed. The rate limit is 100 calls a minute per Frame user, and one import makes 3 to 5 calls.
  Page size goes up to 500; thumbnails are signed links, shown and never stored. A project address
  (`next.frame.io/project/<p>/view/<id>`) can be a file or a folder; v1 still refuses a folder one with the share
  advice. **Still to measure on one real link in PR 3:** whether Frame's own web page opens a
  `/share/<id>/view/<file>` link to a file inside a folder share, and that a secure (non-public) share in our own Frame
  account reads through our login (Linkplan's reading of the reference says yes).

### 4.4 The SMM's status menu (item 2)

The "..." on a version row on the calendar card (also on Production's version rows later). SMM and admin only; an
editor and a client never see it.

```
+-----------------------------+
| Approved (client told me)   |
| Change asked...             |
| Dropped                     |
| Back to waiting             |
+-----------------------------+
```

- **Which statuses:** Approved, Change asked (with a note and a part, same as the review page), Dropped (today's Drop,
  moved into the menu), Back to waiting (clears this version's answers; refused once it is on trial). On trial, winner
  and lost stay automatic or the trophy's, as today.
- **Approved by the SMM** sets the client OK with `client_ok_by = smm`, and fills any stage OK still missing for that
  version (see question 1). The version then counts as approved everywhere, and when every live version is approved the
  page calls today's approve, so the card goes to Approved through today's save.
- **Who else sees it:** everyone, at once (the existing broadcast). The client link shows "Approved" on that version;
  Kasper's board drops it from his queue; every board shows a small "by SMM" under it so nobody thinks the client
  clicked.
- **How it is logged:** `calendar_post_events`, `trial_smm_set`, with the SMM's name, role, from and to status, letter,
  and for a change the part. Refusals go to the server-side write-refusal log like every Calendar write.
- **States.** Saving: the menu item shows the busy dot, the row keeps its old label until the server answers. Refused:
  today's toast with the plain reason ("This version is on trial"). Many versions: one menu per row.

---

## 5. Build order

Each PR ships alone and is safe to stop after. Live behaviour changes only behind `trial_versions_v2`, test client
first. Every PR runs `node scripts/repo-identity-exposure-check.js --diff=origin/main` and, for page changes,
`node docs/syncview-design/tests/prod-write-gateway-browser.js`.

| # | Changes | Proven by | Could break |
|---|---|---|---|
| 1 | Migration: the four columns, cope marker, grants read back | migration test that the columns exist and no browser role gained anything; read-back SQL after Lighthouse applies it | nothing reads them yet |
| 2 | `trial-reels`: `smm_set` + the SMM status menu on the card (item 2). Smallest, independent, Sidney's most direct ask | `test/trial-reels*.js`: an SMM `smm_set approved` is refused before (unknown action) and passes after; a creative and a client are refused; the ledger row is written. Live: on a sidneylaruel trial card, mark B approved as SMM, see it on the client link and gone from Kasper's queue | the card moving to Approved early if the "all versions approved" count is wrong; covered by a test per stage |
| 3 | `frameio-view` `part: "list"` + the share lookup fix (follow the cursor; refuse, never fall back). No screen yet | unit tests on `logic.mjs` with a mocked Frame answer: a folder of 6 videos and 2 images lists 6; a `/view/<file>` that is the 60th row of a share plays that file (fails before, passes after); a file not in the share is refused, not replaced by the first. Live: list one test folder with a staff key | the existing "Watch here" player, if the fix changes which file a link picks; covered by today's frameio-view tests |
| 4 | The import sheet and `versions_import` (item 1), behind the flag | browser test with mocked answers: paste, list, pick, add; a duplicate letter cannot be set; a refusal writes nothing. Live: import three videos into a sidneylaruel card | today's link paste on a version (shared code path) |
| 5 | `trial-reels` `version_fields_set`, `effective` in reads, `part` on a change; card UI: the switch moves to the card, rows get thumbnail and caption | function tests (a null field reads as the card's; a set field wins; the winner copy covers thumbnail and caption); browser test on the card at 1440 and 390. Live: give B its own thumbnail and caption on sidneylaruel | today's card height (owner rule: a collapsed card keeps today's height); the Sheet fit (`sheet_fit_v1`) |
| 6 | Review page: the version strip, the version's thumbnail and caption, Approve covers all parts, a change picks its part. **Waits for Trialchange's Safari fix to merge** | review-stage tests: approving every version calls today's approve on video, thumbnail and caption once each; a thumbnail change reaches the graphic part. Live: walk SMM, Kasper and the client link on sidneylaruel at 1440 and 390 | the review boards (largest risk; section 6) |
| 7 | Production: the graphic sub-issue shows one thumbnail row per version (mirror of `245`) | Production browser test with mocks | Production's Assets rows |
| 8 | Flag on for all clients after one clean day; docs (`TRIAL_REELS_PLAN.md`, `INSTAGRAM_UPLOAD.md`, OPEN_REPAIRS entry) | the watcher's read of refusals for a day | nothing new |

PRs 2 and 3 can run in parallel. 4 needs 3. 5 needs 1. 6 needs 5. 7 is optional (see section 7).

---

## 6. What could break elsewhere

- **The review boards (Kasper's and the client's).** The biggest risk: an approve that counts wrong moves a card to
  Approved too early or never. Guard: the function stays the only judge of "every live version has this OK"; the page
  calls today's approve only when the function says so. A failed versions read always falls back to today's page,
  never to a half-trial page (today's rule, `194-review-trial-versions.js.part:23`).
- **The status sync and the drift robot.** Untouched by design: no version writes `video_status`, `graphic_status` or
  `caption_status`; only today's saves do. A thumbnail change on a version goes through today's graphic tweak path,
  so the graphic sub-issue and the card stay in step.
- **The card's caption and thumbnail.** Only the winner pick and its Undo write them, through `calendar-card-write`.
  A stale-save check already exists there; the winner write sends the card's `updated_at`.
- **Sheet copies.** The calendar card stays one card; versions never reach a Sheet. The roster copies are unrelated.
- **The Production tab.** Versions stay inside the card's sub-issues; no new work items, so Workload, Today and the
  drift robot count the same.
- **Posting (Postplan's area).** A posted card carries the card's fields, i.e. the winner's once picked. Posting a
  trial version needs that version's video, thumbnail and caption: the `effective` read gives them in one call. After
  a trial post, marking the version "on trial" automatically is a meeting point with `posting.md`.
- **Agreed with Postplan (`posting.md`, PR 2522).**
  - A version's three fields live in `studio_trial_versions`: `frame_url`, `thumbnail_url` and `caption`, keyed by
    (client, post_id, letter). The rule for empty is: `coalesce(version.thumbnail_url, card.thumbnail_url)`, and the
    same for the caption. For version A, the card's own fields win, because A is the card. Postplan's `post-source`
    may read the table server side (service role) with that rule, or call trial-reels `read` for its `effective` set.
    Either gives the same answer, and the function's tests pin the rule.
  - Trial versions post to Instagram only. The winner then goes to the other networks, with Instagram unticked.
    Marking versions "on trial" stays as today (the card set to Posted). No disagreement.
  - There is one matcher, the Frame one. It does not take a dropped local folder, because a version's video must be
    a Frame link (the review boards play it from Frame). Local files are a Post tab source only.
  - **One overlap to sequence:** my PR 3 changes `frameio-view/logic.mjs` (a new list part, plus the share lookup fix). `post-source` reuses that file. Whichever lands second rebases. Postplan's `post-source` already refuses an inexact file match on
    its own, so it is safe before the fix lands.
- **Rate limits.** The import adds one Frame listing per click, staff only. The strip adds one thumbnail image per
  version, no extra function reads.

---

## 7. What to cut (for now)

- **Production's per-version thumbnail rows (PR 7).** The card and the review page already show them; designers can
  work from the card for a few weeks.
- **Thumbnails picked from the Frame folder.** v1 imports videos only; thumbnails stay links, as on today's card.
  Easy to add later to the same list.
- **Paging past 50 videos, and Frame project (non-share) folder links.** Rare; a clear message covers them.
- **A side-by-side "Compare" mode at 1440.** The strip covers most of it. Revisit after Kasper has used it.
- **Per-version title, CTA or alt caption.** Not asked for; Alternative 1 would be needed.

---

## 8. Questions for Sidney (a "yes" takes the recommendation)

1. **Can the SMM's "Approved (client told me)" skip Kasper's step for that version?** Recommended: yes, and every board
   shows "by SMM" under it, and it is logged with the SMM's name.
2. **Is version A the card itself** (its thumbnail and caption are the card's), with B, C... having their own, and empty
   meaning "same as the card"? Recommended: yes.
3. **On the review page, one version at a time with a strip of version thumbnails on top** (not three players side by
   side)? Recommended: yes, for both desktop and phone.
4. **Does one Approve cover the whole version** (video, thumbnail and caption together), while a change is asked on one
   part? Recommended: yes.
5. **The Frame import adds videos only, from a share link, up to 7 versions;** thumbnails stay links for now?
   Recommended: yes.

---

## 9. Size

8 pull requests (7 if PR 7 is cut). About 9 to 11 working days, including the live walks on the test client at both
widths, and a day with the flag on for all clients before the closing docs PR. Sidney runs nothing; Lighthouse applies
one migration.

---

Skills: the requested karpathy-guidelines, frontend-design, interface-design, Hallmark, Emil Kowalski and taste-skill
are not installed in this session. Their principles were applied by hand: measure first, the smallest change that
does the job (reuse the existing versions table and function), a check for every step, and the house UI rules above.
