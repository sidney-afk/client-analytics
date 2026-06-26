---
name: overnight-test
description: Run exhaustive, AUTONOMOUS, CONTINUOUS real-headless-browser testing of the SyncView app. Drives every interaction (the Samples review lifecycle across SMM/Kasper/Client, every field/paste/status/link, Linear sync, then the rest of the app) through the real UI against the live backend with Linear mocked — logging results, self-correcting probe bugs, and running back-to-back with NO idle gaps until interrupted. Use when the user wants thorough unattended/overnight QA with maximum coverage and a morning report.
---

# Overnight autonomous test run

You are running an unattended, long-running QA session for the SyncView app
(single-file `index.html`). Your job is to verify as many distinct user
interactions as possible through a REAL headless browser, focusing first and
hardest on the **Samples (Review)** feature, then sweeping the rest of the app.
Leave a clear report behind. **Do not stop on your own.**

## 0. Continuous execution — THE most important rule

Run as ONE long continuous session. After each probe: archive seeds, append to
the report, commit/push, and **IMMEDIATELY start the next probe in the SAME
turn.**

- **Do NOT use `/loop`, `ScheduleWakeup`, `CronCreate`, `sleep`, or any
  wait/wakeup between batches.** There is no external event to wait for — probe
  authoring is CPU-bound work you can do back-to-back, so do it back-to-back.
  (Pacing yourself with 20-minute naps wastes the whole night.)
- **Do NOT end your turn, hand back, or ask questions.** When your context
  fills, the harness auto-compacts and you continue seamlessly from the report's
  "NOT YET COVERED" list — just keep going through the compaction.
- **Never declare the task "done."** When one area runs dry (several passes find
  nothing new), move to the next and keep widening coverage indefinitely.
- The ONLY reasons to stop: the user interrupts you, or the environment ends.

> To launch this, the user pastes the task and lets it run (Bypass-permissions
> on). They should NOT prefix with `/loop` — that re-introduces the idle gaps
> this skill exists to avoid.

## 1. Hard safety rules (never violate)

- **TEST CLIENT ONLY:** `sidneylaruel` (display "Sidney Laruel"). Never touch any
  other client's data.
- Every row you create uses a unique `sr_*` id, and you **archive everything you
  create** on exit (`status: 'Archived'`). Leave the backend as clean as you
  found it — and run a safety sweep each iteration to confirm no stray rows.
- **LINEAR IS MOCKED — never let a status push/comment reach real Linear.** The
  harness stubs the `linear-*` webhooks (see `qa/sxr_courier_lib.js`:
  `linearCalls` / `resetLinearCalls` / `setSubissuesResp`). Verify capture works
  before relying on it; never allow a call to `api.linear.app` or the live
  `linear-set-status` / `linear-add-comment` webhooks.
- **Assert 0 app JS errors** on every probe (`appErrs(page)` — it already filters
  the expected realtime-WebSocket noise under the courier).
- **Run the static server as a CHILD of each probe command** (it dies between
  Bash calls otherwise):
  `python3 -m http.server 8000 & SRV=$!; sleep 1.5; node qa/probes/<x>.js; EC=$?; kill $SRV; exit $EC`
- The sandbox proxy blocks the BROWSER's own egress, so the harness runs the real
  app in real Chromium and couriers backend calls via Node/curl. Keep the courier
  ON (default).
- **Work on a dedicated branch (NOT main)** — e.g. `claude/overnight-test-*`.
  Commit new probes + the running report every iteration or two so nothing is
  lost to compaction / container recycling. Do not push to main.

## 2. Infrastructure (read these first, every fresh context)

- `qa/sxr_courier_lib.js` — the harness. Exports: `launch, open, smm, client,
  kasper, up, upCal, reorder, supa, supaCal, supaEvents, poll, appErrs,
  linearCalls, resetLinearCalls, setSubissuesResp` (+ `archiveSafe` if present —
  close-then-archive-then-verify cleanup). Read it fully.
- `qa/probes/sxr_*.js` — existing probes; READ them to learn the patterns, then
  write MANY more. (`sxr_m1_render` … `sxr_m5b_client`, `sxr_m4_linear`, plus any
  `sxr_a*/c*/d*` from prior overnight runs.)
- `test/*.js` + `node test/run-all.js` — the pure-logic unit gate (brace-extracts
  the REAL shipping functions). Keep it green.
- `docs/HEADLESS-TESTING-GUIDE.md` — rules of the road.
- `qa/OVERNIGHT_TEST_REPORT.md` — the running report you maintain (resume from its
  "NOT YET COVERED" list).
- Flag `?sxr=1` (default OFF). Surfaces:
  - SMM/editor: `/index.html?sxr=1&v2debug=1#sample-reviews/sidneylaruel`
  - Client share: `/index.html?sxr=1&c=Sidney%20Laruel&v=sample-reviews&v2debug=1`
  - Kasper: `/index.html?Kasper=1&sxr=1&v2debug=1#kasper` then `_kasperGotoTab('samples')`

## 3. The interaction matrix — cover ALL of it, then go deeper

Drive the REAL UI (clicks/typing/paste), then read back the live `sample_reviews`
row to confirm persistence, and check `sample_review_events` for the audit trail.

**A) Review lifecycle** — for BOTH components (video + graphic) and ALL THREE
actors (SMM, Kasper, Client): every transition In Progress → For SMM Approval →
Kasper Approval → Client Approval → Approved; Kasper approve / request-tweak /
approve-after-tweaks / undo-approve / Finish / Close; Client approve /
request-change (valid only at Client Approval / Tweaks Needed); SMM resolve a
tweak → route to Kasper vs straight to Client vs Approved vs Stay (the
`#sxrResolveDestOverlay` chooser); stale-approval clearing when a sub drops below
Client Approval; overall = worst-of(video, graphic), never Scheduled/Posted;
`kasper_seen` / `approved_after_tweaks` bookkeeping; same-tick double-click = one
effect; audit events per change.

**B) Samples Linear sync (MOCKED):** outbound push on a status change
(video→video issue, graphic→graphic issue, never overall); no push for an
unchanged component; suppression breaks the inbound→outbound echo; durable outbox
retry on push failure; point-adoption on a freshly-set link; stale-regress (a
stale Linear round-trip is kept local + re-asserted); tweak-comment posted on a
change-request; `__CLEAR_LINK__` sentinel on link clear; link dedup/conflict
across two samples.

**C) Every SMM field interaction:** name; video URL (asset_url) + open button;
thumbnail URL + open button; creative-direction textarea + autosize;
hide-from-client eye toggle; both Linear links (paste / commit-on-blur / clear /
move to another card); status pills (click → menu → change); comments (add note,
add change-request, reply, resolve, internal-vs-client audience gating);
drag-reorder (order_index persists); Saving/Saved/error/retry indicator;
optimistic save + rollback on a forced failure; thumbnail derivation from
YouTube / Google-Drive / direct-image URLs (+ `_r` cache-bust on change).

**D) Client share surface:** render-gating (review controls ONLY at Client
Approval / Tweaks Needed; read-only line otherwise; empty review body when all In
Progress; "approved" terminal line); approve + request-change per component;
FIELDS stay non-editable (no `[data-sxr-fld]` editors / grips / pills leak — note
the request-change composer textarea is a legitimate control, not a field
editor); internal SMM/Kasper notes never visible; persist-guard (a client link
may only write review-action columns).

**E) Kasper surface:** Samples sub-tab gated by the flag; cards show the SAMPLE
badge; cross-client paginated queue surfaces the row; Kasper actions persist;
bidirectional isolation (samples never appear in the calendar review queue and
vice versa).

**F) Isolation / flag-off:** with `?sxr` OFF the nav is hidden and no `_sxr` code
runs; calendar↔samples are fully isolated; the OLD samples module is untouched.

**G) Realtime / multi-actor:** simulate cross-tab pushes (`routeWebSocket` mock)
and confirm the background reload + self-echo window; concurrent field patches by
different actors merge field-level; the recent-save window protects a fresh
approval.

**H) THEN the rest of the app** (same rigor, same safety, test client only): the
content calendar (its review lifecycle, fields, Linear, drag, comments), Kasper
for the calendar, the client share for the calendar, the onboarding form, TikTok
upload/pilot, templates — every clickable thing, every paste/copy, every status
change, every link field.

## 4. The loop (repeat continuously — see §0)

1. Pick the next uncovered interaction (or a deeper edge / concurrency / fuzz
   variant of a covered one: rapid double-clicks, malformed input, out-of-order
   writes, archived rows, missing links).
2. Write/extend a focused probe that drives it through the real UI against the
   live backend (Linear mocked), seeded on `sidneylaruel` with unique `sr_*` ids.
3. Run it (server-as-child). Assert UI behavior + live DB read-back + 0 JS errors.
4. Append the result to `qa/OVERNIGHT_TEST_REPORT.md` (timestamp, interaction,
   PASS/FAIL, evidence).
5. On FAIL: capture a minimal repro and root-cause it. If it's a clear product
   bug with a safe fix, fix it + add a regression test + note it. If it's a probe
   bug, fix the probe. If ambiguous/risky, log it under "BUGS — NEEDS REVIEW"
   with repro + diagnosis. Either way KEEP GOING.
6. Archive seeds (use `archiveSafe`: close the browser first, then archive, then
   verify zero stray rows). Commit + push (probe + report). Loop — go straight to
   the next probe; do not pause.
7. Loop-until-dry: only call an area "covered" after several passes find nothing
   new, then move to the next.

## 5. Morning deliverable

Keep `qa/OVERNIGHT_TEST_REPORT.md` current and committed:
- total interactions tested + pass/fail counts;
- a table of every interaction + result;
- a **BUGS FOUND** section (repros + any fixes you made);
- an **OBSERVATIONS** section (behaviors worth a product decision, not bugs);
- a **NOT YET COVERED** section so the next run resumes cleanly.
Also keep `node test/run-all.js` green.

## 6. Lessons from prior runs (don't relearn these)

- The courier mis-parsed an HTTP/2 status line once (`HTTP/2 200` → `2`), which
  silently sent the FE flush into its `catch` so the post-save success path never
  ran under the courier. If page-side effects (Linear push, recent-save)
  mysteriously don't fire even though the DB row persisted, suspect the courier
  status parse, not the app.
- Most first-pass failures are PROBE bugs, not product bugs: `_isClientLink` is
  module-scoped (not on `window`); the client request-change composer is a
  legit `<textarea>` (only count `[data-sxr-fld]` as field editors); in-place
  open-button toggles fire on **blur**, not `input`; status writes need a
  **poll-until-the-DB-reads-the-new-status** before the next step (don't assume a
  fire-and-forget save has settled).
- Seed cleanup can race a trailing browser flush — close the browser BEFORE
  archiving, then verify the row is actually `Archived`.
- An all-In-Progress sample still renders a bare read-only card shell on the
  client surface; only the review *body* is gated off (OBS-1) — expected, not a
  bug.
