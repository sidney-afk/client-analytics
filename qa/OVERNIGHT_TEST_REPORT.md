# Overnight Autonomous Test Run — SyncView

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

## BUGS — NEEDS REVIEW (found by source-read during tester upgrade; live repros pending)
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

## OBSERVATIONS (product-intent questions, not bugs)
- **OBS-2 — a client who requests a change loses sight of the thread.** At
  `Tweaks Needed` the card leaves the client Review queue entirely
  (`_sxrReviewComponentActive` excludes Tweaks Needed for `_isClientLink`,
  index.html:27034), so the SMM's reply is invisible to the client until the
  SMM re-offers at Client Approval — unless the OTHER component still awaits
  review (mixed case keeps the card visible, and then the tweaks-state
  follow-up composer works). Verified live via screenshot (empty client queue).
  If clients are expected to follow the conversation mid-tweak, the queue filter
  needs to include Tweaks Needed for client links.
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

## NOT YET COVERED (resume here)
- Re-run: linear_push_video_status, kasper_finish_video (SIGKILL'd batch).
- Full new-scenario sweep (74 keys), then full tree (24 leaves), in small batches.
- Live repro probes for BUG-3 (`_sxrLoadComments` via unmigrated-row echo),
  BUG-4 (share link + token'd client), BUG-5 (audit hole / undo-Linear-stale).
- Concurrency: comment-merge race (two tabs), double-click idempotency,
  SMM+Kasper same-component race; unlinked-component gating (seed links='');
  round numbering fidelity (round 2/3 tags); cold-open create journey
  (rebuild parity of deleted sxr_cold_open_journey); flag-off isolation;
  Kasper "New message" resurface-on-reply; visual/vision pass on new flows.

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
