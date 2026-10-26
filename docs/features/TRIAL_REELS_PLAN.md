# Trial reels in SyncView: plan (session Trials, 2026-10-26)

**Status: plan only. Nothing is built, nothing is switched on, nothing is merged.** The supervisor shows this to the
owner before any building starts. OPEN_REPAIRS 513.

The owner approved trial reels on 2026-10-26: one video, versions A to G that differ in the text hook, every version
posted as an Instagram trial reel, and the winner kept after 24 h. This plan covers the SyncView part: the switch on a
calendar card, the versions on the card and its production task, the review, and the log.

The studio half is PR #2349, **merged to main on 2026-10-26 at 21:10 UTC (7cb60ad) without the changes this plan asks for**: the connector's `studio_action "trial_reels"` (steps `guide`, `log`, `list`, `update`)
and its table `studio_trial_versions`. Section 3 says how the two fit.

Mockups:
- **The card, on the real page:** `trial-reels/real/card-{today,review,trial,winner}-{1440,390}.png` (and
  `-390-versions.png`, scrolled to the versions). Made by `trial-reels/real/make-screenshots.js`: it builds today's
  page, opens the real Calendar card with the offline harness's fictional card, and loads `real/preview.js`, which adds
  only the trial-reels switch and the versions list (rows cloned from today's Video link row). `card-today-*` is the
  same card without it.
- **Review, Kasper and the winner pick:** [`trial-reels/mockups.html`](trial-reels/mockups.html) (interactive, one shared
  state) and its pictures `trial-reels/mock-*.png`. The owner approved the client review (1440 and 390) and Kasper's view
  on 2026-10-26.
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

### What the build PR changes in the studio function, and why it is SyncView's PR

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
| `read` | staff key, or a client review link for its own client | the card's switch and its versions, for one card or a list of cards. Once a winner is picked, a client link gets **only the winner** (Q8) |
| `switch_set` | staff key | turns the card's switch on or off |
| `version_link_set` | staff key | pastes a version's Frame.io link (Q9). On a version with a change asked, a new link bumps `revision`, clears the three OKs and the change fields, and sets `waiting`, so it goes the normal route again (Q3) |
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
  history shows "Version C: change asked".

**How it fits `calendar-card-write` and `production-write` without a Section 4 change:** neither is changed. The card
keeps one ordinary `asset_url` and the task one ordinary `file_url`, so Production, the status bridge, the drift robot
and the connector's `video_cards` see a normal card. When the SMM gives the winner badge, the page sets the card's
`asset_url` to the winner's link through **today's staff card save** (an ordinary link edit), so the post that goes out
on the calendar date, and every reader after it, carries the winner. Until then `asset_url` holds version A's link, pasted
the usual way.

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
  Tweaks Needed as today and the editor works as today. When the new cut's link is pasted, only C loses its OKs and goes
  back to `waiting`; it then takes **the normal route, the SMM and Kasper again before the client** (Q3). The card comes
  back through For SMM Approval and Kasper Approval as today; each stage stops only on the versions that lack that
  reviewer's OK, and the other versions keep their answers.
- **Dropped** versions are skipped by every stage and by the "every version" count. **Only the team can drop** (Q2); the
  client page has no drop button.
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
- **The card shows the timer as a reminder**: a purple "On trial · 17 h left" chip on the card, and "Pick the winner"
  once 24 h has passed. The card's status stays Approved, then Scheduled as today.
- **No numbers are typed** (Q7). After the trial the SMM presses **"★ Make winner"** on one version: that one is
  `winner`, the others `lost`, and the card's link becomes the winner's (above).
- **The client sees only the winner, once it is picked** (Q8): the review link shows "The version we are posting" with
  the winner's video and hook, and none of the other versions.
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

**Next:** the owner looks at the real-card pictures (`trial-reels/real/`). No building until he has.
