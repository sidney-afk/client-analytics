# Flip test — round 2

Round 1 (`FLIP_DAY_TEST_LOG_2026-08-30.md`) proved the SMM journey and the client
journey on the native path, and proved that no write on any surface reached the
legacy Linear webhooks. It could not run the Kasper journey at all, and it found
six defects. Three are fixed and need confirming by hand; three are open.

This round has four jobs, in priority order:

1. **Run the journey round 1 could not** — SMM → Kasper → client, end to end.
2. **Run the fourth role round 1 never had** — the EDITOR, working a full day
   inside SyncView Linear (`?prod=1`). Round 1 used the Production tab as a
   checking surface; nobody has yet used it as the place where the work
   actually happens, and post-flip it IS that place.
3. **Prove the merged fixes on the live product** — six shipped since round 1,
   including one that is a deliberate refusal and can only be proven by making
   the bad thing happen.
4. **Attack the app in the ways round 1 did not** — the deeper-sweep section is
   where the unknown defects are, and it deserves the most time. Five of round
   1's six findings were the same shape: a silent fallback that looked healthy.

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

## 2. The editor journey — SyncView Linear as a place to WORK

Everything here happens in the Production tab (`?prod=1`), as the person who
edits the videos. The other three roles have journeys; the editor only ever had
spot checks. Post-flip this surface is authoritative, so an editor mistake or a
dead control here is a production incident, not a preview bug.

Work the TEST client's issues like an editor would, checking after each act
that it (a) landed on the canonical row, (b) projected to the calendar card
within a reconciler tick, and (c) appears correctly to SMM / Kasper / client:

- **The worklist itself.** Open the list, group and filter, use the deep link
  (`?d=`) to a specific deliverable, open a parent and walk its sub-issues.
  Does the editor see the same set of issues Linear would have shown them?
  Anything missing or duplicated is a finding.
- **Status, the whole lifecycle, from the keyboard and the mouse both.**
  In Progress → For Kasper approval → (Kasper tweaks) → Tweaks Needed → back
  again → Approved. Every transition through the status control AND through
  any context menu / shortcut that offers it. After each: canonical row,
  card, and what the OTHER roles now see.
- **Due dates and assignees** — including the shortcuts (⇧D, A), clearing a
  due date, reassigning, and UNassigning. Item 77 (a cleared assignee never
  applied) is deploy-pending, so a cleared assignee reaching the mirror is
  NOT expected to reflect back yet — note behavior, don't file it as new.
- **Comments, both directions.** Editor comments on a sub-issue; do they
  reach the roles that should see them and ONLY those? Client comments and
  tweaks must arrive on the sub-issue badged "Client-visible" (round 1
  proved one direction; do it repeatedly, and from the editor's seat).
- **The create dialog.** Create a sub-issue under an existing parent; create
  a parent. The ledger says the create dialog once steered people into
  orphans (E2) and double-deliverables (E3) — check what a created issue is
  and is not linked to, and whether the editor can tell.
- **The seams.** What happens when the editor changes status while Kasper has
  the same card open? While the client link is open on it? During the
  reconciler's 15-minute tick? A lost or silently overwritten editor action
  is a HIGH finding.
- **The controls that should refuse.** Attribution-guarded writes, statuses a
  team doesn't have, anything disabled — each should refuse loudly and
  correctly, never dead-end silently. Round 1 proved the attribution guard
  holds; probe the rest of the refusal surface.

## 3. Confirming the merged fixes

### 3a. The stranded hand-off notice (item 81)

The interesting version of this is the one the flip made reachable:

1. Create a card, attach **nothing**.
2. Move it to `Kasper Approval` **from the Production tab**, not from the
   calendar pill — a status move that never touches media.
3. Kasper's tab must show, above the queue: *"1 card is waiting on content, not
   on you"*, naming the client and the card. It must **not** be in the review
   list.
4. Now attach a video URL to that card. On the next Kasper load the notice must
   go, and the card must appear in the queue.
5. Repeat with a thumbnail instead of a video (either one alone is enough).
6. Repeat once more with **no media at all and only a caption** — leave the
   caption blank, move `Caption` to `Kasper Approval`, and the card must land in
   the same notice; type a caption and it must move into the queue. The notice
   says "content", not "a file", precisely because this case reaches it.

### 3b. The reconciler's refusal (item 82) — the important one

This is the highest-risk change of the batch, and it can only be proven by
causing the harm and watching it not happen. It needs **two** cards and about
half an hour of wall clock, so start it early and do §1/§2 while it runs.

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

### 3c. Mojibake (item 83)

Six places, all Production-tab: the provisional-attribution badge, the create
modal's parent picker and its header line, and two toasts (create success with a
pending mirror, and the Linear-ID-conflict save). Each should show a clean `·`.

### 3d. Hash routes survive a bookmark (item 84)

The mechanism was mount-then-repaint by `popstate`, so test it the way it
actually broke: with the app ALREADY OPEN on some other tab, navigate the same
tab to `#calendar/sidneylaruel` via bookmark or address bar. The calendar must
mount and STAY mounted. Repeat for `#kasper` (unlocked), `#workload`, a card
deep link `#calendar/sidneylaruel/<cardId>`, and Back/Forward across those
entries. Then the gate that must hold: in a FRESH tab where Kasper was never
unlocked, `#kasper` must NOT mount through this path.

### 3e. A lying calendar-get is refused (item 86)

The clients that really produce the empty answer are NOT the TEST client, and
the ground rules forbid touching them — so manufacture the shape for
`sidneylaruel` instead of hunting it. In the tab's console, before triggering a
load, stub the webhook for the TEST client only:

```js
const _origFetch = window.fetch;
window.fetch = (url, ...rest) => {
  const href = String(url);
  if (href.includes('webhook/calendar-get') && href.includes('client=sidneylaruel')) {
    // pick ONE per run:
    return Promise.resolve(new Response('', { status: 200 }));                          // the zero-byte shape
    // return Promise.resolve(new Response('{"ok":true,"posts":[]}', { status: 200 })); // the posts:[] shape
  }
  return _origFetch(url, ...rest);
};
```

Then block `**/rest/v1/calendar_posts*` in DevTools so the app is forced onto
the webhook fallback, and reload the TEST client's calendar. For BOTH shapes:
the calendar must keep its cards and say it could not refresh — never render a
clean empty calendar — and nothing may be written to the localStorage cache
(`syncview` calendar cache keys for the slug must not become empty). On
Kasper's tab under the same stub, `sidneylaruel` must be NAMED in the
could-not-be-loaded notice above the queue, not silently absent. Restore with
`window.fetch = _origFetch` (or reload) between shapes.

Known-not-closed: a stale-but-non-empty Sheet snapshot still passes every
guard; if one shows up for the TEST client during the day, that is a finding
with a reserved slot.

### 3f. The SyncLinear panel truth pass (2026-08-30, PR #1181)

Seven places the Production surface stated something false. All render-side, so
they are live as soon as that PR is merged. Check each on the TEST client:

- **A batch parent** (the post-level issue, e.g. `VID-…` whose comment box says
  "This is the post's batch parent"): its Assets grid must show **three** rows,
  not four — `Deliverable file` is gone, because a container has no artifact.
  Each remaining row must read **"Held on the post, not readable here. Open a
  sub-issue to see it."** as its VISIBLE value with an `Unavailable` state — NOT
  "Not provided / Missing", which was a flat contradiction of the filming-plan
  link the same parent shows in its description directly above.
- **The same parent** must no longer offer **Refresh access** (it could not act
  there) and no issue may offer a Description **Refresh** (both gone; the
  `Retry` inside a description *error* banner stays and must still work — force
  a failed description read to see it).
- **A video sub-issue**: the Assets grid is read-only, but it must now SAY so —
  "Attaching is available on Graphics deliverables. Set the video link on the
  calendar card for this post." Previously it rendered four rows and no reason.
- **A graphics sub-issue**: Attach / replace still works exactly as before.
  Paste a **Frame.io** link and a **Drive folder** link — both must be accepted.
  Then paste a Google Doc link and read the refusal: it must name the real rule
  ("A Google Doc is a brief, not a deliverable"), not the old sentence claiming
  folders are refused.
- **The calendar card's remove-link cross**: on a card that has a native
  deliverable, the confirm must say the link **will be restored automatically**;
  on a half-linked card (link but no deliverable id) it must keep the original
  wording. Confirm one of each and watch what actually happens on the next load
  — the promise and the behavior must agree.

### 3g. What CANNOT be tested, and why (read before planning asset tests)

The Production tab has exactly **one** asset-writing control: Attach / replace,
which always targets `deliverable_file`, and only on a **graphics** deliverable.
So a plan to "test putting links across roles for raw footage, frame folder,
deliverable file and thumbnail file" cannot be executed as written:

- **Raw footage, Frame folder and Filming plan have no write control anywhere in
  the app.** They live on the `batches` row and are written once at intake or by
  the Linear bridge. Nothing on any surface edits them.
- **Video deliverables cannot be attached at all** — graphics-only at six
  layers, down to a Postgres function that raises `production artifact graphics
  only`. Do not file this as a bug; it is a known capability gap awaiting an
  owner decision (migration plus two deploys).

So the real asset test is: **one write** (graphics thumbnail attach, by an
admin/SMM and by the designer) plus **read-and-probe everywhere else** — which
links resolve, what each state pill claims, and whether any of it is false.

### 3h. NOT yet testable: items 77 and 85

Both live in the `linear-inbound` edge function and ship only when the owner
dispatches the deploy. Until then a cleared assignee still won't apply, and
`foreign_write_detected` rows won't carry `echo_suppressed`. Don't file either
as a new finding; do note anything AROUND them that looks off.

## 4. Go deeper — the part round 1 did not reach

Round 1 walked the happy path of each role. Everything below is a way the app
can be wrong that nobody has looked at yet. Spend the most time here. The
pattern ledger (`docs/ops/FLIP_BUG_LEDGER.md`) is your map of how this app has
historically failed — read §2's category headers and §4's method lessons before
starting, and when something feels off, check whether it rhymes with an entry.

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
merges. Findings become register items **87+** (81-86 are taken), and any finding
that is an instance of a `FLIP_BUG_LEDGER` class should say which one.

For each finding: **what you did, what you expected, what happened, and what
proves it** — a row read back from the database, a network entry, a screenshot.
Round 1's best work was measured, not inferred; the retractions came from
measuring twice. Do that again.
