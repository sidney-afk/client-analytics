# Overnight Autonomous Test Run — SyncView

> ## ⟶ ACTIVE RUN: SXR REBUILD VERIFICATION (2026-06-28)
>
> **Branch:** `claude/overnight-test-sxr` · **Test client:** `sidneylaruel` ONLY
> **Target:** the REBUILT Samples (Review) feature (`?sxr=1`) — the from-scratch,
> fully-fenced clone that replaced the prior "Samples v2" attempt. This run writes
> FRESH probes (`qa/probes/ot*.js`) that drive the rebuild's actual DOM/API against
> the LIVE backend (Linear mocked). The prior run's report (probes `sxr_*`, the
> superseded build) is preserved below the divider for reference.
>
> ### Results (this run)
>
> | Probe | Interaction | Result |
> |---|---|---|
> | ot01_cold_open_smm | SMM cold open: create→name(promote+live upsert)→video URL→creative dir→status pick→audit→archive | ✅ PASS (18/18) |
> | ot02_client_review | Client share: shell, expand, single Approve video→Approved (live), read-only Sheet, hidden brief not leaked | ✅ PASS (21/21) |
> | ot03_client_request | Client request-change: compose→Request change→Tweaks Needed (live) + client is_tweak comment persisted | ✅ PASS (10/10) |
> | ot04_kasper_review | Kasper Samples sub-tab: cross-client queue→expand→Approve→Client Approval (live), queue eviction, Linear push (mocked) | ✅ PASS (11/11) |
> | ot05_smm_review_split | SMM Review approve-split: video→Kasper (primary), graphic→Client (alt), worst-of overall (live) | ✅ PASS (10/10) |
> | ot06_smm_resolve_on_approve | SMM simplified resolve: approve a For-SMM video carrying an open client tweak → Kasper + tweak auto-resolved done=true (live) | ✅ PASS (7/7) |
> | ot07_kasper_actions | Kasper request-change → Tweaks Needed + is_tweak comment + Linear status/comment; approve-after-tweaks → For SMM + AAT flag (live) | ✅ PASS (11/11) |
> | ot08_smm_fields | SMM Sheet fields: hide-cd eye toggle (1↔''), thumbnail derivation (YouTube→img), Linear video commit, malformed-URL guard reject — all live | ✅ PASS (14/14) |
> | ot09_flag_off_isolation | Flag OFF: nav hidden, _sxrEnabled false, no channel, ZERO samples/linear network after focus+visibility; OLD #samples still mounts, no sxrView leak | ✅ PASS (8/8) |
> | ot10_notes_modal | Notes modal: Video/Thumbnail comp picker, audience toggle; internal note→video_tweaks(audience=internal), client note→graphic_tweaks(audience=client) live | ✅ PASS (13/13) |
> | ot11_reorder_gap | DOCUMENTS BUG-1: grip shown + draggable=true but drag is a no-op (stub wiring, webhook never called, order_index unchanged) | ✅ PASS (9/9, records BUG-1) |
> | ot12_realtime_catchup | Cross-tab sync (live): tab-1 status change → tab-2 converges via focus/visibility catch-up (past 8s throttle) AND via _sxrV2OnRealtimeChange | ✅ PASS (9/9) |
>
> **Totals:** 12 probes · 141 assertions · 141 PASS · 0 FAIL · 0 app JS errors · **1 product bug found (BUG-1).**
>
> ### 🐞 BUGS FOUND (this run)
> - **BUG-1 — drag-to-reorder is non-functional on the SMM Sheet (real gap).**
>   *Repro:* open `?sxr=1#sample-reviews/sidneylaruel` with ≥2 samples, hover a card →
>   a "Drag to reorder" grip appears and the card is `draggable="true"`. Drag one card
>   onto another → **nothing happens**; `order_index` is unchanged in the live DB and the
>   `sample-review-reorder` webhook is never called.
>   *Root cause:* `_sxrWireDragOnCard(card)` is an empty stub (`/* drag-reorder is a
>   Surface 2 follow-up */`); there are no `dragstart/dragover/drop` listeners anywhere in
>   the SXR block, and the declared `SXR_REORDER_URL` constant has zero call-sites.
>   *Impact:* misleading affordance — the user sees a drag handle that does nothing.
>   Reorder is a core calendar behavior and was NOT on the removal list, so the Sheet does
>   not fully replicate the calendar here. *Severity:* medium (UX/feature gap; no data loss,
>   no errors). *Two clean fixes (needs product call):* (a) WIRE reorder — clone the
>   calendar's drag handlers into the `_sxr` namespace + POST to `SXR_REORDER_URL` (the
>   webhook is already live); or (b) HIDE the grip + set `draggable="false"` if reorder
>   isn't wanted in samples. Recommend (a) to match the calendar. NOT auto-fixed — it's a
>   feature decision and belongs on the feature branch under the SXR fences. Probe:
>   `ot11_reorder_gap.js`.
> `node test/run-all.js`: GREEN. Live backend reachable via courier; cleanup verified each probe.
>
> ### OBSERVATIONS (this run)
> - **OBS-R1 (resolve chooser intentionally removed):** The prior attempt's 4-route
>   resolve-destination chooser modal (`#resolveDestModal`) does NOT exist in the
>   rebuild. By design (code comment "Simplified resolve … no chooser modal"),
>   approving an SMM component that still has open change-requests marks them resolved
>   as part of the send, and routing is handled by the approve-split (Kasper / Client /
>   Approved). Consistent with the "fewer options" mandate. Verified in ot06 — not a bug.
> - **OBS-R2 (inline Linear input vs re-render, low severity):** An open inline Linear
>   `<input>` can be wiped if a debounced field-save (or realtime update) re-renders the
>   card while it's focused. The comment composer/textarea is protected by the
>   defer-render-while-editing guard; the Linear slot input is not. In practice the
>   exposure is the ~sub-second window between opening the slot and committing, and a
>   real user pastes+commits within it. Probe ot08 settles before opening (then commits
>   first-try, attempts=1). Worth considering extending the editing-guard to
>   `.cal-linear-input`. Not a data-loss bug in normal use.
> - **OBS-R3 (return-refresh throttle, intended):** The focus/visibility/pageshow
>   catch-up (`_sxrRefreshOnReturn`) is throttled to once per `SXR_RETURN_REFRESH_MIN_MS`
>   (8s) so rapid tab-switching doesn't hammer the backend. A tab that just loaded won't
>   re-fetch on the next focus for 8s; the realtime push handler is unthrottled and covers
>   the gap. Verified in ot12 (waited past 8s → caught up). Expected, not a bug.
>
> ### NOT YET COVERED (this run — resume here)
> Matrix A: graphic-component lifecycle symmetry; SMM approve-split (Kasper vs Client alt);
> SMM resolve-tweak chooser (4 routes); stale-approval clear; same-tick idempotency; undo-approve.
> B: Linear graphic routing, no-push-on-unchanged, __CLEAR_LINK__, suppression of inbound echo.
> C: link paste/commit/move, thumbnail derivation (YouTube/Drive), optimistic rollback on failure, reorder.
> D: Tweaks-Needed reload composer state; persist-guard (client write only touches review cols).
> E: Kasper queue pagination depth; reverse isolation (samples never in calendar review).
> F: flag-off isolation (nav hidden, no _sxr net/DOM); OLD #samples module untouched.
> G: realtime push into _sxrV2OnRealtimeChange; recent-save window protects a fresh approval.
> H: rest of app (calendar lifecycle/fields/Linear, Kasper-for-calendar, onboarding, TikTok, templates).
>
> ---

## (ARCHIVED) Prior run — "Samples v2" attempt (superseded by the rebuild)

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
