# Trial reels in SyncView: plan (session Trials, 2026-10-26)

**Status: plan only. Nothing is built, nothing is switched on, nothing is merged.** The supervisor shows this to the
owner before any building starts. OPEN_REPAIRS 513.

The owner approved trial reels on 2026-10-26: one video, versions A to G that differ in the text hook, every version
posted as an Instagram trial reel, and the winner kept after 24 h. This plan covers the SyncView part: the switch on a
calendar card, the versions on the card and its production task, the review, and the log.

The studio half is PR #2349, **merged to main on 2026-10-26 at 21:10 UTC (7cb60ad) without the changes this plan asks for**: the connector's `studio_action "trial_reels"` (steps `guide`, `log`, `list`, `update`)
and its table `studio_trial_versions`. Section 3 says how the two fit.

Mockups (round 2, after the owner looked at the round 1 card on 2026-10-26; see section 0b):
- **On today's real page**, in `trial-reels/real/`, light and dark, 1440 and 390. Two scripts build today's page, open
  it with fictional offline data and load `real/preview.js`, which adds only the trial-reels parts:
  - `make-screenshots.js`: the staff card `card-<state>-<width>-<theme>.png` for the states `today` (no preview),
    `off`, `review`, `review-open`, `trial`, `due`, `due-open`, `winner`, `winner-open`; and the Production sub-issue
    `prod-<today|review|winner>-…png`, every state in dark and light.
    The script fails if a collapsed card is not today's height (all equal: 770 px at 1440, 1002 px at 390), if any
    label it adds reads below 4.5:1 against what is behind it, or if the version rows' link, availability and Edit
    columns do not line up.
  - `make-notes-screenshots.js`: the Notes view with the real player, `notes-<A|C>-<width>-<theme>.png`. The player
    and the Frame.io comments are really read from that version's link.
- **Review, Kasper and the winner pick:** [`trial-reels/mockups.html`](trial-reels/mockups.html) (interactive, one shared
  state) and its pictures `trial-reels/mock-*.png`. The owner approved the client review (1440 and 390) and Kasper's view
  on 2026-10-26; round 2 only removed the hook text from them.
- Today's review pages, from the offline browser tests (fictional fixtures): `trial-reels/current/*.png`.

---

## 0. The owner's decisions (pipelines plan, "Decisions after v2", 2026-10-26), folded in

- Build and test on the test client first; no real client until the owner has tried it.
- Every version is posted as a trial, so **the client approves each version** ("Approve this version" and "Approve all").
- Proven hooks come from Sandcastles and the client's own best reels (Virlo skipped). Studio side only.
- **One card per video, with its normal status.** Each version has its own label: waiting, approved, change asked,
  dropped, on trial, winner, lost. **The card moves to Approved once every version is approved or dropped** (and at
  least one is approved: owner answer, Q4). **A change on one version sends only that one back.**
- **After posting:** each version is "on trial" with a **24 h timer, shown on the card** as a reminder. **No numbers
  are typed** (owner, Q7): after the trial **the SMM simply picks the winner** (Q6); the others become lost. **The
  winner posts on the card's calendar date and the card turns Posted.** The client sees only the winner, once it is
  picked (Q8).
- **Only the team can drop a version** (Q2). **A changed version takes the normal route**: the SMM and Kasper again
  before the client (Q3). **The client link works like today, with no token** (Q5). **The SMM always picks one**, so
  SyncView has no "no clear winner" (Q10).
- **Frame.io links are pasted by people** (Q9): the person who uploads each version to Frame.io pastes its link into
  that version's row on the card, the same way the single Video link is filled today. The studio writes no links.
- **Production: one task with a list of versions.**
- **Log in Supabase, one row per version, with its label. The SMM posts by hand.**

## 0b. Round 2: the owner's look at the card (feedback-expansion, 2026-10-26)

The owner's words (condensed): collapsed by default and expandable; a subtle switch in the empty space of today's Video
row, before its pencil; no hook text, just "Video A", "Video B", "Video C"; switch versions in the player and Notes when
there is more than one link; the card keeps its height, so no new rows (no "Winner: version C" row; the Video row just
says "Video C"); and how the Production/SyncLinear Assets look.

**Rules** (each one sentence, swept across every trial-reels surface):

| # | Rule | Where it applies (sweep) | Outcome |
|---|---|---|---|
| R1 | A list of versions on the card is collapsed by default and opens from the Video row's small arrow | staff card 1440 and 390 | built in the mockups. Production is not collapsed: each version is its own Deliverable file row (owner, decision 6) |
| R2 | A collapsed trial card is exactly today's height: the switch, the count, the timer and the winner live inside today's Video row | card in every state (off, review, on trial, pick the winner, winner), 1440 and 390, light and dark | built; measured by the script (16 of 16 equal) |
| R3 | A version is named by its letter only ("Video A"), never by its hook text | card, Production, Notes (title, topic switch, version switch), client review ("Video B of 5"), Kasper's tiles, the winner pick | built; client and Kasper are an owner call (decision 1) |
| R4 | The winner takes the one link slot: the card's Video row reads "Video C" and opens its link, the Production Deliverable file is the winner's link | card, Production, the client page after the pick | built |
| R5 | With more than one version link, the player has a version switch and the Frame.io comments follow the version on screen | Notes view 1440 (under the player, beside Open in Frame.io) and 390 (a slim bar under the player); the client review already has its letter dots | built; Notes really reloads the version's link |
| R6 | With the switch off, the card is today's card plus a faint switch in the Video row; on, the switch takes the row's own muted tone, never a bright fill | card 1440 and 390 | built (`card-off-*`) |
| R7 | Every label the trial adds reads at 4.5:1 or more in both themes; muted labels (waiting, dropped, lost) use today's N/A pill | card and Production, dark and light | built; measured by the script |

**Sweep inventory** (surface × what the rules change):
- **Staff card, Sheet (1440) and the phone card (390):** Video row "Video · 5" + tiny state ("2/4 approved", "On trial ·
  17 h left", "Pick the winner", or "Video C ★ winner"), the switch and a chevron inside the row; open: "Video A…E" rows
  with link, label, "Paste the Frame.io link" for a version with no link, a trophy icon ("Make this the winner") once the 24 h are up.
- **Month, Week and the phone grid tiles:** unchanged (owner call, decision 3).
- **Notes view (staff, from the Notes button, the Sheet play icon and the Review tab):** version switch, the version in
  the title ("… · Video C") and in the note topic ("About the… Video C"); a note or change written there is about that
  version. Opens on the winner if there is one, else Video A.
- **Client review (layout C) and the SMM's Review tab:** "Video B of 5" with letter dots, no hook line; after the pick,
  only the winner ("Video C: the one we are posting").
- **Kasper, layout 2:** tiles named "Video A…E" with Approve, change and drop; **layout 1:** the client page's arrows.
  Not collapsed: they are review surfaces where every version must be seen (decision 4).
- **Production sub-issue Assets (1440 and 390):** today's single Deliverable file row becomes one row per version,
  "Deliverable file · Video A" to "· Video E", each with today's Edit, today's availability state (Available, Missing…)
  and the version's label; the version that is the card's link today is marked "on the card" (Video A, then the
  winner). Every column lines up across the rows (measured by the script). **The Production list rows are unchanged.**

**What the Production page and Section 4 carry today (read from the code):**
- The sub-issue's Assets panel (`src/index/240-production-description.js.part`, `_prodAssetsPanelHTML`) has four slots:
  Filming plan, Raw footage, Frame folder (these three live on the batch) and Deliverable file, which is
  `deliverables.file_url`, read through `production-write` `asset_access_read` and written through its `attachment`
  operation.
- `attachment` (RPC `production_artifact_write`, `migrations/2026-09-05-artifact-card-binding-first.sql`) projects a
  video `file_url` onto `calendar_posts.asset_url` of the card bound by `video_deliverable_id`. The projection is one
  way: a card link edit does not write `file_url`.
- The drift robot (`scripts/card-calendar-status-drift-check.js`) compares statuses only; it reads neither link.
- `asset_access_read`, which checks each link's sharing (the Available / Missing state), lives inside `production-write`;
  nothing in `_shared` holds it.

**One store per version, both directions (owner, decision 6, 2026-10-26).** "The link from a card is always connected
to the asset grid": a version's link pasted on the card shows in Production Assets, and one pasted in Assets shows on the
card, as today's single link does.
- **Every version's link lives once, in `studio_trial_versions.frame_url`.** The card's version rows and the Production
  "Deliverable file · Video X" rows both read it and both write it through `trial-reels` `version_link_set`, with the
  same permission as today's Production attach (the same role and team rule, checked by the function).
- **The card's one link stays today's one link.** `deliverables.file_url` (and, through the existing projection,
  `calendar_posts.asset_url`) always holds the link of the version that is "on the card": Video A until a winner is
  picked, then the winner. It is written only through today's `production-write` `attachment` operation (or today's
  card link save for a card with no video sub-issue).
- **Editing Video A's row (while A is on the card):** `trial-reels` first calls the existing `attachment` operation with
  the caller's own staff credentials, so `file_url` and `asset_url` take the new link as they do today; only when that
  answers ok does it write `frame_url` for A. If `attachment` refuses, nothing changes and the row shows the refusal. If
  the second write fails, the main link is already right and the row retries the copy. For the version on the card, the
  page always shows `file_url` (what the card and Production really carry), so the screen can never show two links
  that disagree, and `read` flags `main_copy_behind` if the copy lags. Editing any other version's row touches only its
  `frame_url`.
- **Picking the winner** copies the winner's `frame_url` into `file_url` through the same `attachment` call; Video A's
  link stays in its own `frame_url`.
- **Availability state per version row.** `trial-reels` carries its own copy of the Frame.io sharing check (the probe in
  `production-write` cannot be moved to `_shared` without changing a Section 4 function), and answers each version's
  state in `read`.
- **What does not change:** the drift robot (it compares statuses only), the Section 4 three and their fingerprints in
  `deploy-f27-section4-closures.yml` (`attachment` and `asset_access_read` are called as they are today), and the
  projection RPC `production_artifact_write` and its triggers. **No Section 4 change and no re-pin.**

**Owner decisions from this round (answered 2026-10-26, about 22:35 UTC):**
1. No hook text on the client review or Kasper's views ("Video B of 5"). **Yes.**
2. The faint switch is always visible on the Video row of the test client's cards. **Yes.**
3. Month, Week and phone grid tiles stay unchanged. **Yes.**
4. Kasper's second layout shows every version side by side. **Yes.**
5. A note written while Video C is on screen is about Video C. **Yes.**
6. **Changed by the owner:** each version is its own Deliverable file row in Production Assets, with Edit, and a link
   pasted on either side shows on the other (one store per version; see "One store per version" above).
7. Clicking the collapsed Video row opens the video (the winner's once picked); the small arrow opens the list. **Yes.**

## 1. What exists today (read from the code)

- A card is one row in `calendar_posts` keyed by (client, id), almost all `text`. The video is one link,
  `asset_url`; the video part's state is `video_status`, `video_tweaks`, `client_video_approved_at`, plus Kasper's
  columns. There is no jsonb column and no notion of versions on a card.
- A production task is one row in `deliverables` (`file_url` is its link), tied to the card by `card_id` + origin and
  by `calendar_posts.video_deliverable_id`. The status bridge trigger maps the task's status onto `video_status`; the
  hourly drift robot (`card-calendar-status-drift.yml`) compares the two.
- `calendar-card-write` copies only the fields in its `ALLOWED` list. `calendar-upsert` (the client review link's
  writer) has the same list and is **frozen**. `production-write`, `deliverable-write` and `batch-write` are the
  Section 4 three, fingerprint-pinned.
- The review page (`src/index/195-review-stage.js.part`) builds a card's steps from its parts (`_rsModel` /
  `_rsCompsOf`), and every button calls the old page's own save: `_calReviewApprove`, `_calReviewRequestTweak`
  (client, SMM), `_kasperApproveComp`, `_kasperRequestTweakComp` (Kasper).
- The connector's `video_cards` already resolves a (batch, video number) to its deliverable and its card
  (`higgsfield-mcp/videocards.mjs`), so the studio can know which card a version belongs to.

## 2. Data model

**One table holds the per-version rows: `studio_trial_versions` from #2349. It is the source of truth.** SyncView does
not add a second versions table or a second log. The card and the deliverable get no new columns (a new card column
would have to enter `ALLOWED` in `calendar-card-write` and in the frozen `calendar-upsert`; a new task field would
mean a Section 4 change and a re-pin).

### `studio_trial_versions` (#2349), and what SyncView needs added to it

Already in #2349: `id`, `client`, `batch`, `video`, `letter` (A to G), `hook`, `hook_type`, `other_change`,
`status`, `posted_at`, `views`, `watch_time_s`, `shares`, `saves`, `follows`, `member`, `created_at`, `updated_at`;
unique (client, batch, video, letter); row level security on; only `service_role` holds SELECT, INSERT, UPDATE.
The five number columns stay in the table unused by SyncView (owner, Q7: no numbers are typed).

Columns SyncView needs. #2349 is merged without them, so **SyncView's build PR carries a follow-up migration** that adds them:

| column | type | why |
|---|---|---|
| `post_id` | text, null | the calendar card this version belongs to; the studio fills it from `video_cards` at `log` time |
| `deliverable_id` | uuid, null | the production task, for its list of versions |
| `frame_url` | text, null | the version's Frame.io link, **pasted on the card by whoever uploads that version** (Q9), played on the review stage |
| `smm_ok_at`, `kasper_ok_at`, `client_ok_at` | timestamptz, null | each reviewer's OK on this version |
| `change_by`, `change_note`, `change_at` | text, text, timestamptz | the last change asked on this version |
| `revision` | int, default 0 | goes up when the link or hook is replaced; resets the three OKs and the status to `waiting` |
| `trial_ends_at` | timestamptz, null | `posted_at + 24 h`; drives the reminder timer on the card |

Plus an index on (client, post_id). The status words stay #2349's exactly: `waiting`, `approved`, `change asked`,
`dropped`, `on trial`, `winner`, `lost`. #2349's extra `no clear winner` stays allowed in the table but SyncView never
sets it and the studio cannot set it on a row linked to a card (owner, Q10: the SMM always picks one).

### `trial_reel_cards`: the card's switch (new, SyncView only)

| column | type | notes |
|---|---|---|
| `client`, `post_id` | text | primary key; same pair as `calendar_posts` |
| `enabled` | boolean | the card's "Trial reels" switch; off keeps the versions and hides them |
| `winner_letter` | char(1), null | copied when the SMM gives the badge |
| `created_at`, `updated_at`, `updated_by` | | |

Same privileges as #2349's table: row level security on, `revoke all ... from public, anon, authenticated,
service_role`, then `grant select, insert, update ... to service_role`, with the same read-back assertion. The browser
key reads neither table; every read goes through an Edge Function. No new public read.

**Migrations.** The build PR adds one migration that does both: `alter table public.studio_trial_versions add column
if not exists ...` for the columns above, and `create table public.trial_reel_cards`. It must run **after**
#2349's `20261026200000_studio_trial_versions.sql`, which is marked `functions-cope-without-this` and may not be
applied yet; the new file stops with a plain error if `to_regclass('public.studio_trial_versions')` is null, so
Lighthouse applies the two in order. It holds `trial-reels` and `higgsfield-mcp` on merge until applied, and says how to
tell it is applied: `to_regclass('public.trial_reel_cards') is not null` and `post_id` present in
`information_schema.columns` for `studio_trial_versions`. The added columns are all nullable or defaulted, so rows the
studio has already logged stay valid, and #2349's grant assertion (service_role holds exactly SELECT, INSERT, UPDATE)
still holds.

## 3. How the studio half (#2349) and the SyncView half fit

| | studio (`higgsfield-mcp`, #2349) | SyncView (new `trial-reels` function) |
|---|---|---|
| creates version rows (letter, hook, hook family) | **yes**, `log`, with `post_id` and `deliverable_id` (after the build PR) | no |
| the Frame.io link of a version | **no** (Q9) | **yes**: pasted on the card by whoever uploads that version |
| a new hook after a change is asked | `log` with `"replace": true` for that letter (build PR; today refused as duplicate) | no |
| review answers (`approved`, `change asked`, `dropped`) | **no** once `post_id` is set | **yes** |
| `on trial`, `winner`, `lost` | `update` still allowed (for studio-only trials and as a fallback) | **yes**, from the card |
| card status | never | never directly; the page calls today's saves |

**One log, one table.** `studio_trial_versions` is the one log: one row per version, with its label. SyncView adds no
second versions table and no results table (the first draft's results table is gone, Q7).

**Clashes, still open on main after #2349 merged** (each is fixed in the build PR, below):

1. **The studio's `update` can set any status**, including `approved`, which would skip the client's OK.
2. **A new cut of one version.** `log` refuses a letter that is already logged, so a new hook after a change is asked
   has no way back in.
3. **Identity.** #2349 keys a version by (client, batch, video, letter); SyncView keys a card by (client, post_id).
   `post_id` bridges them. A version logged without it is invisible in SyncView.
4. **Two writers, one row.** Both functions update with the service role. Each update names only its own columns, and
   SyncView's writes check `updated_at` (stale-save refusal, as the Calendar does), so the last writer cannot silently
   undo the other.
5. **Status words.** SyncView uses #2349's spelling (`change asked`, with a space).

### What the studio function needs (the AI editor lane's follow-up PR)

Three small changes to `supabase/functions/higgsfield-mcp/trialreels.mjs` (and its row handling in `index.ts`), with
`test/higgsfield-trial-reels.js` extended for each:

1. **`update` cannot set `approved`, `change asked`, `dropped`, `waiting` or `no clear winner` once a row has a
   `post_id`.** It still sets `on trial`, `winner` and `lost`. Rows with no `post_id` (studio-only trials) keep today's
   behaviour.
2. **`log` can replace a letter's hook after a change is asked.** `"replace": true` on a row whose status is
   `change asked` overwrites `hook`, `hook_type` and `other_change`. Replace on any other status is refused with a plain
   reason ("version C is approved; only a version with a change asked can be replaced"). The version goes back to
   `waiting` when the new cut's Frame.io link is pasted on the card (below), not when the hook is logged.
3. **`post_id` and `deliverable_id` are taken at `log` time.** The guide's step 8 changes from "not wired yet" to: run
   `review_notes` / `video_cards` for the video and copy its card id and task id onto every row; the Frame.io links are
   pasted on the card by whoever uploads the versions. A row logged without `post_id` is accepted (permissive,
   AGENTS.md) and the answer says it will not show in SyncView until linked.

**Who carries them (updated 2026-10-26):** the AI editor lane, in its own follow-up PR, once the schema below is fixed
(the supervisor's routing; it supersedes this plan's earlier "SyncView's build PR" line). Either merge order is safe:
- the guard (1) applies only to rows with a `post_id`, and only the studio's `log` (change 3) ever sets one, so no row
  is linked to a card before the guard exists;
- if the studio PR lands before SyncView's migration, `log` must drop `post_id` and `deliverable_id` when the columns
  are missing (as it already copes with a missing table), and the rows link once the migration is applied.
The studio lane follows `docs/ops/HIGGSFIELD_CONNECTOR_LESSONS.md` and makes one real cheap call on the live connector
after its deploy (`studio_action "trial_reels"` step `list` on the test client). `higgsfield-mcp` is not a Section 4
function, so no re-pin. The studio never writes `frame_url` (people paste the links).

### The settled schema (for both lanes)

Added to `public.studio_trial_versions` by SyncView's migration (all nullable or defaulted; #2349's columns unchanged;
service_role keeps exactly SELECT, INSERT, UPDATE; no browser role gets anything):

| column | type | written by |
|---|---|---|
| `post_id` | text, null | studio `log` (from `video_cards`) |
| `deliverable_id` | uuid, null | studio `log` (from `video_cards`) |
| `frame_url` | text, null | `trial-reels` only (`version_link_set`, from the card or Production) |
| `smm_ok_at`, `kasper_ok_at`, `client_ok_at` | timestamptz, null | `trial-reels` only |
| `change_by`, `change_note`, `change_at` | text, text, timestamptz, null | `trial-reels` only |
| `revision` | integer, not null, default 0 | `trial-reels` only (a new link after a change is asked) |
| `trial_ends_at` | timestamptz, null | `trial-reels` only (`trial_start`) |

Plus `create index studio_trial_versions_post_idx on public.studio_trial_versions (lower(client), post_id)`.
`status` keeps #2349's words; SyncView writes `waiting`, `approved`, `change asked`, `dropped`, `on trial`, `winner`,
`lost`, never `no clear winner`. The number columns (`views`, `watch_time_s`, `shares`, `saves`, `follows`) stay unused
by SyncView. New table `public.trial_reel_cards (client text, post_id text, enabled boolean not null default false,
winner_letter text check (winner_letter ~ '^[A-G]$'), created_at, updated_at, updated_by, primary key (client, post_id))`,
same privileges.

## 4. Write path: one new Edge Function, `trial-reels`

Not a Section 4 function, so no fingerprint pin; it deploys through the merge lane. Actions:

| action | who | does |
|---|---|---|
| `read` | staff key, or a client review link for its own client | the card's switch and its versions, for one card or a list of cards. Once a winner is picked, a client link gets **only the winner** (Q8) |
| `switch_set` | staff key | turns the card's switch on or off |
| `version_link_set` | staff key, with the same role and team rule as Production's attach | pastes a version's Frame.io link from the card's version row or Production's "Deliverable file · Video X" row (Q9, decision 6). For the version on the card it goes through `attachment` first (see "One store per version"). On a version with a change asked, a new link bumps `revision`, clears the three OKs and the change fields, and sets `waiting`, so it goes the normal route again (Q3) |
| `version_drop` / `version_restore` | staff key | `dropped`, or back to `waiting` |
| `answer` | staff key (SMM, Kasper) or the client review link, with no token, as today (Q5) | `approve`, `change` (with a note), `approve_all`; stamps the role's `*_ok_at`; returns `stage_done: true` when every non-dropped version has this role's OK |
| `trial_start` | staff key | every `approved` version becomes `on trial`, stamps `posted_at` and `trial_ends_at` |
| `winner_set` | staff key (the SMM) | that version `winner`, the other trial versions `lost`; copies the letter onto the switch row |

- **The page switch** `trial_reels_pages` in `syncview_runtime_flags`, `{ "clients": [the test client] }`, read with
  the review-stage switches and failing closed. The function reads the same row and refuses every write for a client
  it does not list (`403 not_enabled`). Not named `..._clients`, because several browser tests answer every `_clients`
  key with "on".
- Every refused write reports to the write-refusal log (`_writeUiRecordFailure`), like the Calendar.
- Every write appends to `calendar_post_events` with `component = 'video'` and the letter in `payload`, so the card's
  history shows "Video C: change asked".

**How it fits `calendar-card-write` and `production-write` without a Section 4 change:** neither is changed. The card
keeps one ordinary `asset_url` and the task one ordinary `file_url`, so Production, the status bridge, the drift robot
and the connector's `video_cards` see a normal card. When the SMM picks the winner, the page sets the winner's link
through **`production-write`'s existing `attachment` operation** when the card has a video sub-issue (it writes
`file_url` and projects it onto the card's `asset_url`), or through today's staff card link save when it has none, so
the post that goes out on the calendar date, the Production Deliverable file and every reader after it carry the
winner (section 0b). Until then the one link is Video A's, pasted the usual way.

## 5. Status rules and review

**The card keeps its normal status.** Versions never write `video_status`. The page calls the old part-level save when
a stage is finished, so every existing rule, notification and sync runs unchanged:

| stage | per version | when every non-dropped version has it, the page calls |
|---|---|---|
| SMM (Review tab, before Kasper) | `smm_ok_at` | today's SMM "Approve to Kasper" on the video part |
| Kasper (Review Session) | `kasper_ok_at` | `_kasperApproveComp('video')` |
| Client (review link) | `client_ok_at`, status `approved` | `_calReviewApprove` on the video part: the card moves to Approved |

- **Approved** needs no version waiting and at least one approved (owner, Q4). All dropped: the card stays where it is.
- **A change on one version** sends today's change request on the video part, starting "Video C:". The card goes to
  Tweaks Needed as today and the editor works as today. When the new cut's link is pasted, only C loses its OKs and goes
  back to `waiting`; it then takes **the normal route, the SMM and Kasper again before the client** (Q3). The card comes
  back through For SMM Approval and Kasper Approval as today; each stage stops only on the versions that lack that
  reviewer's OK, and the other versions keep their answers.
- **Dropped** versions are skipped by every stage and by the "every version" count. **Only the team can drop** (Q2); the
  client page has no drop button.
- **The stage (195).** On a card with the switch on, for a client the page switch lists, `_rsCompsOf` replaces the
  `video` part with a `versions` part: today's player (`svFrameStageMount`) for the version on stage, arrows on each
  side (and ← → keys), swipe on a phone, "Video B of 5" with a row of letter dots carrying each version's answer
  (no hook text, decision 1), and "Approve this version", "Ask for a change", "Approve all". Thumbnail and caption steps stay.
  "Finish reviewing" counts versions.
- **Kasper's second layout** shows every version side by side ("Video A"…, Approve, change, drop on each), with "Approve all"
  at the top. His first layout gets the same arrows as the client page.

**After approval: the trial, the timer and the winner.**
- The SMM posts every approved version as a trial reel by hand, then presses **"Mark approved as on trial"**: each goes
  `on trial` with `trial_ends_at` 24 h later.
- **The card shows the timer as a reminder, inside its Video row**: "On trial · 17 h left", then "Pick the winner"
  once 24 h has passed (no new row, R2). The card's status stays Approved, then Scheduled as today.
- **Where the winner is picked (owner, 2026-10-26 about 22:40 UTC: findable without opening anything):** once the 24 h
  are up, the collapsed Video row's state is itself a small **"Pick winner"** button (with a trophy). Pressing it opens
  the versions list with a small trophy icon button on each version on trial, the size of the row's other icons, in
  the row's muted tone, with the tooltip, title and aria-label "Make this the winner" (owner, about 22:50 UTC: an icon,
  not text). A checkmark was the owner's first idea; it already means "approved" on these surfaces, so the trophy is
  the default and `card-due-open-check-1440-*` shows the checkmark for comparison. On a phone (no hover) a tap turns the
  row into a one-line confirm, "Make Video C the winner?" with Yes and Cancel (`card-due-confirm-390-*`). Pictures:
  `card-due-*` collapsed, `card-due-open-*` opened. It
  sits inside the row, so the card keeps today's height (measured). **Staff only:** the staff card and the phone staff
  card show it, and the SMM and Kasper can press it; the client link never shows it, and `trial-reels` refuses
  `winner_set` from a client link.
- **No numbers are typed** (Q7). After the trial the SMM presses the trophy ("Make this the winner") on one version: that one is
  `winner`, the others `lost`, and the card's link becomes the winner's (above).
- **The client sees only the winner, once it is picked** (Q8): the review link shows "Video C: the one we are posting"
  with the winner's video, and none of the other versions.
- **The winner posts on the card's calendar date and the card turns Posted** through today's Posted path, unchanged.
- The production task's Assets show one "Deliverable file · Video X" row per version, each editable, and the one that
  is on the card (Video A, then the winner) is the task's `file_url` (section 0b).

## 6. The switch: the test client only

- The page switch `trial_reels_pages` lists only the test client. Missing, unreadable or any other shape: no switch on
  the card, no versions, today's page everywhere.
- The card switch shows only on that client's cards, and only to staff.
- The function refuses writes for any client the flag does not list, so a stale page cannot write elsewhere. The
  studio's own rule (#2349's guide: "test client only until Sidney says otherwise") matches.
- Rolling out to a real client is a separate owner decision and a one-line flag change.

## 7. Risks

1. **Two saves for one answer.** The version answer saves to `studio_trial_versions`; the card's approval is the old
   save after it. If the page dies between the two, the versions say "done" and the card does not. Mitigation: `read`
   returns `card_behind: true` and the stage offers the old save again on the next open; a nightly check lists such
   cards.
2. **The client's link stays tokenless** (owner, Q5, as for `calendar-upsert` since 2026-07-15). The new function
   accepts client answers the same way. Narrowed by the switch (test client only) and by answering only versions of that
   client's own cards.
3. **Two writers on one table** (clashes 1 and 4 above). Settled by narrowing the studio's `update` and by stale-save
   checks.
4. **Notifications.** One change request per changed version could send several review pings. Each sends what one change
   request sends today; "Approve all" sends one approval.
5. **Seven players on Kasper's page.** Only the version on stage loads its video; the others show posters.
6. **The winner's link swap** is an ordinary staff link edit, so it is subject to today's link guards (duplicate link,
   link clobber). It must happen before the calendar date, or version A's link posts. The card shows "Pick the winner"
   until it does.
7. **The trial posting itself** happens on Instagram by hand; SyncView cannot see a version posted that was not
   approved.

## 8. Out of scope

- Posting to Instagram (the SMM posts by hand), and any trial numbers (none are typed or read, Q7).
- Any studio write of Frame.io links (people paste them, Q9).
- Making the versions and the hooks (the studio, #2349 and the pipelines plan).
- Thumbnails or captions per version (one of each per card).
- Samples, YouTube titles, and every client other than the test client.
- Any change to `calendar-upsert`, `calendar-card-write`, the Section 4 three, or any n8n workflow.

## 9. Owner answers (2026-10-26)

- Q1: "Decisions after v2", folded in above.
- Q2: only the team can drop a version.
- Q3: a changed version takes the normal route (the SMM and Kasper again before the client).
- Q4: Approved when no version is waiting and at least one is approved.
- Q5: no token; the client link works like today.
- Q6 and Q7: no numbers typed; after the trial the SMM simply picks the winner. The results table and the "most views
  suggested" idea are gone; the 24 h timer chip stays as a reminder.
- Q8: the client sees only the winner, once it is picked.
- Q9: whoever uploads each version to Frame.io pastes its link into that version's row on the card; no studio write of
  links.
- Q10: the SMM always picks one; no "no clear winner" on the SyncView side.

**Next:** the owner has answered the seven decisions in section 0b. No building until he says go.
