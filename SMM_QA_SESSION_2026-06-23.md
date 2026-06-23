# SMM QA Session — 2026-06-23

Real, headless-browser testing of the live SyncView app driving the **same
`index.html`** the site serves, against the **live** Supabase + n8n backend.
Simulated a social-media-manager's day: create cards, paste Linear links, create
Linear issues, generate captions, add notes, set statuses, archive, and a run of
deliberately out-of-the-ordinary inputs to flush out bugs.

**Scope:** only the **Sidney Laruel** test client (`sidneylaruel`) and Sidney's
Linear project. Everything created was named `test*`. The client was left exactly
as found (see *Cleanup*). The live n8n workflows were **not** modified — the one
caption-cancel test that needed the generate-caption workflow used in-browser
network stubbing so nothing reached the live workflow.

## Headline result

- **1 real bug found and fixed** (caption cancel race — details below), with a
  committed regression test.
- Everything else tested came back **solid**: 7 new live probe suites + the 6
  existing cross-surface golden flows + the 21 offline unit tests all green.

---

## The bug (fixed)

**Caption Cancel didn't fully cancel: a late result could sneak a caption onto a
cancelled card.**

- **Where:** `_calCapJobSettle` (caption job state machine).
- **Symptom:** If the user clicks **Cancel** on a running "Generate caption" job
  and the backend's generate result finishes racing that cancel, the returned
  caption was still written into the card's caption box. The settle path guarded
  against clobbering *typed* text but had **no `cancelRequested` guard**, so an
  explicitly-cancelled job could still apply its result. This contradicts the
  documented guarantee ("a late result doesn't sneak in", CALENDAR-TEST-CATALOG
  §4.4). (It only hit the in-memory UI, not the backend, so it self-heals on
  reload — but it visibly undoes the user's cancel.)
- **Fix:** settle now coerces a still-`cancelRequested` job to `cancelled` and
  drops the late caption before the apply block. If the cancel POST itself failed
  (`_calCancelCaptionJob` clears `cancelRequested`), legitimate generation still
  completes — so a failed cancel doesn't accidentally swallow a real result.
- **Proof:** a network-stubbed headless cancel-race probe — start a job (stubbed
  generate-caption that returns a caption after a delay), hit Cancel mid-flight,
  and assert the late caption is **not** applied. Red before the fix, green after.
- **Commit:** `fe6d8e6` — *"Caption cancel: a late backend result no longer
  overwrites a cancelled card"* (+ wiring assertion added to
  `test/caption-cancel-grace.js`).

---

## Coverage (all green unless noted)

| Area | What was exercised | Result |
|---|---|---|
| **Create card** | real "+" add → type → save; empty = no row; idempotency; persists on reload; fuzz names (XSS / emoji+RTL+CJK / 1200-char / `">` quote-break) stored verbatim, no script exec | 11/11 ✅ |
| **Linear links** | valid VID→video, valid GRA→graphic, plain text rejected, non-Linear URL rejected, VID/GRA wrong-slot confirm, **same link on two cards → "Move it here"** (no two-cards-one-issue) | 14/14 ✅ |
| **Notes / comments** | video note → routed to **real Linear sub-issue** (verified on Linear), caption note stored (no leak to video), team vs client **audience filter cross-surface**, XSS body safe | 10/10 ✅ |
| **YouTube title review** | send title for review → **change the title** (live update, no strand/desync) → Kasper sees the new title; **remove YouTube mid-review** clears `title_status` and drops the card from Kasper | 13/13 ✅ |
| **Captions** | guards: no-asset / non-Frame.io / already-has-caption (no webhook fired); **Cancel mid-flight** race (stubbed) | 10/10 ✅ (after fix) |
| **Set all to… / Archive** | set-all moves all 3 components; locked (unlinked) video/graphic correctly skipped; single archive cross-surface (leaves Kasper); **multi-select bulk archive** | 10/10 ✅ |
| **Drag-reorder + Undo** | reorder commit persists to the backend and survives reload; **Undo** restores the exact prior order and persists | 8/8 ✅ |
| **Kasper Messages inbox** | internal SMM/team note surfaces in Kasper's Messages; Kasper reply threads + persists; replied card clears from the inbox and stays cleared (seen-stamp) | 7/7 ✅ |
| **Concurrency** | two surfaces comment the same thread at once → **atomic merge, no lost message**; double-submit archive idempotent | 5/5 ✅ |
| **Dates / timezone** | round-trip under `America/Argentina/Buenos_Aires`: month-edge, year-edge, **leap day 2028-02-29** stored exactly + rendered with no off-by-one | ✅ |
| **Cross-surface settings** | client (fresh context) reads the same `enabled_platforms` as the shared settings row | ✅ |
| **Golden cross-surface flows** | the 6 existing `qa/golden_*` end-to-end Kasper↔client↔SMM flows | 49/49 ✅ |
| **Offline unit suite** | `test/*.js` | 21/21 ✅ |

---

## Observations (not bugs, worth a look)

- **No in-app "Undo" or un-archive for Archive.** Drag-reorder has a working Undo
  toast (verified), but **Archive does not** — it shows a confirm ("kept/
  recoverable in the sheet") and removes the card, with no Undo toast and no UI to
  un-archive (recovery is out-of-band). CALENDAR-TEST-CATALOG §4.6/§9 list "Archive
  → Undo", so either the doc is ahead of the app or the affordance was dropped.
  Flagging in case an Undo was intended for archive too.

## Linear artifacts (test, cleaned up)

- Created `VID-12715` and `GRA-6444` ("test syncview probe …") in the **Sidney
  Laruel** project to exercise real link-pasting. The video-note routing test left
  one comment on `VID-12715`. Both issues were **set to Canceled** at the end so
  they drop off the editors' active board (recoverable if needed).

## Cleanup / left-as-found

- Every calendar card created by the probes was archived (incl. 4 orphaned by a
  mid-run static-server restart).
- The 3 standing fixtures **TEST 1/2/3** were briefly archived by mistake early on
  and **restored to Approved** (consistent with their linked Linear issues).
- Sidney's settings row was **not** modified — `collab_mode`, `title_review`, and
  `enabled_platforms` are unchanged.
- The live n8n workflows were not touched.

## How to reproduce

Probes live in the session scratchpad (not committed). Method + harness:
`docs/HEADLESS-TESTING-GUIDE.md`. The committed regression for the fix is in
`test/caption-cancel-grace.js`. Pre-push ritual (syntax + 21 offline tests) is
green.
