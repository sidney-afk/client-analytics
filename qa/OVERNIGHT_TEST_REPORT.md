# Overnight Autonomous Test Run — SyncView

---

# RUN 4 — 2026-07-18 · Quality-tier contract run (Tier 0 client-first)

**Branch:** `claude/overnight-quality-tier-test-yicxg8` · **Test client:** `sidneylaruel` ONLY · Linear MOCKED via harness · `write_ui_reroute` stubbed DARK (test client behaves like a real client) · courier ON. Window 03:45–07:45 UTC (hard stop; calendar nightly fires 08:00 UTC).

## Mission (owner's priority order)
1. **Tier 0 — CLIENT EXPERIENCE** (most of the night): the `?c=` review links exactly as a real
   client uses them — loads, approve/comment/request-change, saves proven in the backend every
   time, thumbnails/media, token link, reload/mobile, slow network.
2. **Tier 1 — SMM**: calendar planning + writes, resolve/route, share-link issuance, Submit intake.
3. **Tier 1 — Kasper (light)**: queue/approve/request-change; **document** Finish only (F140 in flight — hands off).
4. Rest of the app if time remains. Findings + probe fixes only — NO product-code changes.

## Field conditions found at start (03:45 UTC)
- Backend reachable through the proxy; harness (courier + Linear mock + archiveSafe) verified
  green via `sxr_client_persist_guard.js` (pass=5) before any new probe.
- **Pre-existing non-archived debris on the test client** (NOT created by this run):
  - `sr_scn_*` scenario rows created 2026-07-18 01:05 and 03:36–03:37 UTC (a scheduled/manual
    scenario run leaked them minutes before this session), plus two older `sr_scn_video__smm_request_*`
    from 07-15/07-17. → archived at end-of-run cleanup (clearly QA-pattern ids).
  - `sr_mrgu*` "UI Batch/Workflow/Create…" rows from 2026-07-11 21:05–21:09 UTC — cold-open
    UI-journey probes that never archived. → archived at end-of-run cleanup.
  - `Sample 1 ` (sr_mqvenh27, 06-26) and calendar `TEST 1/2/3` — look owner-created; LEFT ALONE.
- **The samples nightly (`samples-e2e-nightly.yml`) fires 06:00 UTC — inside this window.**
  Mitigation: no samples-backend mutations ~05:55–06:30; monitored for its rows.

## Interaction log

| # | UTC | Surface | Interaction | Result | Evidence |
|---|-----|---------|-------------|--------|----------|
| 0 | 03:50 | Client samples | Harness smoke: legit approve persists; forced non-review columns land only via page funnel (known OBS-4) | ✅ pass=5 | `sxr_client_persist_guard.js` |
| 1 | 04:05 | Client samples | FULL journey: load → both panels render → thumbnail real bytes → typed comment (status unchanged) → approve video (DB + `client_video_approved_at`) → typed request-change (DB status+text) → worst-of overall → toast + designed card hand-off → audit events both comps → fresh reload keeps queue emptied → 0 JS errors → archive verified | ✅ pass=21 fail=0 | `ot4_t0_client_samples.js` |
| 2 | 04:09 | Client samples | SAVES-ALWAYS-LAND: 3 sequential approvals (each ~2 s to DB), 3 rapid typed request-changes fired 0.9 s apart (all landed with text), same-tick double-click → ONE status change, exactly one audit event per action (7/7) | ✅ pass=10 fail=0 | `ot4_t0_client_saves_reliability.js` |
| 3 | 04:14 | Client calendar | FULL journey on `?c=…&v=calendar`: load → panels → thumbnail bytes → typed comment (status kept) → approve video (+stamp) → typed request-change (status+text+worst-of+toast) → fresh reload reads back persisted statuses → 0 JS errors → tombstone + archive | ✅ pass=18 fail=0 | `ot4_t0_client_calendar.js` |
| 4 | 04:20 | Client both | Failure-injection scoping (dbg): approve-fail = rollback + visible panel error + button re-enabled (GOOD); request-change-fail = SILENT on samples AND calendar (→ BUG F-1) | 🔎 | dbg4/dbg5, then probe #5 |
| 5 | 04:35 | Client samples | EDGE CONDITIONS: token link (?t=) loads + approve lands · mobile 390×844 controls fit + typed request lands · slow network (4 s delay) honest saving state + save lands + no error · failure injection = F-1 characterized (detected internally, invisible to client, DB untouched) + reload/recovery re-send lands | ✅ pass=21 fail=0 | `ot4_t0_client_edge_conditions.js` |
| 6 | 04:33 | SMM samples | Resolve-destination chooser, ALL routes: kasper / client / approved / stay on video + kasper on graphic (scenario library, real DOM) | ✅ 5/5 scn, 25/25 | `run_scenarios.js resolve_via` |
| 7 | 04:42 | Kasper samples | Queue load + request-change (video) + approve-after-tweaks + split approve-v/request-g (real Kasper sub-tab clicks) | ✅ 3/3 scn, 10/10 | `run_scenarios.js kasper_*` |
| 8 | 04:50 | Kasper samples | Finish documentation (F140 hands-off): flat `kasper_finish_video` green 4/4 AND the F140 tree path `graphic__smm_approve__kasper_request__finish` green 8/8 under the courier on today's main | ✅ (see F140 note) | scenario runner |

| 9 | 05:05 | SMM calendar | DAILY PLANNING journey, cold-open via real Sheet UI: "+" → typed name born as DB row → date control → thumbnail paste (blur) → caption typed → VID Linear link paste unlocks the pill (design gate: "Link a Linear sub-issue first") → status pill menu flip → all writes polled into `calendar_posts` → hard reload renders every value → 0 JS errors | ✅ pass=22 fail=0 | `ot4_t1_smm_calendar_writes.js` |

### F140 status note (documentation only — no product code touched)
- The registered deterministic repro (`kasper.finish() → disabled` after a Kasper tweak request
  on a graphic-only card) **did NOT reproduce tonight**: tree path green 8/8 at 04:50 UTC under
  the courier harness on this branch (= main of 07-18).
- GitHub Actions truth: samples nightly red 5 consecutive scheduled nights (07-13 → 07-17, all
  on main), AND a `workflow_dispatch` on branch **`agent/f140-kasper-finish-reviewing`** ran at
  03:50 UTC today and FAILED — the separate F140 fix effort is active right now. The leaked
  03:36–03:37 `sr_scn_*` rows found at session start almost certainly belong to that effort.
- Read carefully: the nightly's red may be multi-cause (F141 drag-reorder is also registered);
  a green F140 path under the courier does not prove the nightly path (SXR_COURIER=0, open
  egress) is green. Morning triage should diff tonight's 08:2x nightly result against this note.
- Ops reality check: the "06:00 UTC" nightly actually STARTS ~08:20 UTC (GitHub cron delay,
  5/5 recent runs) — i.e. after this run's 07:45 hard stop, not inside it as feared.

## BUGS FOUND

### F-1 · Tier 0 · A FAILED client "Request change" is completely SILENT (samples + calendar client links)
**Repro (probe-verified):** client link, component at `Client Approval`; make the save endpoint
fail (5xx / offline); type a change request and click **Request change**.
**What happens (both surfaces, verified live 04:18–04:21 UTC):**
- The optimistic flip to `Tweaks Needed` is NOT rolled back in the page (approve's `_saveError`
  branch rolls back; `_sxrReviewRequestTweak`/`_calReviewRequestTweak`'s does not).
- At `Tweaks Needed` a client-link panel is no longer review-active → the panel body that would
  display `_sxrReviewState.errors[key]` ("HTTP 500") is **not rendered** — the recorded error is
  invisible. No toast (correctly no success toast, but no failure toast either), no card-level
  "Save failed · Retry" control on the client card, and the typed draft is cleared.
- The DB is untouched. On reload the server truth returns (`Client Approval`) and every trace of
  the client's request is gone.
**Impact:** a client on a flaky connection believes they sent a change request; the team never
receives it. Exactly the "approval/feedback silently vanishes" class the owner called worst-case.
**Contrast:** the client APPROVE failure path is healthy — rollback + visible `HTTP 500` panel
error + re-enabled button (verified same session).
**Suggested fix (NOT applied — findings-only run):** in the `_saveError` branch of both
request-tweak handlers, mirror the approve path (`Object.assign(current, prev)` + restore
`drafts[key]`), so the panel re-renders active with the error visible and the text recoverable;
or render review-save errors at card level when the acted panel is inactive. Add a regression
probe either way (probe #5 characterizes today's behavior).

## PROBE BUGS FIXED (tester-side, not product)
- P-1: probes queried `graphic_comments` — the real column is `{comp}_tweaks`
  (`_sxrStringifyComments` → `video_tweaks`/`graphic_tweaks`). A bad column in a PostgREST
  `select` poisons the WHOLE query (42703) → every assert sharing that select read as
  "write never landed". Chased as a Tier-0 silent-loss suspect for ~20 min before the
  column check exonerated the app. Lesson recorded below.
- P-2: toast + card-removal asserts must be read immediately after the acting click —
  toasts expire and the client card hand-off is instant; reading after a 35 s DB poll flakes.

## OBSERVATIONS (design truths verified in code, not bugs)
- OBS-R4-1: for a CLIENT link, a component is review-active ONLY at `Client Approval`
  (`_sxrReviewComponentActive` explicitly excludes Tweaks Needed for `_isClientLink`).
  After the client's own request-change the card leaves their queue — live AND on fresh
  reload — until the team routes it back. "Change request sent — the team has been
  notified" toast is the designed hand-off signal.

## NOT YET COVERED (resume here)
- Tier 0: saves-reliability loop (N approvals/requests, 100% landing + same-tick double-click);
  calendar client share journey; token link; mobile viewport; slow-network + failure-injection
  (announced, input preserved); reload persistence for still-active cards.
- Tier 1 SMM: calendar planning writes; resolve/route chooser; share-link issuance (mock EF);
  Submit intake receipts.
- Tier 1 Kasper: queue/approve/request-change; Finish behavior DOCUMENTATION only (F140).

## Lessons for the next run
- `sample_reviews` comments columns are `video_tweaks`/`graphic_tweaks` — NOT `*_comments`
  (that's the in-memory name). A wrong column inside `select=` fails the whole PostgREST read.
- `pkill -f "http.server 8000"` from inside a compound Bash command kills the CALLER (the
  pattern matches your own command line). Kill by port: `fuser -k 8000/tcp`.

---

---

# RUN 3 — 2026-07-03 · Full SyncView overnight QA loop

**Branch:** `claude/overnight-syncview-qa-20260702-204925` · **Test client:** `sidneylaruel` ONLY · Linear MOCKED via harness.

## Mission
Run continuously while Sidney sleeps across the Social Media Manager calendar,
Kasper review, Client review, Samples New, realtime/two-tab adoption, Calendar
create-via-UI, and master tester lanes. The goal is not just a green smoke pass:
log every red case, keep cleanup safe, and leave enough evidence tomorrow to fix
real bugs instead of guessing.

## Runner upgrade before start
- Updated `qa/overnight_runner.sh` for Sidney's Windows/Git Bash setup: uses
  `python` instead of missing `python3`, and the full Node path instead of the
  `winpty node` alias that dies in background shells.
- Added the post-PR #656 guards to the loop: `p90_merge_midsave_keep.js`,
  `p91_ui_realtime_multitab.js`, `p89_cal_create_via_ui.js`, fresh-card workflow
  scenarios, create/archive/rename/reorder/reload/remote-merge scenarios, and
  fast master.
- Added persistent per-command logs under `qa/overnight-output/` and a compact
  summary stream in `qa/overnight_runner.log`.
- Cleanup sweeps both `sample_reviews` and `calendar_posts` test rows after each
  probe/batch and reports live leftovers.

## Initial smoke before unattended start
- `sxr_bug_repros.js` passed: `pass=4 fail=0`.
- `sxr_concurrency.js` passed: `pass=8 fail=0`.
- cleanup after both: `live_test_rows sample_reviews=0 calendar_posts=0`.

## Live log
See `qa/overnight_runner.log` and `qa/overnight-output/*.log`.

## 2026-07-03 06:50 UTC morning handoff checkpoint
- Stopped the overlapping local cron/runner activity before the controlled pass, then archived all live test rows matching the QA naming/id patterns. Final cleanup sweep: `sample_reviews=0`, `calendar_posts=0` active test leftovers.
- Root-caused the remaining `master --profile=fast` red to the tester scenario `create_via_ui_workflow_video`, not app code: the scenario intended a video-only UI-born workflow but left the thumbnail component `In Progress`, so the sample's overall/worst-of state never became client-reviewable after Kasper approval. The Kasper/client empty states were therefore expected. Fixed the scenario seed patch to mark `graphic_status: 'Approved'`, matching the existing video-only scenario pattern.
- Focused verification: `SXR_COURIER=0 node qa/probes/run_scenarios.js create_via_ui_workflow_video` → ✅ `21/21` assertions.
- Full fast master verification with an already-running static server: `MASTER_CHANGE_NOTE="harness cleanup no phantom archive posts singleton overnight runner and video-only UI workflow fix" SXR_COURIER=0 node qa/master.js --profile=fast --no-server` → ✅ unit `34/34`, parity ✅, probes ✅, scenarios `12/12` and `87/87`, visual capture `1/1` and `15/15`; pass/fail lanes all green.
- Visual review: inspected all 6 `clean_both` screenshots from `/tmp/qa/scn`; verdict ✅ pass. Captured states show expected approval, saving, and empty-queue transitions with no clipping, broken layout, or error UI. Notes recorded in `qa/visual/VISUAL_REVIEW.md`.
- n8n check: recent failure `180057` on `Sample Review — Upsert` was a `Build Row From Patch` Code-node runner timeout after 60s for a cleanup archive payload, not an app assertion failure. Final repo-side cleanup still verified zero active QA leftovers. Keep watching n8n task-runner capacity if these recur.
- Risk controls used: live mutations limited to the `sidneylaruel` QA client, `SXR_COURIER=0`, Linear mocked by the harness, no n8n workflow edits, no production app-code changes, cleanup after each run, and singleton runner lock to prevent duplicate same-client mutation.
- Current intentional code delta: `qa/scenarios.js` only. Report/visual-review notes are documentation artifacts for this handoff.
- Rollback if needed: `git checkout -- qa/scenarios.js qa/OVERNIGHT_TEST_REPORT.md qa/visual/VISUAL_REVIEW.md`.

## 2026-07-03 06:20 UTC durable cron chunks
- `proc_ad44ea6b31cf` received an external `TERM` while running `sxr_gating_flags`; the new trap confirmed the runner itself did not decide to stop. The probes before the signal were green (`sxr_bug_repros`, `sxr_concurrency`).
- To avoid depending on one long Hermes background terminal, added bounded cron chunks: `qa/overnight_cron_chunk.sh` rotates through probe groups, scenario batches, Calendar probes, and fast master in separate no-agent scheduler ticks.
- Extended `qa/overnight_runner.sh` with `RUN_PROBES/RUN_SCENARIOS/RUN_CALENDAR/RUN_UNIT` plus offset/limit knobs, so cron can run short non-overlapping slices while keeping the singleton lock and cleanup protections.
- Validation: shell syntax, dry-run phases 0 and 5, and a focused live one-probe runner chunk passed (`sxr_bug_repros.js`, `pass=4 fail=0`).

## 2026-07-03 06:12 UTC stale runner notification + restart
- The `proc_6f6378f6f636` exit notification was from the pre-singleton overlapping runner. Its red lines are the same duplicate-runner interference class already fixed by `dc8e327`.
- The locked runner `proc_f8084a1d6f65` then passed `sxr_bug_repros`, `sxr_concurrency`, `sxr_gating_flags`, and `sxr_cold_open`, but exited `143` after that without a runner-side TERM log. Added explicit INT/TERM log traps so any future external stop is visible in `qa/overnight_runner.log`.
- Cleaned stale port 8000 server and archived remaining test rows (`sample_reviews=0`, `calendar_posts=0`) before restart.

## 2026-07-03 05:55 UTC singleton-lock hardening
- The second exit notification (`proc_4193f6ab15f2`, code 3840) came from a stale duplicate runner that was still using the pre-lock command. It overlapped with the newer runner on the same `sidneylaruel` test client and port 8000, so its red lines were tester interference: one runner stopped the shared static server while the other was navigating, and both runners cleaned/archived each other's scenario rows.
- Added a singleton lock to `qa/overnight_runner.sh` (`qa/overnight-output/.overnight_runner.lock`) so only one overnight runner can mutate the live test client at a time. A duplicate runner now exits immediately with a clear log line instead of producing false app failures.
- Added `test/overnight-runner-singleton-lock.js` covering fresh lock, live duplicate, and stale-lock recovery.
- Hardened `archiveSafe` / `archiveCalSafe` so cleanup waits for a row to exist before posting an archive, avoiding status-only phantom cleanup writes during races. Added `test/sxr-courier-archive-safe.js`.
- Validation: `bash -n qa/overnight_runner.sh`, `test/overnight-runner-output-path.js`, `test/overnight-runner-singleton-lock.js`, `test/sxr-courier-archive-safe.js`, full `test/run-all.js`, and `git diff --check` all passed (`All 34 unit suites passed`).

## 2026-07-03 04:50 UTC runner hardening
- Background process `proc_f87649c6c0b9` exited after the long `master:tree` lane started. The useful testing before that was extensive: full scenario-library batches, Calendar probes, realtime multi-tab probe, and `master:fast` all ran; the real red signals found before the exit were logged for follow-up.
- First cron reviewer already fixed two runner/tester issues and pushed `eb936d5`: Windows path names for very long scenario batches were too long, and `sxr_realtime_twin.js` had a flaky pre-push assertion.
- I reproduced the remaining stall with a tight command: `SXR_COURIER=0 node qa/master.js --lane=tree` was still running after 600s. For the overnight loop, the tree lane is now opt-in and every command is wrapped in a 20-minute timeout, so no single lane can stop the whole marathon again.
- Restart plan: continue the high-signal flat scenario batches, probes, Calendar checks, and fast master continuously; keep tree/full master for daytime/manual review unless explicitly enabled.

## 2026-07-03 04:44 UTC cron tick — tester hardening + runner restart
- Inspected the live runner on `claude/overnight-syncview-qa-20260702-204925`. Round 2 had broad green coverage through `master:fast` (`all 31 unit suites`, parity, 2 probes, and 12/12 scenarios green), but three tester-side reds needed root-cause work:
  - `sxr_realtime_twin.js` failed twice on `before push: tab A has NOT yet seen B's change`. Focused RED reproduced locally with `SXR_COURIER=0`: `pass=8 fail=1`. Root cause: on Sidney's open-egress Windows machine, the real Supabase websocket can legitimately propagate the backend write before the probe's manual `_sxrV2OnRealtimeChange` fire. The no-refresh product contract was working; the probe assumed sandbox/courier behavior.
  - The long `resolve_via_*` scenario batch failed with an empty/missing output log. Tight RED showed the runner output path had `safe_len=237`, `out_len=278`, and bash failed before launching the scenario: `File name too long`.
  - A stale duplicate overnight/probe process (`sxr_gating_flags.js`, started ~20:53 local) plus an active pre-patch runner were still alive, causing same-client concurrency. A manual resolve-batch rerun during that overlap produced a divergence-gate mismatch involving unrelated scenario rows; treated as runner interference, not a product bug.
- Fixes committed in this tick:
  - Added `test/overnight-runner-output-path.js` (RED: `safe=237, basename=258`; GREEN: `safe=160, basename=181`) and capped `qa/overnight_runner.sh` slugs to a Windows-safe 160 chars while preserving the tail for identification.
  - Updated `qa/probes/sxr_realtime_twin.js` to accept either expected mode: courier/manual push keeps A stale until the explicit handler; open-egress native realtime may update A first. Focused GREEN: `pass=9 fail=0` with `native realtime propagated before manual push`.
  - Terminated stale/duplicate overnight runner process trees and restarted one patched tracked background runner: `proc_4193f6ab15f2`, command `RUN_HOURS=9 FULL_MASTER_EVERY=2 TREE_EVERY=2 MASTER_FAST_EVERY=1 SXR_COURIER=0 bash qa/overnight_runner.sh`.
- Validation / cleanup:
  - `node --check qa/probes/sxr_realtime_twin.js`; `node --check test/overnight-runner-output-path.js`; `bash -n qa/overnight_runner.sh`; `git diff --check` — all clean.
  - `node test/run-all.js` — `All 32 unit suites passed ✅`.
  - Cleanup sweep archived 1 stranded sample row and verified `liveS=0`, `liveC=0` for `sidneylaruel` test rows before restarting.

---

# RUN 2 — 2026-07-02 · Samples interaction marathon (post-rebuild FE)

**Branch:** `claude/samples-system-testing-vx2moc` · **Test client:** `sidneylaruel` ONLY · Linear MOCKED.

> NOTE: everything below the RUN 1 marker tested the PRE-rebuild samples FE
> (torn down 2026-06-27, commit adce19b). The current FE is the calendar-clone
> rebuild; RUN 1 coverage claims do NOT carry over.

## Mission
Exhaustively test every SMM / Kasper / Client interaction of the new Samples
system through the real UI (the product owner flagged the comment/tweak/status
handoffs as the buggiest area), continuously, self-correcting, with seeds
archived and Linear mocked.

## Tester upgrades made first (this session)
- **10 new engine verbs** (`qa/scenario_engine.js`): smm.comment / smm.reply /
  smm.reopen / smm.deleteComment / smm.resolveVia(dest) · kasper.comment /
  kasper.undo / kasper.finish / kasper.close · client.comment.
- **5 new assertion verbs**: extended expectComment matchers (body/done/reply/
  deleted/audience/any), expectEvent (audit rows), expectClientThread (DOM-level
  client-surface visibility), expectKasperCard (present/absent/finished),
  expectLinear/expectNoLinear (mocked-capture asserts — plumbing existed, was dead).
- **Per-scenario 0-JS-errors gate** across all three actor tabs (catches the
  `_sxrLoadComments` ReferenceError class).
- **Scenario library 51 → 74 keys** (comment threads, replies, resolve-destination
  ×4, reopen, delete, Kasper undo/finish/close-resurface, audience leak guards,
  audit trail, Linear routing family, mixed-state reply visibility).
- **Scenario tree 6 → 24 leaves**: parameterized over BOTH components; new
  branches (client comment, SMM reply, resolve loops, Kasper comment/undo/finish).
- **False-green kills**: 0-matched-spec filter and unknown --lane now exit non-zero.
- **Fixed stale tree expectation**: kasper_aat leaf expected `For SMM Approval`;
  the app (and flat scenarios) set `Tweaks Needed` (index.html:28627) — the tree
  lane could never go green as authored.
- **Fixed silent no-op scenario**: notes_markdone's single open tweak made
  "Mark done" open the resolve chooser with nothing asserted; now seeds 2 tweaks
  (direct done) + asserts done:true, and the chooser paths have their own
  resolve_via_* scenarios.

## ✅ BUGS FIXED + RE-VERIFIED (2026-07-02 — user-authorized, ready to merge)
All fixes are surgical, keep the unit gate green (28 suites), and each has a
probe flipped from "pins the bug" to "proves the fix", re-run green live.

- **BUG-3 FIXED** — defined `_sxrLoadComments(post)` as an alias of
  `_sxrCommentsFor(post,'video')` (index.html ~26957). Opening Notes on a
  raw-shaped row no longer throws. Guard: `sxr_bug_repros.js` 4/4.
- **BUG-4 FIXED** — `_sxrCopyShareLink` now appends `&t=<client_review_token>`
  when the client has one (mirrors `smCopyShareLink`), so token-guarded clients
  get a valid link. Guard: `sxr_bug_repros.js`.
- **BUG-5a FIXED** — `_sxrKasperApproveComp` now stamps `kasper_approved_at` /
  `_by` in the approve patch (first-wins), so the audit trail records the
  sign-off. Guard: `sxr_kasper_audit_holes.js` 6/6 (verified persisted live).
- **BUG-5b FIXED** — `_sxrKasperUndoApprove` now pushes the reverted status to
  (mocked) Linear, so an undo no longer leaves the issue stale. Guard: same probe.
- **BUG-7 FIXED** — `_sxrKasperIsFinished` no longer resurfaces a finished card
  on a mere new message (removed the `latest > stampedAt` clause; kept the
  undecided-comps re-route clause) — now matches the calendar's decided rule.
  Guard: `sxr_gating_flags.js` 9/9.
- **BUG-6 RESOLVED (tooltip)** — the ✕-close tooltip on BOTH calendars promised
  "stays hidden until sent back to Kasper Approval" but both actually resurface
  on a NEW MESSAGE (shared, long-standing design). Corrected the tooltip on both
  to describe the real behavior. **Deeper true-re-route-resurface is left as a
  shared product question** (needs queue-membership work on both calendars; a
  freshly-closed card is by definition still undecided, so an undecided-comps
  check would make Close a no-op) — NOT auto-changed. `kasper_close_resurface_video`
  asserts the intended message-resurface, 9/9.

Tester robustness: `expectKasperCard` now polls the cross-client queue until it
settles on the expected state (was a single early read → flaky present/absent).

## OBSERVATIONS still open for YOUR product call (not auto-changed)
- **OBS-4 (payload audit, live-verified 2026-07-02) — a client share link can
  write ANY column, not just review actions.** The client surface renders no
  field editors (UI gating holds — verified), but the save funnel
  (`_sxrFlushCardSave` → `sample-review-upsert`) has no role-based column
  allowlist: forcing `{name, asset_url}` edits through the client page's own
  funnel persisted both (probe `sxr_client_persist_guard.js`). NB the deeper
  boundary issue: the n8n upsert webhook accepts any payload from anyone who
  has the URL, so an FE-side whitelist is defense-in-depth only — the real fix
  is webhook-side (n8n): allowlist writable columns per role/token (client
  token ⇒ only `*_status`, `*_tweaks`, `client_*_approved_at/by`, `status`).
  The calendar's `calendar-upsert-post` webhook shares this architecture —
  same recommendation. Left un-auto-fixed: the fix belongs in n8n, not this repo.
- **OBS-2** — client loses sight of a component's thread at Tweaks Needed until
  re-offer (dead client tweaks-composer). Shared with calendar.
- **OBS-3** — client can Approve while their own change request is still open.
- **BUG-6 deeper** — should a bare re-route (no new message) resurface a closed
  Kasper card? (tooltip now honest; behavior unchanged pending your decision.)
- **BUG-1 (RUN 1, pre-rebuild)** — optimistic status not rolled back on save
  failure; calendar shares the pattern — re-confirm before acting.

## BUGS — historical detail (source-read during tester upgrade; now fixed above)
- **BUG-3 — `_sxrLoadComments` is called at 6 sites and DEFINED NOWHERE**
  (index.html:27567, 27629, 27680, 27689, 27709, 27737). Any path where
  `post.comments` is not already an array (e.g. an unmigrated row arriving via a
  raw realtime echo) throws ReferenceError inside the Notes modal machinery.
  Suggested fix: define it (or replace the calls with `_sxrCommentsFor(post,'video')`).
- **BUG-4 — SMM Share button copies a link that token'd clients can't open.**
  `_sxrCopyShareLink` (index.html:25580) builds `?sxr=1&c=<client>&v=sample-reviews`
  with NO `&t=<token>`, while the router (index.html:24893-24899) hard-rejects any
  client that HAS `client_review_token` when `t` mismatches → "This link isn't
  valid". Any token'd client gets a broken link from the UI's own Share button.
  (Clients with no token pass with only a console warning.)
- **BUG-5 (audit hole) — samples Kasper approve never stamps `kasper_approved_at/by`**
  (`_sxrKasperApproveComp`, index.html:28490-28511) so a `kasper_approve` audit
  event can never fire and Kasper history timestamps are synthesized; Kasper
  UNDO also reverts status without pushing the reverted status to Linear
  (index.html:28512-28521) → Linear left stale after an undo.

- **BUG-6 (live-verified) — a closed Kasper card never resurfaces on re-route.**
  The X button's tooltip promises "stays hidden until the SMM sends it back to
  Kasper Approval" (index.html:28391), but `_sxrKasperIsClosed`
  (index.html:28216-28223) clears the closed state only on a NEWER MESSAGE —
  there is no undecided-component check (its sibling `_sxrKasperIsFinished`
  HAS one at 28212). Verified live: SMM re-routed video For SMM Approval →
  Kasper Approval and the card stayed hidden; a new internal note resurfaces it.
  If Kasper closes a card and the SMM never comments, Kasper never sees it again.
  Scenario `kasper_close_resurface_video` pins current behavior with a BUG-6 note.
- **BUG-7 (source-read) — samples Finish diverges from the calendar's product rule.**
  Calendar `_kasperIsFinished` (index.html:32103-32120) deliberately does NOT
  resurface a finished card on a new message ("Finish means finished until an
  explicit For-Kasper-Approval re-route" — the reply-bounce friction was fixed
  there). Samples `_sxrKasperIsFinished` (index.html:28213) still resurfaces on
  ANY newer message — the exact behavior the calendar rollout removed
  (KASPER_REVIEW_GLOBAL_ROLLOUT.md). Clone-parity miss in the rebuild.

## OBSERVATIONS (product-intent questions, not bugs)
- **OBS-2 (sharpened, live-verified both cases) — a client who requests a change
  loses sight of that component's thread ENTIRELY until re-offer.** At `Tweaks
  Needed` the component is excluded for client links both from the Review queue
  (`_sxrReviewComponentActive`, index.html:27034) AND from the card body's panel
  list on a card that stays visible via its other component
  (`_sxrReviewCardBody`, index.html:27107-27109). Consequence: the client-facing
  tweaks-state composer ("The team is working on it. Anything else to add?",
  index.html:27137) is UNREACHABLE dead code for real client links. The calendar
  twin has the identical predicate, so this is faithful clone parity — a
  long-standing product behavior, not a rebuild regression. Product call:
  either clients should follow the conversation mid-tweak (drop the
  `!_isClientLink` guard) or the dead tweaks-state client UI should go.
  Pinned by scenario `client_mixed_gating_video`.
- **OBS-3 — client CAN approve at `Tweaks Needed`** (canAct includes it,
  index.html:27130) → straight to Approved with the open tweak left open.
  Pin/adjust per product intent.

## Validation state (real-browser, live backend)
| Scenario | Result |
|---|---|
| clean_video_only (pre-upgrade smoke) | ✅ 7/7 |
| resolve_via_stay_video (new chooser verb) | ✅ 3/3 |
| kasper_undo_video (new toast-undo verb) | ✅ 5/5 |
| client_comment_video (new comment verb) | ✅ 3/3 |
| smm_reply_to_client_request_video (fixed, re-offer) | ✅ 8/8 |
| linear_push_video_status · kasper_finish_video | ⏳ interrupted by env SIGKILL (exit 137) — re-run pending |

`node test/run-all.js` unit gate: **GREEN (28 suites)** after all tester changes.

## Interaction log (running)
| # | Timestamp (UTC) | Interaction | Scenario/Probe | Result |
|---|---|---|---|---|
| R2-1 | 2026-07-02 | Client plain comment, no status change | client_comment_video | ✅ 3/3 |
| R2-2 | 2026-07-02 | Client request → SMM reply → re-offer → client sees thread | smm_reply_to_client_request_video | ✅ 8/8 |
| R2-3 | 2026-07-02 | SMM resolve chooser → stay | resolve_via_stay_video | ✅ 3/3 |
| R2-4 | 2026-07-02 | Kasper approve → toast Undo → status restored | kasper_undo_video | ✅ 5/5 |
| R2-5 | 2026-07-02 | Kasper request → Finish reviewing → "Sent to SMM" state | kasper_finish_video | ✅ 4/4 |
| R2-6 | 2026-07-02 | Linear: SMM approve pushes status to VIDEO issue only, no comment | linear_push_video_status | ✅ 4/4 |
| R2-7 | 2026-07-02 | Linear: Kasper request posts tweak comment to the video issue | linear_tweak_comment_video | ✅ 3/3 |
| R2-8 | 2026-07-02 | Linear: graphic change routes to GRA issue, never VID (probe bug fixed: expectNoLinear now honors includes filter) | linear_push_graphic_isolated | ✅ 4/4 |
| R2-9 | 2026-07-02 | Kasper internal comment: no status change, invisible on client surface after approve | kasper_comment_internal_video | ✅ 6/6 |
| R2-10 | 2026-07-02 | Audience gating: internal note hidden from client, client note visible | audience_leak_guard_video | ✅ 3/3 |
| R2-11 | 2026-07-02 | Linear: plain internal note pushes NO status | linear_no_push_on_note | ✅ 3/3 |
| R2-12 | 2026-07-02 | Resolve chooser → Kasper route (tweak done + status) | resolve_via_kasper_video | ✅ 3/3 |
| R2-13 | 2026-07-02 | Resolve chooser → Client route | resolve_via_client_video | ✅ 3/3 |
| R2-14 | 2026-07-02 | Resolve chooser → Approved route | resolve_via_approved_video | ✅ 3/3 |
| R2-15 | 2026-07-02 | Delete own note via confirm dialog (soft-delete persisted) | delete_comment_video | ✅ 4/4 |
| R2-16 | 2026-07-02 | Audit trail: status_change event per clean-path transition (SMM→Kasper→Client→Approved) | audit_trail_video | ✅ 9/9 |
| R2-17 | 2026-07-02 | Kasper close + SMM re-route → card does NOT resurface | kasper_close_resurface_video | 🐞 **BUG-6** (6/7 — re-route resurface fails; tooltip contradicts code) |
| R2-18 | 2026-07-02 | Reopen a resolved tweak (via Show-resolved history view) | reopen_tweak_video | ✅ 5/5 |
| R2-19 | 2026-07-02 | Mark done with another tweak open (no chooser) — done persisted | notes_markdone | ✅ 2/2 |
| R2-20 | 2026-07-02 | Resolve chooser on the GRAPHIC component → Kasper | resolve_via_kasper_graphic | ✅ 3/3 |
| R2-21 | 2026-07-02 | OBS-2 pin: Tweaks-Needed panel hidden from client even on a client-active card; other comp's panel renders | client_mixed_gating_video | ✅ 6/6 |
| R2-22 | 2026-07-02 | SMM plain review-tab comment — no status change | smm_comment_video | ✅ 3/3 |
| R2-23 | 2026-07-02 | Client comments then approves (comment must not block approval) | client_comment_then_approve_video | ✅ 5/5 |
| R2-24 | 2026-07-02 | Client plain comment on the graphic | client_comment_graphic | ✅ 3/3 |
| R2-25 | 2026-07-02 | FULL SCENARIO TREE, video component (12 root→leaf paths incl. reply loop, resolve loops, Kasper finish/undo/comment through the tree lane) | tree: video__* | ✅ 12/12 paths, 88/88 asserts |
| R2-26 | 2026-07-02 | FULL SCENARIO TREE, graphic component (same 12 paths — the historically untested twin) | tree: graphic__* | ✅ 12/12 paths, 88/88 asserts |
| R2-27 | 2026-07-02 | BUG-3 + BUG-4 live repros (ReferenceError fires in-browser on raw-shaped row; share URL provably lacks t=) | sxr_bug_repros.js | ✅ 6/6 (characterization) |
| R2-28 | 2026-07-02 | Same-tick double Kasper approve → ONE component transition (+ legitimate overall roll-up event) | sxr_concurrency.js | ✅ |
| R2-29 | 2026-07-02 | Two stale SMM tabs comment same component → comments MERGE, no clobber | sxr_concurrency.js | ✅ |
| R2-30 | 2026-07-02 | Concurrent Kasper video-approve + SMM graphic re-route → both land; overall heals to worst-of | sxr_concurrency.js | ✅ |
| R2-31 | 2026-07-02 | Unlinked graphic at Kasper Approval gated OUT of Kasper queue | sxr_gating_flags.js | ✅ |
| R2-32 | 2026-07-02 | BUG-7 pinned live: new message resurfaces a FINISHED Kasper card (calendar rule would keep it in Tweaks pending) | sxr_gating_flags.js | ✅ pin |
| R2-33 | 2026-07-02 | Flag-off isolation: _sxrEnabled false, nav hidden, 0 cards, #sample-reviews route refused (hash cleared — rebuilt-FE contract differs from old FE's "is off" page) | sxr_gating_flags.js | ✅ |

| R2-34 | 2026-07-02 | Messy round-trips: full_bounce 22/22, client_request_both_roundtrip 11/11, lifecycle_mixed_kasper 12/12 | scenarios | ✅ 45/45 |
| R2-35 | 2026-07-02 | AAT + fix-approve loop family (aat_continuation, aat_full_path, smm/kasper/client_request_fix_approve) | scenarios | ✅ 29/29 |
| R2-36 | 2026-07-02 | COLD-OPEN create journey: Add → type name (blank promoted to real row) → asset url → note → archive → no-resurrect, 0 JS errors | sxr_cold_open.js | ✅ 13/13 |
| R2-37 | 2026-07-02 | BUG-5a/5b pinned live: approve pushes Linear but never stamps kasper_approved_at; undo reverts DB, pushes NOTHING to Linear (stale issue) | sxr_kasper_audit_holes.js | ✅ 6/6 (pins) |
| R2-38 | 2026-07-02 | Round numbering: Tweak #1 → #2 on both components | two_round_request_* | ✅ 12/12 |

| R2-39 | 2026-07-02 | Remaining regression batches (worstof/mixed/notes ×7, graphic family ×7, notes+two-round ×7, graphic deep ×8, final ×10) | scenarios | ✅ 149/149 asserts |
| R2-40 | 2026-07-02 | **MILESTONE: every one of the 74 flat-library keys has run green this session** (+ tree 24/24) | — | ✅ |

| R2-41 | 2026-07-02 | Linear deep: inbound-echo suppression (single-shot), __CLEAR_LINK__ (no push), link uniqueness + "Move it here" relocation, outbox drain | sxr_linear_deep.js | ✅ 16/16 (detector pre-check informational) |
| R2-42 | 2026-07-02 | **Realtime TWO-SCREEN sim**: cross-screen propagation via _sxrV2OnRealtimeChange (no manual refresh); recent-save window protects a fresh edit against a concurrent push; pending unsaved edit survives a push-driven reload | sxr_realtime_twin.js | ✅ 9/9 |

| R2-43 | 2026-07-02 | **CALENDAR realtime TWO-SCREEN twin** (cross-screen propagation via _calV2OnRealtimeChange, recent-save window survives concurrent push, pending edit survives push-driven reload) — courier-based, runs in-session AND on CI | cal_realtime_twin.js | ✅ 12/12 |

| R2-44 | 2026-07-02 | **CALENDAR Linear deep twin** (single-shot echo suppression, __CLEAR_LINK__, cross-post link uniqueness + move relocation, outbox drain) | cal_linear_deep.js | ✅ 16/16 |
| R2-45 | 2026-07-02 | **GA rollout verified**: samples ON by default ("Samples New" beside "Samples Old"), ?sxr=0 opt-out isolation intact | sxr_gating_flags.js | ✅ 13/13 |

### Overnight autonomous run (unattended, from 2026-07-02 night)
`qa/overnight_runner.sh` loops all sxr probes + scenario batches back-to-back
against a child server, archives stray seeds each round, re-checks the unit gate,
appends to `qa/overnight_runner.log`, and never stops on its own (a FAIL is logged
and the loop continues). Phase queue after samples runs dry: realtime two-screen
depth → content-calendar sweep with the upgraded coverage → twin-check every bug
across both calendars.

### Flaky-note (infra, watched)
- One transient: a Kasper approve save silently failed once (DB unchanged, no
  retry — the catch path only shows "Save failed"); re-run green. Probes now
  poll-until-landed and self-diagnose (saving-keys / notify / queue state) if
  it recurs. If it recurs often, the durable-outbox pattern used for Linear
  pushes may be worth extending to Kasper persists.

## Capstone (2026-07-02 ~04:00 UTC)
`node qa/master.js --profile=fast` end-to-end through the upgraded master:
unit ✅ (28) · parity ✅ · scenarios ✅ 3/3 (18/18) · visual 👁 6 shots →
**vision verdict 6× ✅, 0 ⚠️/❌** (`qa/visual/VISION_VERDICT.md`). Marathon-mode
(`--repeat/--until` + per-iteration JSON reports) validated separately.
Running totals this run: **33 interaction rows in the log above, 3 probe files
added (repros / concurrency / gating-flags), tree 24/24, all lanes green.**
Non-test row `sr_mqvenh27_jp85b` ("Sample 1", Tweaks Needed) exists on the test
client — NOT one of this run's seeds; left untouched, flag to owner.

## NOT YET COVERED (resume here)
- Regression sweep of the remaining pre-existing flat-library keys (full_bounce,
  lifecycle_mixed_kasper, client_request_both_roundtrip, worstof_*, aat_*,
  note_* matrix …) — in flight, next batches.
- Cold-open create journey (rebuild parity of the deleted sxr_cold_open_journey:
  Add → type → paste links → status → comment → archive, zero seeding).
- BUG-5 audit-hole live characterization (kasper_approved_at never stamped;
  undo leaves Linear stale — assert current behavior + Linear capture).
- Linear deep set: suppression of inbound→outbound echo; link dedup/conflict
  across two samples; outbox retry under real failure injection (b2-class).
- Realtime: routeWebSocket push into _sxrV2OnRealtimeChange; recent-save window
  protects a fresh approval (G-class).
- Visual lane breadth: enable shots for the new multi-actor scenarios + judge.
- Full-profile master run (probes+temporal+tree lanes in one pass) once the
  sandbox has a quiet window (single-run wall-clock ≈ 2-3h here).

---

# RUN 1 — 2026-06-26 (PRE-REBUILD FE — historical)

**Branch:** `claude/overnight-test-8g0bsg` · **Test client:** `sidneylaruel` (Sidney Laruel) ONLY
**Harness:** real headless Chromium + Node courier → LIVE Supabase/n8n backend; Linear MOCKED.
**Started:** 2026-06-26 (autonomous /loop)

This run drives the REAL `index.html` UI (clicks/typing) against the LIVE backend and reads
back the live `sample_reviews` / `sample_review_events` rows to confirm persistence. Every
seed uses a unique `sr_*` id and is archived on exit. Each probe asserts 0 app JS errors.

## How to run a probe
```bash
python3 -m http.server 8000 & SRV=$!; sleep 1.5; node qa/probes/<x>.js; EC=$?; kill $SRV; exit $EC
```
Or the whole new-probe set: `node qa/run-probes.js sxr_a1_smm_pill_lifecycle …`

---

## Summary (running)

| Metric | Count |
|---|---|
| New probes written this run | 9 |
| Distinct interactions verified | 133 green (+ `sxr_c2` characterization, findings logged) |
| PASS | 133 |
| FAIL | 0 |
| Bugs found (fixed) | BUG-2 retry chip FIXED in the parity build (see batch below) |
| Bugs found (needs review) | BUG-1 status rollback — re-characterized as a probe-snapshot artifact (no app defect) |

`node test/run-all.js` (unit gate): **GREEN** — verified at start.
Baseline infra check: `sxr_m1_render` PASS (courier → live backend, 0 JS errors).

---

## Parity management-layer batch (2026-06-26) — the newly-built `?sxr=1` SMM affordances

After the management-layer parity build (create / archive / toolbar / Linear-slot UI / edit-UX /
comments / bulk — see `SAMPLES_PARITY_PLAN.md`), this batch drives the NEW affordances through the
real UI. **BUG-2 (the `_sxrRetrySave` empty-bucket retry) was FIXED in that build** — the flush now
treats an empty bucket as a forced whole-card re-send + a catch re-render surfaces the Retry button
on a real blur; `sxr_create_edge` re-verifies Retry now persists. BUG-1 (in-memory status rollback)
was a probe-snapshot artifact (snapshot captured AFTER `_sxrApplySubStatus` pre-mutated the row); the
DB never received the failed status — no product defect.

| Probe | Interaction | Result |
|---|---|---|
| `sxr_cold_open_journey` | Cold open → Add → fill → paste links (new slot UI + format guard) → status → comment → archive → no-resurrect | **16/16** |
| `sxr_linear_guards` | Linear FORMAT guard rejects non-link; UNIQUENESS conflict dialog; MOVE relocates link (old cleared) | **5/5** |
| `sxr_bulk_archive` | Select mode → pick 2/3 → Archive → removed + Archived + no-resurrect; 3rd stays | **7/7** |
| `sxr_create_edge` | Empty blank never persists/promotes; failed first save retained w/ chip + no DB row; Retry persists | **6/6** |
| `sxr_reorder` | Drag-reorder persists order_index; a FAILED reorder rolls the on-screen order back | **4/4** |
| `sxr_toolbar` | 3-level zoom (persists to localStorage); Share copies ?c=…&v=sample-reviews; tab add/remove | **8/8** |
| `sxr_misc_ui` | deep-link jump-to-card focus/highlight; up-next marker (first not-Approved); copy-card-link; thumbnail lightbox | **5/5** |
| `sxr_realtime_catchup` | (G) background reload adopts a cross-actor sub-status change; a pending local edit survives the reload; deferred-render-while-editing confirmed | **4/4** |

Prior-suite regression after the build (all green, 0 JS errors): a1 27, a2 15, a3 25, b1 12, b2 10,
c1 19, c2 11, d1 14, f1 11, m1 5, m2 19, m3a 18, m3b 32, m4 15, m5a 12, m5b 16.

---

## Interaction log

| # | Timestamp (UTC) | Area | Interaction | Probe | Result | Evidence |
|---|---|---|---|---|---|---|
| 1 | 2026-06-26 | A | SMM pill menu: video full forward lifecycle (In Progress→For SMM→Kasper→Client→Approved) + overall worst-of + audit `status_change` rows per step + kasper_seen on Kasper-route + dynamic worst-of flip | `sxr_a1_smm_pill_lifecycle.js` | ✅ 27/27 | live DB read-back each step; overall never leaves 6-status set |
| 2 | 2026-06-26 | A | Stale-approval clearing (client_*_approved_at on drop <Client Approval; kasper_approved_at only when nothing ≥ Client Approval) + same-tick double-approve idempotency (2nd call null, one transition) | `sxr_a2_stale_clear_and_idempotent.js` | ✅ 15/15 | live DB; in-flight guard returns null |
| 3 | 2026-06-26 | A | SMM resolve chooser via real `#sxrResolveDestOverlay`: all 4 routes (Kasper→Kasper Approval+kasper_seen, Client→Client Approval, Approved→Approved, Stay→unchanged); tweak marked done each route; recommended=Client once seen by Kasper | `sxr_a3_resolve_route_chooser.js` | ✅ 25/25 | live DB; per-round Tweaks-Needed barrier |
| 4 | 2026-06-26 | C | Field/media interactions: YouTube→`<img>` derivation; asset+thumbnail open buttons `window.open(rawUrl)`; in-place open-button show/hide on blur; Drive derivation `?id=…&sz=w320&_r=`; direct-image `?_r=`; thumb_rev bump + `_r` cache-bust changes per media change; creative_direction autosize | `sxr_c1_fields_open_thumb.js` | ✅ 19/19 | live DB read-back; `_sxrDeriveThumb` on live row |
| 5 | 2026-06-26 | D | Client-share render-gating across full spectrum: Client-Approval→active panel; For-SMM/Kasper→read-only "in progress" mini line (no buttons); Approved→terminal (no buttons); all-In-Progress→no review body; no bound field editors leak; pills read-only; no grips; internal note hidden; cards not `.is-editable` | `sxr_d1_client_gating.js` | ✅ 14/14 | 4 seeded samples, live client surface |
| 6 | 2026-06-26 | B | Linear routing+clear: graphic change→graphic issue only (video issue untouched, overall never pushed); non-status field change→no push; `__CLEAR_LINK__` clears the link in DB (not carried forward); clear fires no push | `sxr_b1_linear_routing_clearlink.js` | ✅ 12/12 | mocked+captured Linear; live DB read-back |
| 7 | 2026-06-26 | B | Durable Linear outbox retry: page-route injects push `{ok:false}`→FE enqueues to `syncview_sxr_linear_outbox_v1` with `{issue,status}`+attempts; recover→`_sxrLinearOutboxFlush()` drains to empty + harness records the retried push | `sxr_b2_linear_outbox_retry.js` | ✅ 10/10 | real failure injection; localStorage outbox |
| 8 | 2026-06-26 | F | Flag-off isolation: no `?sxr`→flag false, nav button hidden, no channel, 0 cards; `#sample-reviews` shows "is off." + loads zero cards (seeded sample absent); control `?sxr=1` reveals nav + flips flag | `sxr_f1_flag_off_isolation.js` | ✅ 11/11 | fresh context, default-off; live seed not loaded |
| 9 | 2026-06-26 | C | Optimistic save funnel: success persists + non-error chip; forced-failure stamps `_saveError` + never writes DB; free-text retained (not rolled back); recovery via re-edit. **Found BUG-1 (status rollback ineffective) + BUG-2 (Retry chip no-op)** — see BUGS section | `sxr_c2_save_indicator_rollback.js` | ⚠️ findings logged | first run surfaced both bugs; final green re-run blocked by env resource limits at session end (Chromium spawns killed, exit 144) |

---

## BUGS — NEEDS REVIEW (samples save-failure path, found by `sxr_c2`)

Both surface only when a `sample-review-upsert` write FAILS (forced in the probe via a
page-level route returning `{ok:false}`). Neither corrupts data — a failed write never
reaches the DB — but the failure-recovery UX is degraded. Filed for human review rather
than auto-patched because they touch the core `_sxrFlushCardSave` save funnel (live-app
risk); the fixes are small and localized.

- **BUG-1 — optimistic STATUS change is not rolled back on save failure.**
  Repro: SMM clicks a status pill → save fails. Expected: the pill reverts (rollback).
  Actual: the component keeps the new sub-status in the in-memory row even though the DB
  never got it (probe confirmed DB stays `In Progress` while the card shows `Kasper
  Approval`). Root cause: `_sxrStatusPick`→`_sxrApplySubStatus` MUTATES `sxrState.cards[idx]`
  *before* `_sxrFlushCardSave` runs, so the flush captures `prevSnapshot` from the
  already-mutated row; the catch's `_SXR_ROLLBACK_FIELDS` rollback then restores the *new*
  value (a no-op). NB: the calendar's `_calStatusPick` pre-mutates the same way, so this may
  be intended (reconciled by the next background reload via the recent-save window) — needs
  a design call. Suggested fix if unintended: snapshot the row BEFORE `_sxrApplySubStatus`,
  or pass the pre-value into the rollback.
- **BUG-2 — the "Save failed · Retry" chip is a no-op. → FIXED (2026-06-26 parity build).**
  `_sxrFlushCardSave` now treats an empty `edits` bucket as a forced WHOLE-CARD re-send
  (mirroring the calendar), and the catch path now re-renders so the Retry button actually
  surfaces on a real blur. `sxr_create_edge` re-verifies: a failed first save is retained with
  the chip and clicking Retry after recovery persists. Original analysis retained below.
  Repro: a save fails → the error chip renders → click it. Expected: re-attempt the write.
  Actual: nothing re-persists (probe confirmed the DB is unchanged after the retry click).
  Root cause: `_sxrRetrySave` sets an EMPTY `_sxrPendingEdits[pid] = {}` and calls
  `_sxrFlushCardSave`, which early-returns on `!Object.keys(edits).length` (samples send a
  field-level patch keyed on `edits`). The calendar's `_calFlushCardSave` instead re-sends
  the FULL row, so `_calRetrySave`'s empty bucket still resends everything. Worse, the retry
  click first calls `_sxrSetCardStatus(pid,'saving')`, so the chip can stick on "Saving…".
  Recovery DOES work by re-editing the field (re-queues a real patch) — probe verified.
  Suggested fix: have `_sxrRetrySave` re-queue the card's persistable columns (or have the
  flush re-send the full row when `_saveError` is set), mirroring the calendar.

## BUGS FOUND

_No data-integrity bugs._ (4 probe-side bugs were found and fixed during authoring:
a3 Stay-route race → per-round live-DB barrier; c1 open-button toggle expected on
input but lives in the blur handler; d1 `window._isClientLink` is module-scoped +
the active review composer `<textarea>` is not a field-editor leak. None indicate
an app defect — the app behaved correctly in every case.)

## OBSERVATIONS (not bugs — for product review)

- **OBS-1 (client surface, In-Progress sample shell):** A sample with BOTH
  components still at `In Progress` is not "client-ready" so its review BODY is
  correctly suppressed (`_sxrClientReviewBodyHtml` returns ''). However the card
  SHELL (thumbnail + name + read-only status pills showing "Video: In Progress /
  Thumbnail: In Progress") still renders on the client share surface, because
  `_sxrRenderBody` filters cards only by `archived`, not by `_sxrIsClientReady`.
  No sensitive data leaks (pills are read-only; internal notes/fields are hidden),
  but if the intent is that brand-new In-Progress-only samples are fully invisible
  to the client, the grid filter would need `_sxrIsClientReady` too. Verified, not
  fixed — flagging for product intent. Probe: `sxr_d1_client_gating.js`.

---

## NOT YET COVERED (resume here)

Matrix sections from the mission, with current status:

- **A) Lifecycle** — ✅ SMM pill full forward walk (a1), worst-of overall (a1), stale-approval
  clearing + same-tick idempotency (a2), resolve chooser all 4 routes (a3), kasper_seen (a1/a3),
  audit events (a1). **TODO:** Kasper undo-approve + Finish/Close re-surface via UI; client
  request-change-only-when-valid edge; approve_after_tweaks pre-clear → SMM resolve skips Kasper;
  graphic-component lifecycle symmetry; concurrent SMM+Kasper on different comps.
- **B) Samples Linear sync (mocked)** — ✅ m4 (video push/stale-regress/comment/point-adoption),
  b1 (graphic routing, no-push-unchanged, non-status no-push, `__CLEAR_LINK__`), b2 (durable
  outbox retry on real failure injection). **TODO:** suppression of inbound→outbound echo as a
  standalone probe; link dedup/conflict across two samples; tweak-comment to graphic issue.
- **C) SMM fields** — m2 (name/cd/thumb/hide/linear/reorder/client-RO) + c1 (open buttons,
  thumbnail derivation, autosize) + c2 (optimistic save funnel + failure rollback/retry —
  surfaced BUG-1 & BUG-2). **TODO:** re-run c2 to green once env recovers; Linear link move to
  another card; comments audience gating via UI (m3a is core); graphic Linear link paste/commit.
- **D) Client share** — ✅ m5b (approve/request/guards) + d1 (render-gating spectrum, no-leak).
  **TODO:** Tweaks-Needed "changes requested" follow-up composer state on reload; persist-guard
  that a client write only touches review-action columns (payload-level).
- **E) Kasper surface** — m5a core. **TODO:** SAMPLE badge across queue pagination depth;
  Kasper approve/request/undo/finish/close persist via real Kasper card controls; calendar↔samples
  reverse isolation deeper.
- **F) Isolation / flag-off** — ✅ f1 (flag default-off hides nav, no channel, 0 cards, "is off"
  view, control flips on). **TODO:** calendar↔samples deeper isolation; OLD samples module
  (`_sm*`) untouched while sxr runs.
- **G) Realtime / multi-actor** — ✅ background catch-up of a cross-actor sub-status change +
  pending-edit-not-clobbered + deferred-render-while-editing (`sxr_realtime_catchup`). **TODO:**
  routeWebSocket push event into `_sxrV2OnRealtimeChange`; recent-save window protects a fresh approval.
- **Management layer (the 2026-06-26 parity build)** — ✅ **FULLY COVERED:** create lifecycle +
  empty-blank/failed-create edges (`sxr_cold_open_journey`, `sxr_create_edge`); per-card + bulk
  archive + ledger (`sxr_cold_open_journey`, `sxr_bulk_archive`); dedicated Linear slot UI +
  format/component/uniqueness guards + conflict-move (`sxr_linear_guards`, `sxr_cold_open_journey`,
  `sxr_b1`); reorder persist + failure-rollback (`sxr_reorder`); toolbar zoom/share/tab-add-remove
  (`sxr_toolbar`); deep-link/up-next/copy-link/lightbox (`sxr_misc_ui`).
- **H) Everything else** — **TODO (none yet):** calendar review lifecycle/fields/Linear/drag/
  comments, Kasper for calendar, client share for calendar, onboarding, TikTok pilot, templates.
  *(Next sweep target — the Samples management layer that this build added is now exhaustively
  covered; broaden to the rest of the app from here.)*
