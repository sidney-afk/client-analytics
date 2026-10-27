# Trial reels: the overnight probe (session Probe, 2026-10-27)

This was an independent test of the trial reels build, done on the owner's go of 01:35 UTC. Session Trials builds the feature
and fixes what is found; this session built nothing in the feature. Everything ran offline, with fictional data and
no live writes. The plan is `docs/features/TRIAL_REELS_PLAN.md` (PR #2352). The tests are on branch
`test/trial-reels-journey`, draft PR **#2365**, stacked on build 6. **Do not merge it; the owner holds every trial reels merge.**

Builds tested: build 5 at `b76a6e31b` (start of the night), then build 6 at `1685d4eaa` with Trials' fixes merged in.

## DONE (verified, pushed)

| what | where | result on build 6 |
|---|---|---|
| The whole journey of one 5-version card in one run. Links are pasted on the card and in Production. The SMM OKs, then asks a change on C. C's new cut. Kasper's Approve all. The client approves two versions one at a time, then Approve all, and the card goes Approved through today's save. Then the trial, the 24 h timer, the trophy, the winner, Undo, the winner again. The client sees only the winner. Posted (Undo and a new pick are refused). Switch off. At every step it checks the card status, each version's label, that the card has one link (file_url = asset_url = the version on the card), the ledger rows, and that nothing writes when the switch is off or the client isn't listed. | `test/trial-reels-journey-browser.js` | **90 / 90** |
| The rules the plan asks for and logic.mjs lacked (bugs 1 to 4) | `test/trial-reels-probe-logic.js` | 10 / 10 (8 failed on build 5) |
| Bugs 5 and 7 on the real `index.ts` under Deno | `test/trial-reels-probe-deno.ts` | 7 / 7 (3 failed on build 5) |
| One live version (bug 6), on the client review page | `test/trial-reels-one-live-browser.js` | 4 / 4 (2 failed on build 5) |
| Two staff pick a winner at once (bug 9) | `test/trial-reels-race-browser.js` | **2 / 4: still open** |
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
| 2 | No stage order on the server (the client before Kasper and the SMM; Kasper before the SMM) | logic.mjs answerPatches | **fixed** (`stage_order`; the client only needs the SMM's OK, so the SMM's "Approve to client" still works), verified |
| 3 | Approve and Approve all accepted a version with no link | logic.mjs | **fixed** (`version_has_no_link`), verified |
| 4 | A link replaced after approval kept every OK | logic.mjs linkChange | **fixed** (a replaced link on an answered version restarts it), verified |
| 5 | Multi-row writes were not atomic: a studio write mid-winner left A, B, D `lost`, C `winner`, E on trial, no winner letter and no ledger rows | index.ts applyChanges | **fixed** (rows already written are put back on a conflict), verified under Deno |
| 6 | With one live version the review page skipped the version answer: card Approved, version `waiting`, trial unable to start | 194 svTrialReviewShape | **fixed**, verified in a browser |
| 7 | A JSON `null` body threw out of the handler (500, no CORS, no log line) | index.ts | **fixed**, verified under Deno |
| 9 | **Two staff pick a winner: the card posts the wrong video.** The second, stale pick's put-back re-attaches Video A's link while C stays the winner, and healMain never repairs it | 189 svTrialPick / _trlPutBack (and _trlUndoPick) | **open**, proven by `test/trial-reels-race-browser.js` |
| 10 | Client polish's change queue names the version on screen **when it is sent**, not when it was asked | 195 _rsCpDrain then 194 svTrialReviewChangeText | **open** (traced) |
| 10b | Build 6: a Kasper tile's "Ask for a change" is named for whichever tile is on stage when it is sent | 194 svTrialReviewBindTiles | **open** (traced) |
| E10 | Production: a long value on today's Deliverable file row clips "on the card" under the state pill | 245 / Production asset row CSS | sent |
| E11 | Test gap: Trials' Production test answers the asset read without `id`, `client_slug` and `team`, so today's row is never read there | test/trial-reels-production-browser.js | sent |

### Rule-misses

| # | what | status |
|---|---|---|
| 8 | `version_link_set` lacked Production's attach role rule | **fixed** (staffAllows: admin and SMM everything, creative only links, automation read-only) |
| 11 | Kasper's "Approve after tweaks" on a trial card names no version and records no version answer | open |
| E1 | Review page: the bar sits above the player, with the arrows next to the label. The approved mock has the arrows beside the player, and "Video A of 5" and the dots under the video | open |
| E2 | The dots carry no letter (plan and mock: letter dots) | open |
| E3 | Phone: arrows instead of swipe (plan §5, mock "No arrows: swipe"); the bar wraps to 104 px; the current dot's 36 px ring is heavy | open |
| E4 | "Approve all" sits inside the bar; the mock has "Approve all (5 waiting)" in the footer | open |
| E5 / K6 | "Finish reviewing" counts parts, not versions (plan §5) | open |
| E6 | Button words: plan and mock say "Approve this version"; the SMM and Kasper buttons do not name the version they approve | open |
| E7 / K3 | The player badge reads "Video", not "Video C" (R3) | open |
| E8 | The card switch knob is dark in dark mode (`var(--sv-bg-fff)` flips); the approved pictures show a light knob | open |
| K2 | Kasper layout 2: tile Approves plus the video part's own Approve and Ask for change under the player (two Approves, visual noise) | open |
| K4, K5 | Kasper layout 2: Approve all's place and style; the "5 versions" line in the left list | open |

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
- A browser proof of bugs 10, 10b and 11. They are traced in code only.
- Kasper's second layout at 390. It needs 1360 px, so it never shows at that width.
- A dark Notes screenshot (Trials' Notes test draws light only), and the review page with the real web font in the staff harness (lost-work-lib blocks it; the card's text truncation there is the fallback font).
- Re-checking whatever Trials pushes after build 6.

Pauses: none. No usage or rate limit was hit during the run.
