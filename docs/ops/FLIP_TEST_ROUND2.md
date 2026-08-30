# Flip test — round 2

Round 1 (`FLIP_DAY_TEST_LOG_2026-08-30.md`) proved the SMM journey and the client
journey on the native path, and proved that no write on any surface reached the
legacy Linear webhooks. It could not run the Kasper journey at all, and it found
six defects. Three are fixed and need confirming by hand; three are open.

This round has three jobs, in priority order:

1. **Run the journey round 1 could not** — SMM → Kasper → client, end to end.
2. **Prove the three fixes on the live product**, including one that is a
   deliberate refusal and can only be proven by making the bad thing happen.
3. **Attack the app in the ways round 1 did not** — §4 is where the unknown
   defects are, and it is the part worth spending the most time on.

## Ground rules (unchanged, non-negotiable)

- **Only the TEST client `sidneylaruel`.** Every mutation, every surface. No
  other client's data is touched, ever — including "just to look".
- **The repo is PUBLIC.** No client names, no share-link token, no private paths
  in commits, logs, filenames or screenshots. Slugs of other clients go in chat
  only, never in the log file.
- **Never edit an n8n workflow.** They are production sales automation. Reading
  is fine; the executions list is a legitimate evidence source.
- **Delete nothing.** Leave test cards and stray issues in place as evidence, as
  round 1 did.
- **Record retractions, do not silently fix them.** Round 1's two corrections
  were the most valuable thing in that log. If evidence overturns a finding you
  already wrote, keep both and say what changed your mind.
- **Trust measurement over inference.** Round 1's headline finding named the
  wrong mechanism because a webhook probe was read as proof of what the browser
  does. Before concluding "the app reads X", prove the app read X — from the
  network panel or a first-party recorder, not from what the endpoint returns.

## 1. The Kasper journey (blocked in round 1 — run it first)

The queue reads Supabase first for every client and native cards DO reach it.
What dropped round 1's card was that both media columns were empty.

1. Create a card, attach a real video URL **and** a thumbnail URL, drive it to
   `Kasper Approval` from the SMM calendar pill.
2. Open Kasper's tab. The card must be in **Waiting for your review**. If it is
   not, that is a finding — capture `_kasperState.items`, the card's
   `video_status` / `graphic_status` / `asset_url` / `thumbnail_url`, and whether
   the queue load hit Supabase or the webhook.
3. Then exercise every Kasper control on it, checking the card AND the canonical
   row after each: **tweak** (per component), **undo the tweak**, **reply on the
   thread**, **approve one component but not the other**, **Finish reviewing**,
   **X-close**, and the **move to client**.
4. After each, check the **Production tab** (`?prod=1`) for the same deliverable:
   status, and whether Kasper's tweak text reached the sub-issue as a comment.
5. Then the client link: does the client see exactly what Kasper approved, and
   nothing he did not?

**What round 1 never established, and this does:** whether a Kasper decision
propagates to all four surfaces, or only to the two he can see.

## 2. Confirming the three fixes

### 2a. The stranded hand-off notice (item 81)

The interesting version of this is the one the flip made reachable:

1. Create a card, attach **nothing**.
2. Move it to `Kasper Approval` **from the Production tab**, not from the
   calendar pill — a status move that never touches media.
3. Kasper's tab must show, above the queue: *"1 card is waiting on a file, not on
   you"*, naming the client and the card. It must **not** be in the review list.
4. Now attach a video URL to that card. On the next Kasper load the notice must
   go, and the card must appear in the queue.
5. Repeat with a thumbnail instead of a video (either one alone is enough).

### 2b. The reconciler's refusal (item 82) — the important one

This is the highest-risk change of the batch, and it can only be proven by
causing the harm and watching it not happen. It needs **two** cards and about
half an hour of wall clock, so start it early and do §1 while it runs.

- **Card A, the foreign edit.** Note the deliverable's status in the Production
  tab (say `For SMM Approval`). Now go into **Linear directly** and set that
  sub-issue to something else (`Approved`). Wait through two 15-minute reconciler
  ticks. **The card must not move.** Check the `linear-sync-reconcile` Action run
  log for a line beginning `⛔ foreign-linear` naming the identifier, the Linear
  value and the canonical value, and check the job summary for
  `foreign-Linear pulls`. Then check the card on all four surfaces — the client
  link especially — and confirm it still reads what SyncView says.
- **Card B, the echo.** Change status **in the Production tab** and leave Linear
  alone. Within ~15 minutes the card must move to match, exactly as round 1
  measured (10m39s). If B stops working, the fix froze the projection and that is
  a serious regression — say so loudly.

Both halves must hold in the same window. A passes and B fails = frozen
projection. B passes and A fails = the fix did not take.

### 2c. Mojibake (item 83)

Six places, all Production-tab: the provisional-attribution badge, the create
modal's parent picker and its header line, and two toasts (create success with a
pending mirror, and the Linear-ID-conflict save). Each should show a clean `·`.

## 3. The three open findings — characterize, do not fix

- **Hash routes not mounting (item 84).** Reproduce deliberately and find the
  boundary: does it depend on `history.state`, on saved prefs, on pins, on which
  tab you were on before? Try: fresh profile cold load; reload on
  `#calendar/sidneylaruel`; reload on `#kasper`; navigate to a client profile
  first, then edit the hash and reload; clear localStorage and retry. **Record
  `history.state`, the localStorage nav/prefs/pins keys, and whether `#calView`
  exists, for every attempt.** The pattern across attempts is the finding.
- **`foreign_write_detected` self-noise (item 85).** For the 16 self-echoes vs
  the 4 genuine detections, what differs *in the row*? That difference is the
  discriminator the code should use.
- **`calendar-get` empty 200s (item 86).** For those three slugs, does the
  browser ever actually consume that response, or is Supabase always first? An
  empty 200 only matters if something downstream believes it.

## 4. Go deeper — the part round 1 did not reach

Round 1 walked the happy path of each role. Everything below is a way the app
can be wrong that nobody has looked at yet. Spend the most time here.

### 4a. Break the reads on purpose

The flip audit's master failure pattern is the **silent fallback**: a read fails,
the app quietly uses a worse source, and the screen looks fine. Items 70, 71 and
81 are all that shape. So attack it directly — in DevTools, block a request
pattern, reload, and ask one question: **does the surface tell the truth?**

Block each of these in turn, on each surface that uses it:
`**/rest/v1/calendar_posts*`, `**/rest/v1/deliverables*`,
`**/rest/v1/syncview_runtime_flags*`, `**/functions/v1/*`, and the whole
`synchrosocial.app.n8n.cloud` host.

For each: does it show an honest error, degrade visibly, or **lie** — an empty
calendar that looks like a calendar with no posts, a green save that did not
save, a queue missing cards with no notice? A lie is a finding. Note especially
the runtime-flags block: that is item 70's exact trigger, and the tab should now
heal on the next focus/resume rather than staying dark.

### 4b. One card, four windows

Open the same card on all four surfaces at once — SMM calendar, Kasper, client
link, Production. Change status on **one** and watch the other three without
touching them. Which update live, which need a refresh, which stay wrong?
Round 1's Part 1g (realtime lag) was never measured; measure it here as a number
per surface. Then do it the other way: change it in the Production tab and time
each surface.

### 4c. Two people at once

The whole app assumes one actor at a time. Try it with two tabs:
- SMM edits the caption while the client approves the video.
- Kasper writes a tweak while the SMM moves the same component's status.
- The client approves while the reconciler tick lands.
- Two tabs of the same role both save different values within a second.

Does anything get silently lost? Is the loser told? A last-write-wins that
discards a client's approval without a word is a serious finding.

### 4d. Double-fire and go back

Double-click every consequential button (approve, tweak, finish reviewing,
create post). Then hit browser Back after each irreversible-looking action and
see what the UI claims. Reload mid-flow: after typing a tweak but before saving,
after approving one component of two, with the create modal open.

### 4e. The shapes nobody creates on purpose

Video-only, thumbnail-only, caption-only, all three; a card with no scheduled
date; two cards on the same day; a very long caption; emoji and RTL text in a
caption and a card name; an apostrophe and a `<script>` tag in a card name
(the Kasper notice escapes them — verify, and look for anywhere that does not);
an archived card that a client link still has open.

### 4f. Finish round 1's loose ends

Item 67 (a card with a Linear link and no native id) and the 1g realtime
measurement, both listed as not-completed in round 1.

## What to produce

A log at `docs/ops/FLIP_TEST_LOG_ROUND2_<date>.md`, same shape as round 1's:
the verdict first, findings with the evidence that establishes each, and a
"Not completed, and why" section. Push it on a branch and open a PR; the owner
merges. Findings become register items **87+** (81-86 are taken).

For each finding: **what you did, what you expected, what happened, and what
proves it** — a row read back from the database, a network entry, a screenshot.
Round 1's best work was measured, not inferred; the retractions came from
measuring twice. Do that again.
