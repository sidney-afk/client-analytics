# Trial reels in SyncView: plan (session Trials, 2026-10-26)

**Status: plan only. Nothing is built, nothing is switched on, nothing is merged.** The supervisor shows this to the
owner before any building starts. OPEN_REPAIRS 509.

The owner approved trial reels on 2026-10-26: one video, versions A to G that differ only in the text hook, every
version posted as an Instagram trial reel, and the winner kept after 24 h. This plan covers the SyncView part:
the switch on a calendar card, the versions on the card and its production sub-issue, the review, and the results log.

**Source note.** The supervisor pointed at `editor-ai/docs/TRIAL_REELS_PLAN.md` in synchro-pipelines (Parts 1 and 3
and "Decisions after v2"). This session could not read that repository (attaching it was refused), so this plan is
built from the supervisor's brief and from this repository's code. Anything in "Decisions after v2" that disagrees
with this plan wins; the first owner question below asks for it.

Mockups: [`trial-reels/mockups.html`](trial-reels/mockups.html) (interactive, one shared state across five views).
Still pictures: `trial-reels/mock-*.png`. Today's page, from the offline browser tests (fictional fixtures):
`trial-reels/current/*.png`.

---

## 1. What exists today (read from the code)

- A card is one row in `calendar_posts` keyed by (client, id), almost all `text`. The video is one link,
  `asset_url`; the video part's state is `video_status`, `video_tweaks`, `client_video_approved_at`, plus Kasper's
  columns. There is no jsonb column and no notion of versions, variants or alternatives on a card.
- A production sub-issue is one row in `deliverables` (`file_url` is its link), tied to the card by
  `card_id` + origin and by `calendar_posts.video_deliverable_id`. The status bridge trigger maps the deliverable's
  status onto `video_status`; the hourly drift robot (`card-calendar-status-drift.yml`) compares the two.
- `calendar-card-write` copies only the fields in its `ALLOWED` list and turns every value into text.
  `calendar-upsert` (the client review link's writer) has the same list and is **frozen**.
- `production-write`, `deliverable-write` and `batch-write` are the Section 4 three, fingerprint-pinned.
- The review page (`src/index/195-review-stage.js.part`) builds a card's steps from its parts
  (`_rsModel` / `_rsCompsOf`), and every button calls the old page's own save: `_calReviewApprove`,
  `_calReviewRequestTweak` (client, SMM), `_kasperApproveComp`, `_kasperRequestTweakComp` (Kasper).
- Nothing outside SyncView writes a video link onto a card or a deliverable today.

## 2. Data model

**Versions live in their own table. The card and the deliverable get no new columns.** Two reasons: a new column on
`calendar_posts` would have to enter `ALLOWED` in `calendar-card-write` **and** in the frozen `calendar-upsert`; and a
new field on the deliverable would mean a change to a Section 4 function and a re-pin. A side table needs neither.

### `trial_reel_sets`: one row per card that has the switch on

| column | type | notes |
|---|---|---|
| `client` | text | with `post_id`, the primary key; same pair as `calendar_posts` |
| `post_id` | text | |
| `enabled` | boolean | the card's "Trial reels" switch; off keeps the rows and hides them |
| `deliverable_id` | uuid, null | copied from `calendar_posts.video_deliverable_id` when known, for the sub-issue view |
| `trial_started_at` | timestamptz, null | when the approved versions went out as trial reels |
| `winner_letter` | char(1), null | set by "Keep this one" |
| `created_at`, `updated_at`, `updated_by` | | |

### `trial_reel_versions`: one row per version

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `client`, `post_id` | text | foreign key to `trial_reel_sets` |
| `letter` | char(1) | `A`..`G`, unique per card |
| `frame_url` | text | the Frame.io link; the stage plays it with today's frame viewer |
| `hook_text` | text | shown under "Version B of 5" |
| `label` | text, checked | `waiting`, `approved`, `change_asked`, `dropped`, `on_trial`, `winner`, `lost` |
| `smm_ok_at`, `kasper_ok_at`, `client_ok_at` | timestamptz, null | each reviewer's OK on this version |
| `change_by`, `change_note`, `change_at` | text, text, timestamptz | the last change asked on this version |
| `revision` | int | goes up when the studio replaces the link or the hook; resets the three OKs and the label to `waiting` |
| `created_at`, `updated_at`, `updated_by` | | |

`label` is the client-facing state the owner listed. The three `*_ok_at` columns carry the team stages, so the SMM's and
Kasper's passes are recorded per version without new labels.

### `trial_reel_results`: Part 3, the log (one row per version)

| column | type | notes |
|---|---|---|
| `version_id` | uuid pk, fk to `trial_reel_versions` | one row per version |
| `client`, `post_id`, `letter` | | copied for easy reading |
| `ig_media_url` | text, null | the trial reel's Instagram link, if the SMM pastes it |
| `posted_at` | timestamptz, null | |
| `measured_at` | timestamptz, null | when the 24 h numbers were read |
| `views`, `reach`, `likes`, `comments`, `shares`, `saves`, `follows` | int, null | typed by the SMM |
| `avg_watch_seconds` | numeric, null | |
| `note` | text, null | |
| `entered_by`, `entered_at` | text, timestamptz | |

**Privileges.** Row level security on, no policies, and `revoke all ... from public, anon, authenticated` on all three
tables; `service_role` keeps its default rights because the Edge Function uses it (stated, not assumed: the migration
ends with a read-back of `information_schema.role_table_grants` for all four roles). The browser key reads nothing
here; every read goes through the function. This keeps the 2026-09-28 rule: no new public read.

**The migration** is one new file. It holds the new function on merge until Lighthouse applies it (the function is
new, so it has nothing to cope with). It says how to tell it is applied: `to_regclass('public.trial_reel_versions')`
is not null.

## 3. Write path: one new Edge Function, `trial-reels`

Not a Section 4 function, so no fingerprint pin; it deploys through the merge lane like any other. Actions:

| action | who | does |
|---|---|---|
| `read` | staff key, or a client review link for its own client | the set, its versions and (staff only) the results, for one card or for a list of cards |
| `switch_set` | staff key | turns the card's switch on or off (creates the set row) |
| `versions_put` | the studio key, or a staff key | upserts versions by letter: `frame_url`, `hook_text`; a changed link or hook bumps `revision` and resets that version to `waiting` |
| `version_drop` / `version_restore` | staff key | `dropped`, or back to `waiting` |
| `answer` | staff key (SMM, Kasper) or the client review link | `approve`, `change` (with a note), `approve_all`; stamps the role's `*_ok_at`; returns `stage_done: true` when every non-dropped version has this role's OK |
| `trial_start` | staff key | every `approved` version becomes `on_trial`, stamps `trial_started_at` |
| `results_put` | staff key | upserts one version's 24 h numbers |
| `winner_set` | staff key | that version `winner`, the other trial versions `lost` |

- **The studio key** is a new function secret held by the studio pipeline. It can call `versions_put` and `read`
  only, and only for cards whose set is enabled. The studio never writes the card itself.
- **The page switch** `trial_reels_pages` in `syncview_runtime_flags`, `{ "clients": [the test client] }`, read with
  the review-stage switches and failing closed. The function reads the same row and refuses every write for a client
  it does not list (`403 not_enabled`). It is not named `..._clients` because several browser tests answer every
  `_clients` key with "on".
- Every refused write reports to the write-refusal log (`_writeUiRecordFailure`), like the Calendar.
- Every write appends to `calendar_post_events` with `component = 'video'` and the letter in `payload`, so the card's
  history shows "Version C: change asked".

**How it fits `calendar-card-write` and `production-write` without a Section 4 change:** neither is changed. The card
keeps one ordinary `asset_url` (normally version A's link, set the way the team sets it today) and the sub-issue keeps
one ordinary `file_url`, so Production, the status bridge, the drift robot, the Higgsfield connector's video reader and
every other reader see a normal card. The card's status is only ever moved by today's own saves (next section).
If the owner wants the studio to also write `asset_url` / `file_url`, that would be the `attachment` operation of
`production-write` called as it is today, still no Section 4 change.

## 4. Status rules and review

**The card keeps its normal status.** Versions never write `video_status` themselves. The page calls the old part-level
save when a stage is finished, so every existing rule, notification and sync runs unchanged:

| stage | per version | when every non-dropped version has it, the page calls |
|---|---|---|
| SMM (Review tab, before Kasper) | `smm_ok_at` | today's SMM "Approve to Kasper" on the video part |
| Kasper (Review Session) | `kasper_ok_at` | `_kasperApproveComp('video')` |
| Client (review link) | `client_ok_at`, label `approved` | `_calReviewApprove` on the video part: the card moves to Approved |

- **A change on one version** sends today's change request on the video part, with the message starting
  "Version C:". The card goes to Tweaks Needed as today, the editor works as today, and the studio puts the new C.
  C goes back to `waiting`; the other versions keep their OKs. On the next round the stage only stops on versions
  that are still waiting (the others show their answer and can be revisited with the arrows).
- **Dropped** versions are skipped by every stage and by the "every version" count. Only the team can drop.
- **At least one version must be approved** for the card to move to Approved (all dropped means nothing to post).
- **The stage (195).** On a card whose set is enabled and the switch lists the client, `_rsCompsOf` replaces the
  `video` part with a `versions` part. That step shows today's player (`svFrameStageMount`, so speed buttons and
  "Open in Frame.io" come with it) for the version on stage, arrows on each side (and ← → keys), swipe on a phone,
  "Version B of 5", the hook under it, a row of letter dots carrying each version's answer, and "Approve this
  version", "Ask for a change", "Approve all". Thumbnail and caption steps stay as they are. "Finish reviewing" counts
  versions. The client's "Change my mind" on an approved version sends a note, as today.
- **Kasper's second layout** shows every version side by side (each with its hook and its own Approve, change and drop)
  instead of one video tile, with "Approve all" at the top. His first layout gets the same arrows as the client page.
- **The 24 h step.** "Mark all approved as on trial" after posting, numbers typed per version, "Keep this one". This
  changes labels only; the card stays Approved, then Scheduled or Posted as today.

## 5. The switch: the test client only

- The page switch `trial_reels_pages` lists only the test client. Missing, unreadable or any other shape: no switch
  on the card, no versions, today's page everywhere.
- The card switch shows only on that client's cards, and only to staff.
- The function refuses writes for any client the flag does not list, so a stale page cannot write elsewhere.
- Rolling out to a real client is a separate owner decision and a one-line flag change.

## 6. Risks

1. **Two saves for one answer.** The version answer saves to `trial_reel_versions`; the card's approval is the old
   save after it. If the page dies between the two, the versions say "done" and the card does not. Mitigation:
   `read` returns `card_behind: true` when a stage is done but the card has not moved, and the stage offers the old
   save again on the next open; a nightly check lists such cards. Same exposure as today's two-step caption send.
2. **The client's link is tokenless for writes today** (owner decision of 2026-07-15 for `calendar-upsert`). The new
   function must accept client answers the same way or clients' links would fail. It is narrowed by the switch
   (test client only) and by answering only versions of that client's own cards. Whether to require the link's token
   on this new function is an owner question.
3. **Notifications.** One change request per changed version (not one per card) could send several urgent or review
   pings. The plan reuses today's change request, so each sends what one change request sends today. "Approve all"
   sends one approval.
4. **Seven players on Kasper's page.** Only the version on stage loads its video; the others show posters.
5. **Drift robot.** No change in what it compares, since the card and sub-issue keep one link and one status.
6. **The trial-reel posting itself** runs outside SyncView; if a version is posted that was not approved, SyncView
   cannot see it. The log only records what the SMM types.

## 7. Out of scope

- Posting to Instagram as a trial reel (the studio or the SMM does that; SyncView does not call Instagram for it).
- Reading the 24 h numbers automatically from Instagram (typed by the SMM in this version).
- Making the versions (the studio's job, Part 2 of the pipelines plan).
- Thumbnails or captions per version (one thumbnail and one caption per card).
- Samples, YouTube titles, and every client other than the test client.
- Any change to `calendar-upsert`, `calendar-card-write`, the Section 4 three, or any n8n workflow.

## 8. Questions only the owner can answer

1. Does "Decisions after v2" in the pipelines plan change anything here? (This session could not read it.)
2. Can the client drop a version, or only the team?
3. Does a changed version need the SMM and Kasper again before the client, or go straight back to the client?
4. Should the card move to Approved with at least one version approved, or only when none is waiting at all? (Plan: no
   version waiting, and at least one approved.)
5. Should the client's answers on this new page need the review link's token, or stay tokenless like today's link?
6. Who presses "Keep this one": the SMM, Kasper, or the numbers (highest views)?
7. Which 24 h numbers should the SMM type? (Mockup: views, reach, likes, shares, saves, average watch time.)
8. Should the client see the 24 h results and which version won?
9. Should the studio also put version A's link on the card, or does the editor keep doing that by hand?
