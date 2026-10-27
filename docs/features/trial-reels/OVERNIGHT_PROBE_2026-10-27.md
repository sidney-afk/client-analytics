# Trial reels: the overnight probe (session Probe, 2026-10-27)

This was an independent test of the trial reels build, done on the owner's go of 01:35 UTC. Session Trials builds the feature
and fixes what is found; this session built nothing in the feature. Everything ran offline, with fictional data and
no live writes. The plan is `docs/features/TRIAL_REELS_PLAN.md` (PR #2352). The tests are on branch
`test/trial-reels-journey`, draft PR **#2365**, stacked on build 6. **Do not merge it; the owner holds every trial reels merge.**

Builds tested: build 5 at `b76a6e31b` (start of the night), build 6 at `1685d4eaa`, builds 2 to 4 one by one as their fixes landed, build 6 at `797b19b` (04:15 UTC, every fix carried up the stack), and build 7 at `152136d` (the client-link player, 04:25 UTC).

## DONE (verified, pushed)

| what | where | result on build 6 |
|---|---|---|
| (latest, build 6 at 797b19b) The whole journey of one 5-version card in one run. Links are pasted on the card and in Production. The SMM OKs, then asks a change on C. C's new cut. Kasper's Approve all. The client approves two versions one at a time, then Approve all, and the card goes Approved through today's save. Then the trial, the 24 h timer, the trophy, the winner, Undo, the winner again. The client sees only the winner. Posted (Undo and a new pick are refused). Switch off. At every step it checks the card status, each version's label, that the card has one link (file_url = asset_url = the version on the card), the ledger rows, and that nothing writes when the switch is off or the client isn't listed. | `test/trial-reels-journey-browser.js` | **90 / 90** |
| The rules the plan asks for and logic.mjs lacked (bugs 1 to 4) | `test/trial-reels-probe-logic.js` | 10 / 10 (8 failed on build 5) |
| Bugs 5 and 7 on the real `index.ts` under Deno | `test/trial-reels-probe-deno.ts` | 7 / 7 (3 failed on build 5) |
| One live version (bug 6), on the client review page | `test/trial-reels-one-live-browser.js` | 4 / 4 (2 failed on build 5) |
| Two staff pick a winner at once (bug 9) | `test/trial-reels-race-browser.js` (adopted by Trials, 3 races) | **15 / 15** on 797b19b |
| A change belongs to the version it was asked on; Kasper's "Approve after tweaks" (bugs 10, 10b, 11) | `test/trial-reels-change-naming-browser.js` (adopted by Trials) | **6 / 6** on 797b19b |
| A refused link on the version on the card (bug 12, second pass) | `test/trial-reels-link-guard-browser.js` (bug 12 and 12b) | **1 / 4: open** on 152136d |
| Each stacked branch (builds 1 to 5) builds with `npm run build:index` | — | all clean |
| Trials' own suites (card, Production, review, Notes, function) on build 5, in dark and light | — | all pass |
| The eyes pass. Card, Production, the review page (client, SMM, Kasper, winner) and Notes, at 1440 and 390, dark first, compared with `real/` and `mock-*` | screenshots kept outside the repo (fictional data) | divergences below |

The two harnesses (lost-work-lib for the staff Calendar and Production; the review-stage fixture for the SMM, Kasper and
the client) serve the same card, p_t1 with sub-issue del_vid_1. The card's status, link and notes are handed over at each
step, and one in-memory backend follows `index.ts` step by step.

## FOUND

Status at Trials is as of the last retest on build 6.

### Bugs

| # | what | where | status |
|---|---|---|---|
| 1 | The client could approve a version with a change asked (skipping Q3's re-route) | logic.mjs answerPatches | **fixed** (`change_open`), verified |
| 2 | No stage order on the server (the client before Kasper and the SMM; Kasper before the SMM) | logic.mjs answerPatches | **fixed** (`stage_order`: Kasper and the client both need the SMM's OK; the client does not need Kasper's, so the SMM's "Approve to client" still works), verified |
| 3 | Approve and Approve all accepted a version with no link | logic.mjs | **fixed** (`version_has_no_link`), verified |
| 4 | A link replaced after approval kept every OK | logic.mjs linkChange | **fixed** (a replaced link on an answered version restarts it), verified |
| 5 | Multi-row writes were not atomic: a studio write mid-winner left A, B, D `lost`, C `winner`, E on trial, no winner letter and no ledger rows | index.ts applyChanges | **fixed** (rows already written are put back on a conflict), verified under Deno |
| 6 | With one live version the review page skipped the version answer: card Approved, version `waiting`, trial unable to start | 194 svTrialReviewShape | **fixed**, verified in a browser |
| 7 | A JSON `null` body threw out of the handler (500, no CORS, no log line) | index.ts | **fixed**, verified under Deno |
| 9 | **Two staff pick a winner: the card posts the wrong video.** The second, stale pick's put-back re-attaches Video A's link while C stays the winner, and healMain never repairs it | 189 svTrialPick / _trlPutBack (and _trlUndoPick) | **fixed** (6c87b2b), verified on the whole stack at 797b19b (race 15/15). A regression on builds 3 and 4 between 02:45 and 04:00 (the 2 → 3 merge dropped `_trlCall`, so every pick and Undo failed) was found and is gone. |
| 10 | A change is named for the version on screen **when it is sent**, not the one it was asked on. Any composer, plain client link included: change opened on C, a look at D, then send, marks D and the request reads "Video D: …" (the client-polish queue widens the window) | 195 :3028 wrapper then 194 svTrialReviewChangeText | **fixed on build 4** (4818a37), verified (client scenario passes) |
| 10b | Build 6: a Kasper tile's "Ask for a change" is named for whichever tile is on stage when it is sent | 194 svTrialReviewBindTiles | **fixed**, verified on 797b19b |
| 12 | A refused link on the version on the card (another version's link pasted on A; the winner's pencil after the pick) lands on the card through today's attach anyway, and the page says "did not save" | 189 svTrialLinkSave | **half-fixed** on 797b19b: the new rule (on the card = the live version whose link the card carries) keeps the display consistent, but the card still moves (B silently goes on the card) while the page says it did not save; the winner case is unchanged |
| 12b | Dropping the version on the card (new on 797b19b) attaches the next version first; a refused drop leaves the card moved while the page says "not dropped" | 189 svTrialDrop | **open**, proven in a browser on 152136d (A stays waiting, the card is on B) |
| E10 | Production: a long value on today's Deliverable file row clips "on the card" under the state pill | 245 / Production asset row CSS | **fixed** (ce0ef56: the text ellipsizes, labels stay whole; Trials' test covers it) |
| E11 | Test gap: Trials' Production test answers the asset read without `id`, `client_slug` and `team`, so today's row is never read there | test/trial-reels-production-browser.js | **fixed** (ce0ef56), verified: today's row reads "Open link · on the card · Available" |

### Rule-misses

| # | what | status |
|---|---|---|
| 8 | `version_link_set` lacked Production's attach role rule | **partly fixed** (staffAllows: admin and SMM everything, creative only links, automation read-only; no member-team check, because the shared auth gives the role only) |
| 11 | Kasper's "Approve after tweaks" on a trial card names no version and records no version answer | **fixed on build 4**, verified (it marks the version on stage; stamping the others is left to the owner) |
| 13 | The review pages offer Approve, a dot and a place in "Approve all N" for a version the server refuses for stage order (no SMM OK yet, for example after a new cut) | open (traced) |
| E1 | Review page: the bar sits above the player, with the arrows next to the label. The approved mock has the arrows beside the player, and "Video A of 5" and the dots under the video | **fixed on build 4** (7202cd7), seen at 1440 and 390 |
| E2 | The dots carry no letter (plan and mock: letter dots) | **fixed on build 4**, seen |
| E3 | Phone: arrows instead of swipe (plan §5, mock "No arrows: swipe"); the bar wraps to 104 px; the current dot's 36 px ring is heavy | **fixed on build 4** (swipe bound, "Swipe for the next version", no arrows at 390) |
| E4 | "Approve all" sits inside the bar; the mock has "Approve all (5 waiting)" in the footer | **fixed on build 4**, seen |
| E5 / K6 | "Finish reviewing" counts parts, not versions (plan §5) | **E5 fixed on build 4** (versions plus the other parts); K6 fixed on build 6 ("0 of 6": five versions and the caption) |
| E6 | Button words: plan and mock say "Approve this version"; the SMM and Kasper buttons do not name the version they approve | open |
| E7 / K3 | The player badge reads "Video", not "Video C" (R3) | **E7 fixed on build 4**, seen; K3 fixed on build 6, seen |
| E1b | Builds 4 to 6 (still on 797b19b): on the client link, the new side arrows are clipped (`.view.novid{overflow:hidden}`) whenever the version on stage has no player, which is every version but the card's own: invisible and not pressable. Fine on the SMM page | **fixed by build 7** (152136d: the client link plays every version in place, so the arrows are no longer clipped), measured |
| E8 | The card switch knob is dark in dark mode (`var(--sv-bg-fff)` flips); the approved pictures show a light knob | **fixed** (126e26f, `--sv-knob`), seen in a dark screenshot |
| K2 | Kasper layout 2: tile Approves plus the video part's own Approve and Ask for change under the player (two Approves, visual noise) | **fixed** (d2b0148), seen on 152136d: no second Approve under the player, "Frame tweaks · Video A" names the version |
| K4, K5 | Kasper layout 2: Approve all's place and style; the "5 versions" line in the left list | **fixed** (d2b0148), seen: outlined "Approve all" top-right, "5 versions" in the list (cut to "5 versi…" beside a long client name at 1440: small, owner taste) |

Held, with no finding: client_ok on a dropped version (refused), the on-card version can't be dropped, the client link
can't do any staff action, the card switch off refuses every version write, an unlisted client is refused, no hook text
anywhere, the collapsed card is today's height in every state (751 px, the same as today's card with a link), the trophy
alone with its tooltip, the Undo toast, no Yes/Cancel, and Notes matches `notes-C`.

### Proposals: owner one-liners

- **P1.** When the editor re-uploads to the same Frame.io link (a version stack), should the SMM's approve of a changed version count as "new cut reviewed" and send it back through Kasper and the client? (Today no new link means the version waits forever.)
- **P3.** Should the team be able to drop Video A, with "on the card" moving to the first live version through today's attach?
- **E9.** The phone's version rows are about 50 px apart against about 38 px in the approved picture (probably the 44 px tap rule): keep?
- **E12.** After the pick, should "Video C: the one we are posting" sit under the player, as in the mock, rather than above it?
- **K1.** Kasper's tiles are small (a 28×40 copy of the card's poster, one player below) against the mock's poster-sized tile per version: keep for speed, or match the mock?
- **E6.** Should every review button name its version ("Approve Video C"), or say "Approve this version" as in the mock?
- A second `winner` row written by the studio's log: should SyncView trust `trial_reel_cards.winner_letter` over the rows? (The studio's guard is still with the AI editor lane.)

## NOT REACHED

- A live call. The night was offline by rule; nothing touched the live database or Edge Functions.
- Kasper's second layout at 390. It needs 1360 px, so it never shows at that width.
- The staff card with the real web font (lost-work-lib blocks it; the card's text truncation there is the fallback font). The dark Notes view was taken later, from a scratch copy of Trials' Notes test, and matches `notes-C` at 1440 and 390.
- Re-checking whatever Trials pushes after build 6.

Pauses: none. No usage or rate limit was hit during the run.
