# Flip-day hands-on test playbook — video flip validation

Written 2026-08-30, two days after F1(video). Executed by a Claude session
driving a REAL browser (Chrome extension) with the owner nearby. The overnight
audit (OPEN_REPAIRS items 62-73) found what is broken by READING and EXECUTING
code; this playbook is the other half — proving what WORKS by using the product
the way its three kinds of users do, and catching what only eyes catch.

The owner supplies four things in chat, deliberately not written here: the SMM
calendar URL, the client share link (it carries a token — it must NEVER appear
in this repo, the log, a commit, or a screenshot filename), the Kasper tab URL,
and two test asset URLs (a video file and a frame link).

## Ground rules

1. **Writes only ever touch the TEST client (`sidneylaruel`).** Every create,
   status change, comment, tweak, approval — TEST client. If a step would write
   anywhere else, stop and ask the owner. Reading anything is fine.
2. **The repo is PUBLIC.** The log you produce is committed. No real client
   names, no tokens, no private URLs in it — `sidneylaruel`, `VID-`/`GRA-`
   identifiers, `del_…` ids and event ids are all fine. Real client names are
   fine in CHAT with the owner, never in the log.
3. **Evidence discipline.** DevTools Network tab open for the entire session.
   For every write action record: what you clicked, which URL the request went
   to, the response status, and what the screen showed. Screenshot anything
   visual. The single most diagnostic signal all day is the request URL:
   **every write must go to `/functions/v1/production-write` (or the intake /
   comment edge functions). If you ever see `webhook/linear-set-status` or
   `webhook/linear-add-comment`, that is OPEN_REPAIRS item 63/70 firing live —
   capture everything and tell the owner immediately.**
4. **Backend truth, not screen truth.** After each status-changing action,
   verify the canonical record moved: read
   `deliverable_events?action=eq.status_change&order=ts.desc&limit=3` via
   Supabase REST (the publishable key is in `index.html`, `CAL_SUPABASE_ANON_KEY`;
   event tables key the verb on `action` and the time on `ts`). The event must
   exist and carry `legacy_parity: false`. **A card that moves on screen with
   no matching event is item 69 happening live** — the highest-priority catch
   of the day.
5. **The log** goes to `docs/ops/FLIP_DAY_TEST_LOG_2026-08-30.md` on a NEW
   branch `claude/flip-test-log-2026-08-30` (do NOT touch
   `claude/reduce-n8n-linear-deps-vmphp6` — another session owns it). Commit
   and push after every completed part, not at the end. Open a PR at day's end.
6. **New defects** get an entry in the log with evidence, severity, and
   file:line where you can find it. Genuinely new, confirmed defects also get
   drafted as OPEN_REPAIRS items (numbered 74+) in the log for the owner to
   promote. Items 62-73 are KNOWN — verify, reference, don't re-file.
7. **Lane check on every tab you open**, including the client share link:
   run `peekWriteUiRerouteClients()` in the console. Expect 41 slugs. An empty
   array means that tab hit item 70's timeout and every write from it will
   silently die — screenshot the console, note the time, reload, re-check.
   This doubles as live evidence for item 70, so a hit is a FINDING, not just
   an inconvenience.

## Part 0 — perishable evidence, before ANY page load

On a machine that had SyncView open before Friday night (the owner knows
which), open DevTools on any already-open SyncView tab — or before navigating
anywhere on a fresh one — and run:

    peekWriteUiQueueDiagnostics()
    peekLinearOutbox()
    JSON.parse(localStorage.getItem('syncview_calCardJobs_v1') || '[]')

Paste the raw output into the log (it contains no secrets — statuses, ids,
timestamps). This is the only evidence that can settle whether item 70 (the
2-second enrolment-flag timeout) caused item 69 (the lost client approval).
A page load drains the first and deletes the third. If all three are empty,
say so — a clean negative is a result.

## Part 1 — the SMM journey (the extensive one)

On the SMM calendar for the TEST client. For EVERY card created below, the
cycle is: create → verify native ids → open its Production sub-issue → work the
fields → change statuses → verify events. The Production tab round-trip on
every single card is the point of the day, not an extra.

**1a. Create a BOTH post** (video + thumbnail) via Create Post.
- EXPECT: card appears; it carries BOTH `video_deliverable_id` and
  `graphic_deliverable_id` (visible in the intake response in Network, or via
  REST on `calendar_posts?id=eq.<card>`).
- Click the card's SyncView icon → it must open `?prod=1&d=<VID-…>` showing a
  real sub-issue: correct client, sensible status, sitting under a parent.
- In the Production detail: leave an internal comment; change the status there;
  go back to the calendar and confirm the card reflects it (realtime or after
  a reload — note which, and how long it took).

**1b. Create a VIDEO-ONLY post.** Same cycle. EXPECT exactly one native id.
**1c. Create a THUMBNAIL-ONLY post.** Same cycle, graphic side (`GRA-…`).

**1d. Work the fields** on the BOTH card: set the thumbnail URL, the video
file URL (owner-supplied assets), and a caption. Reload the page — all three
must survive. Confirm in Network that none of these fired a `webhook/linear-*`
request.

**1e. The Linear link slot, post-flip contract** (items 59/61/62):
- There must be NO edit pencil and NO way to paste a Linear link on either
  component — the slot is sealed by design.
- There must be NO orange "missing project/due/editor" banner and no "parent
  issue linked" banner on these cards (item 62's fix — pending merge; if the
  banner appears, check with the owner whether #1177 is merged yet before
  filing).
- The SyncView icon is the affordance that remains. If a Linear-open icon also
  shows, note it — the owner has an open product question about whether it
  should stay during the backup window.

**1f. Statuses through the pill**, on each card: In Progress → For SMM
Approval (and onward as the chain allows). Each change: Network shows
`production-write`, the pill sticks after reload, and a `status_change` event
with `legacy_parity: false` exists. Also confirm the Production detail shows
the new status.

**1g. Second tab open the whole time** on the same calendar: changes made in
tab 1 should arrive in tab 2 without a reload (realtime). Note lag.

## Part 2 — the Kasper journey

On the Kasper tab, after Part 1 has pushed at least one card to For Kasper
Approval.

- The TEST cards appear in the inbox.
- **Request a tweak** with a comment. EXPECT: card status moves to tweak, the
  comment lands on the card AND on the Production sub-issue's activity
  (open `?prod=1&d=<id>` and look), and a `status_change` event exists.
- **Undo** from the toast. EXPECT: status reverts, and the revert is also an
  event — not just a screen change.
- **Approve** → moves to Client Approval. Verify event + Production status.
- **Finish reviewing** flow: complete it and note exactly what it says when
  some components are still undecided.

## Part 3 — the client journey (the money checks)

On the client share link (verify the lane check from ground rule 7 FIRST —
this tab is the one item 69's lost write most likely traveled through).

- The TEST cards are visible with client-appropriate controls (no Linear
  anything, no staff-only affordances — screenshot the card as the client
  sees it).
- **Approve one component.** EXPECT: Network shows the gateway (production-
  write / client entry EF), the SMM calendar reflects it, an event exists with
  the client actor shape, and the Production sub-issue status moved.
- **Request a tweak on the other component WITH a comment.** This is the
  single most important check of the day: **the client's comment must appear
  on the Production sub-issue** (the front-door comment chain), and be visible
  to the SMM and on the Kasper side. If the comment lands on the card but NOT
  the sub-issue, capture everything — that is the comment-lane failure the
  health check's item 4 context line warns about.
- Client comments/approvals must never fire `webhook/linear-*` requests.

## Part 4 — Production tab as a first-class surface

Beyond the per-card round-trips:
- Filters: All / Video / Graphics team views; a client filter; confirm counts
  are sane and no `unattributed` rows leak into a client's filtered view.
- Deep links: `?prod=1&d=<id>` cold (fresh tab, direct paste) must open the
  right detail. Browser back/forward must behave.
- The known cosmetic issue: a 2023 stray (`VID-164`, item 73) may sit at the
  top of Active. Verify it looks as described; do not file it again.
- Write affordances you should NOT have: create is closed (a gate message,
  not a working dialog); no bulk mutation without the guard toasts.

## Part 5 — backend live checks (only if this session has Linear access)

These close the two blindest spots the audit could not reach. Skip cleanly if
no Linear access; say so in the log.

- **5a. The stray catcher, end to end** (the audit's single highest-value
  test): create ONE sub-issue in Linear under a `sidneylaruel` video parent.
  Within ~30 min the B1 incremental run must import it: the next
  `b1_incremental_refresh`-window `linear_incremental_refresh` events show a
  real write, and the row lands with `client_slug: sidneylaruel` and a
  both-team parent map. This is the only thing that distinguishes B1's
  current "green no-op" state from a silently broken importer.
- **5b. Detect-only, both directions**: change the status AND clear the
  assignee on a `sidneylaruel` video issue in Linear. EXPECT: the deliverable
  does NOT move (`mirror_in_status_change` stays 0), a `foreign_write_detected`
  event appears, and the calendar card ALSO does not silently adopt the Linear
  value — if the card moves within ~15 min with no SyncView actor, that is the
  reconciler pull-door the backend audit flagged (S3): capture timestamps and
  tell the owner; it bears directly on the item-69 decision.

## Part 6 — known-broken spot checks (verify, don't re-file)

- Item 64: find a card with a greyed N/A video pill; tooltip says "Link a
  Linear sub-issue first"; confirm there is no control that can.
- Item 67: on a TEST card with a Linear link but no native id (seed one via
  REST if none exists), change the video status → expect a refusal and
  rollback.
- Item 66: kebab → Import from Linear on the TEST client, import one
  sub-issue, try to change its status → fails. (This also seeds item 67's
  shape for the step above.)

## Part 7 — the visual pass

You have eyes; the unit suites don't. At every surface, before leaving it,
take a full-page screenshot and LOOK at it: misaligned pills, overlapping
controls, empty-state weirdness, copy that lies about the post-flip world
("…while Linear is authoritative", "Link a Linear sub-issue…"), spinners that
never resolve, anything that made you look twice. Log each with the
screenshot reference and one sentence on why it caught your eye. Copy that
points users at Linear for an action that no longer works there is a DEFECT,
not a nitpick — it is the class behind half of items 62-73.

## End of day

The log ends with: a summary table (part / scenario / PASS-FAIL-WEIRD /
evidence ref), the list of candidate new OPEN_REPAIRS items, the raw Part-0
output, and anything you could not complete and why. Push, open a PR titled
"Flip-day test log 2026-08-30", and give the owner the one-paragraph verdict
in chat: is the three-role chain sound on the native path, yes or no, and
what is the worst thing you saw.
