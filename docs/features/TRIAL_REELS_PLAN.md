# Trial reels in SyncView: plan (session Trials, 2026-10-26)

**Status: plan only. Nothing is built, nothing is switched on, nothing is merged.** The supervisor shows this to the
owner before any building starts. OPEN_REPAIRS 513.

The owner approved trial reels on 2026-10-26: one video, versions A to G that differ in the text hook, every version
posted as an Instagram trial reel, and the winner kept after 24 h. This plan covers the SyncView part: the switch on a
calendar card, the versions on the card and its production task, the review, and the log.

The studio half is PR #2349, **merged to main on 2026-10-26 at 21:10 UTC (7cb60ad) without the changes this plan asks for**: the connector's `studio_action "trial_reels"` (steps `guide`, `log`, `list`, `update`)
and its table `studio_trial_versions`. Section 3 says how the two fit.

Mockups: [`trial-reels/mockups.html`](trial-reels/mockups.html) (interactive, one shared state across five views).
Still pictures: `trial-reels/mock-*.png`. Today's page, from the offline browser tests (fictional fixtures):
`trial-reels/current/*.png`.

---

## 0. The owner's decisions (pipelines plan, "Decisions after v2", 2026-10-26), folded in

- Build and test on the test client first; no real client until the owner has tried it.
- Every version is posted as a trial, so **the client approves each version** ("Approve this version" and "Approve all").
- Proven hooks come from Sandcastles and the client's own best reels (Virlo skipped). Studio side only.
- **One card per video, with its normal status.** Each version has its own label: waiting, approved, change asked,
  dropped, on trial, winner, lost. **The card moves to Approved once every version is approved or dropped** (and at
  least one is approved: owner answer, Q4). **A change on one version sends only that one back.**
- **After posting:** each version is "on trial" with a **24 h timer, shown on the card**; the SMM enters the numbers;
  the **SMM gives the winner badge, with the highest-views version suggested** (owner answer, Q6); the others become
  lost. **The winner posts on the card's calendar date and the card turns Posted.**
- **Production: one task with a list of versions.**
- **Log in Supabase, one row per version. The SMM posts by hand.**

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

Columns SyncView needs. #2349 is merged without them, so **SyncView's build PR carries a follow-up migration** that adds them:

| column | type | why |
|---|---|---|
| `post_id` | text, null | the calendar card this version belongs to; the studio fills it from `video_cards` at `log` time |
| `deliverable_id` | uuid, null | the production task, for its list of versions |
| `frame_url` | text, null | the version's Frame.io link, played on the review stage (#2349's guide step 8 says this is "not wired yet") |
| `smm_ok_at`, `kasper_ok_at`, `client_ok_at` | timestamptz, null | each reviewer's OK on this version |
| `change_by`, `change_note`, `change_at` | text, text, timestamptz | the last change asked on this version |
| `revision` | int, default 0 | goes up when the link or hook is replaced; resets the three OKs and the status to `waiting` |
| `trial_ends_at` | timestamptz, null | `posted_at + 24 h`; drives the timer on the card |
| `suggested` | boolean, default false | set on the highest-views version once every trial version has numbers |

Plus an index on (client, post_id). The status words stay #2349's exactly: `waiting`, `approved`, `change asked`,
`dropped`, `on trial`, `winner`, `lost`, and #2349's extra `no clear winner` (SyncView shows it as a plain grey label;
see Q10).

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
| creates version rows | **yes**, `log` (with `post_id`, `deliverable_id`, `frame_url`, after the build PR) | no, only reads them |
| replaces a link or hook | `log` with `"replace": true` for that letter, after a change is asked (build PR; today refused as duplicate) | no |
| review answers (`approved`, `change asked`, `dropped`) | **no** once `post_id` is set (clash 1) | **yes** |
| `on trial`, numbers, `winner` / `lost` | `update` (allowed) | yes, from the card's results view |
| card status | never | never directly; the page calls today's saves |

**One log, one table.** The 24 h numbers live in `studio_trial_versions` (`views`, `watch_time_s`, `shares`, `saves`,
`follows`), whichever side the SMM types them in. This replaces the separate results table of this plan's first draft.

**Clashes, still open on main after #2349 merged** (each is fixed in the build PR, below):

1. **The studio's `update` can set any status**, including `approved`, which would skip the client's OK. Proposal: once
   a row has a `post_id`, `update` accepts only `on trial`, the numbers, `winner`, `lost` and `no clear winner`; the
   review labels come only from SyncView. (A change to `trialreels.mjs`.)
2. **A new cut of one version.** `log` refuses a letter that is already logged. A change asked on version C needs the
   studio to replace C's link and hook: either `log` with `"replace": true`, or `update` taking `frame_url` and `hook`
   (bumping `revision` and resetting the OKs). Without it, a change request has no way back in.
3. **Identity.** #2349 keys a version by (client, batch, video, letter); SyncView keys a card by (client, post_id).
   `post_id` bridges them. A version logged without it is invisible in SyncView (the card shows "versions not linked
   yet"), so the studio should always send it.
4. **Two writers, one row.** Both functions update with the service role. Each update names only its own columns, and
   SyncView's writes check `updated_at` (stale-save refusal, as the Calendar does), so the last writer cannot silently
   undo the other.
5. **Status words.** SyncView uses #2349's spelling (`change asked`, with a space), not the underscore form of the
   first draft.

### What the build PR changes in the studio function, and why it is SyncView's PR

Three small changes to `supabase/functions/higgsfield-mcp/trialreels.mjs` (and its row handling in `index.ts`), with
`test/higgsfield-trial-reels.js` extended for each:

1. **`update` cannot set `approved`, `change asked`, `dropped` or `waiting` once a row has a `post_id`.** It still
   sets `on trial`, the numbers, `winner`, `lost` and `no clear winner`. Rows with no `post_id` (studio-only trials) keep
   today's behaviour.
2. **`log` can replace a letter after a change is asked.** `"replace": true` on a row whose status is `change asked`
   overwrites `hook`, `hook_type`, `other_change` and `frame_url`, bumps `revision`, clears the three OKs and the change
   fields, and sets `waiting`. Replace on any other status is refused with a plain reason ("version C is approved;
   only a version with a change asked can be replaced"), so an approved version cannot be swapped under the client.
3. **`post_id` (and `deliverable_id`, `frame_url`) are taken at `log` time.** The guide's step 8 changes from "not
   wired yet" to: run `review_notes` / `video_cards` for the video, copy its card id and task id onto every row, and
   give each version's Frame.io link. A row logged without `post_id` is accepted (permissive, AGENTS.md) and the answer
   says it will not show in SyncView until linked.

**These belong in SyncView's build PR, not back with the studio lane.** The guard (1) only means something once
`post_id` exists, and `post_id` only exists once the follow-up migration lands, so the migration, the three function
changes and the `trial-reels` reader have to merge together; split across two PRs there would be a window where rows
are linked to cards and the studio can still approve them. The changes are about forty lines in one file. The studio
lane should review that PR and not edit `trialreels.mjs` while it is open. The build session follows
`docs/ops/HIGGSFIELD_CONNECTOR_LESSONS.md` and makes one real cheap call on the live connector after the deploy
(`studio_action "trial_reels"` step `list` on the test client). `higgsfield-mcp` is not a Section 4 function, so no
re-pin.

## 4. Write path: one new Edge Function, `trial-reels`

Not a Section 4 function, so no fingerprint pin; it deploys through the merge lane. Actions:

| action | who | does |
|---|---|---|
| `read` | staff key, or a client review link for its own client | the card's switch, its versions and (staff only) the numbers, for one card or a list of cards |
| `switch_set` | staff key | turns the card's switch on or off |
| `version_drop` / `version_restore` | staff key | `dropped`, or back to `waiting` |
| `answer` | staff key (SMM, Kasper) or the client review link | `approve`, `change` (with a note), `approve_all`; stamps the role's `*_ok_at`; returns `stage_done: true` when every non-dropped version has this role's OK |
| `trial_start` | staff key | every `approved` version becomes `on trial`, stamps `posted_at` and `trial_ends_at` |
| `results_put` | staff key | one version's 24 h numbers; marks the highest-views version `suggested` once every trial version has numbers |
| `winner_set` | staff key (the SMM) | that version `winner`, the other trial versions `lost`; copies the letter onto the switch row |

- **The page switch** `trial_reels_pages` in `syncview_runtime_flags`, `{ "clients": [the test client] }`, read with
  the review-stage switches and failing closed. The function reads the same row and refuses every write for a client
  it does not list (`403 not_enabled`). Not named `..._clients`, because several browser tests answer every `_clients`
  key with "on".
- Every refused write reports to the write-refusal log (`_writeUiRecordFailure`), like the Calendar.
- Every write appends to `calendar_post_events` with `component = 'video'` and the letter in `payload`, so the card's
  history shows "Version C: change asked".

**How it fits `calendar-card-write` and `production-write` without a Section 4 change:** neither is changed. The card
keeps one ordinary `asset_url` and the task one ordinary `file_url`, so Production, the status bridge, the drift robot
and the connector's `video_cards` see a normal card. When the SMM gives the winner badge, the page sets the card's
`asset_url` to the winner's link through **today's staff card save** (an ordinary link edit), so the post that goes out
on the calendar date, and every reader after it, carries the winner.

## 5. Status rules and review

**The card keeps its normal status.** Versions never write `video_status`. The page calls the old part-level save when
a stage is finished, so every existing rule, notification and sync runs unchanged:

| stage | per version | when every non-dropped version has it, the page calls |
|---|---|---|
| SMM (Review tab, before Kasper) | `smm_ok_at` | today's SMM "Approve to Kasper" on the video part |
| Kasper (Review Session) | `kasper_ok_at` | `_kasperApproveComp('video')` |
| Client (review link) | `client_ok_at`, status `approved` | `_calReviewApprove` on the video part: the card moves to Approved |

- **Approved** needs no version waiting and at least one approved (owner, Q4). All dropped: the card stays where it is.
- **A change on one version** sends today's change request on the video part, starting "Version C:". The card goes to
  Tweaks Needed as today and the editor works as today. Only C goes back to `waiting`; the other versions keep their
  answers and are not asked again.
- **Dropped** versions are skipped by every stage and by the "every version" count. Only the team can drop (unless the
  owner says otherwise, Q2).
- **The stage (195).** On a card with the switch on, for a client the page switch lists, `_rsCompsOf` replaces the
  `video` part with a `versions` part: today's player (`svFrameStageMount`) for the version on stage, arrows on each
  side (and ← → keys), swipe on a phone, "Version B of 5", the hook under it, a row of letter dots carrying each
  version's answer, and "Approve this version", "Ask for a change", "Approve all". Thumbnail and caption steps stay.
  "Finish reviewing" counts versions.
- **Kasper's second layout** shows every version side by side (hook, Approve, change, drop on each), with "Approve all"
  at the top. His first layout gets the same arrows as the client page.

**After approval: the trial, the timer and the winner.**
- The SMM posts every approved version as a trial reel by hand, then presses **"Mark approved as on trial"**: each goes
  `on trial` with `trial_ends_at` 24 h later.
- **The card shows the timer**: a purple "On trial · 17 h left" chip on the card (staff Calendar tile and opened card),
  and "Numbers due" once 24 h has passed. The card's status stays Approved, then Scheduled as today.
- The SMM types the numbers per version. When every trial version has them, the highest-views one is marked
  **Suggested**. The SMM presses **"Give the winner badge"** on any version (the suggestion is a hint, not a rule): that
  one is `winner`, the others `lost`, and the card's link becomes the winner's (above).
- **The winner posts on the card's calendar date and the card turns Posted** through today's Posted path, unchanged.
- The production task shows one list of versions with their labels (read only) under its ordinary single link.

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
2. **The client's link is tokenless for writes today** (owner decision of 2026-07-15 for `calendar-upsert`). The new
   function must accept client answers the same way or clients' links would fail. Narrowed by the switch (test client
   only) and by answering only versions of that client's own cards. Q5.
3. **Two writers on one table** (clashes 1 and 4 above). Settled by narrowing the studio's `update` and by stale-save
   checks.
4. **Notifications.** One change request per changed version could send several review pings. Each sends what one change
   request sends today; "Approve all" sends one approval.
5. **Seven players on Kasper's page.** Only the version on stage loads its video; the others show posters.
6. **The winner's link swap** is an ordinary staff link edit, so it is subject to today's link guards (duplicate link,
   link clobber). It must happen before the calendar date, or the original link posts. The card shows "Give the winner
   badge" until it does.
7. **The trial posting itself** happens on Instagram by hand; SyncView cannot see a version posted that was not
   approved.

## 8. Out of scope

- Posting to Instagram (the SMM posts by hand), and reading the numbers from Instagram (typed by the SMM).
- Making the versions and the hooks (the studio, #2349 and the pipelines plan).
- Thumbnails or captions per version (one of each per card).
- Samples, YouTube titles, and every client other than the test client.
- Any change to `calendar-upsert`, `calendar-card-write`, the Section 4 three, or any n8n workflow.

## 9. Questions only the owner can answer

Answered by the owner (2026-10-26): Q1 ("Decisions after v2", folded in above), Q4 (Approved when no version is waiting
and at least one is approved), Q6 (the SMM gives the winner badge; the highest-views version is suggested).

Still open:

2. Can the client drop a version, or only the team?
3. Does a changed version need the SMM and Kasper again before the client, or go straight back to the client?
5. Should the client's answers on this new page need the review link's token, or stay tokenless like today's link?
7. Which 24 h numbers should the SMM type? (#2349 has views, watch time, shares, saves, follows; the mockup uses those.)
8. Should the client see the 24 h results and which version won?
9. Should the studio also put version A's link on the card, or does the editor keep doing that by hand?

New, from reading #2349 (for the supervisor to route):

10. #2349 has an eighth status, "no clear winner". Keep it (the card keeps its original link and posts as made)?
