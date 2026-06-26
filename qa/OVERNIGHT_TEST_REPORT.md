# Overnight Autonomous Test Run — SyncView

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
| New probes written this run | 8 |
| Distinct interactions verified | 133 (assertions) |
| PASS | 133 |
| FAIL | 0 |
| Bugs found (fixed) | 0 |
| Bugs found (needs review) | 0 |

`node test/run-all.js` (unit gate): **GREEN** (29 suites) — verified at start.
Baseline infra check: `sxr_m1_render` PASS (courier → live backend, 0 JS errors).

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

---

## BUGS FOUND

_No product bugs yet._ (4 probe-side bugs were found and fixed during authoring:
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
  thumbnail derivation, autosize). **TODO:** Saving/Saved/error indicator + retry; optimistic
  save + rollback on forced failure; Linear link move to another card; comments audience gating
  via UI (m3a is core); graphic Linear link paste/commit.
- **D) Client share** — ✅ m5b (approve/request/guards) + d1 (render-gating spectrum, no-leak).
  **TODO:** Tweaks-Needed "changes requested" follow-up composer state on reload; persist-guard
  that a client write only touches review-action columns (payload-level).
- **E) Kasper surface** — m5a core. **TODO:** SAMPLE badge across queue pagination depth;
  Kasper approve/request/undo/finish/close persist via real Kasper card controls; calendar↔samples
  reverse isolation deeper.
- **F) Isolation / flag-off** — ✅ f1 (flag default-off hides nav, no channel, 0 cards, "is off"
  view, control flips on). **TODO:** calendar↔samples deeper isolation; OLD samples module
  (`_sm*`) untouched while sxr runs.
- **G) Realtime / multi-actor** — **TODO (none yet):** cross-tab push (routeWebSocket), self-echo
  window, field-level merge of concurrent patches, recent-save window protects a fresh approval.
- **H) Everything else** — **TODO (none yet):** calendar review lifecycle/fields/Linear/drag/
  comments, Kasper for calendar, client share for calendar, onboarding, TikTok pilot, templates.
