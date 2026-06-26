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
| New probes written this run | 3 |
| Distinct interactions verified | 67 (assertions) |
| PASS | 67 |
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

---

## BUGS FOUND

_None yet._

---

## NOT YET COVERED (resume here)

Matrix sections from the mission, with current status:

- **A) Lifecycle** — both comps (video/graphic), 3 actors, every transition; stale-approval
  clearing; worst-of overall; kasper_seen/approved_after_tweaks; concurrent double-clicks;
  audit events. _(in progress)_
- **B) Samples Linear sync (mocked)** — push on change; no-push unchanged; suppression;
  outbox retry; point-adoption; stale-regress; tweak-comment; __CLEAR_LINK__; link dedup.
  _(m4 covers core; deeper edges pending)_
- **C) SMM fields** — name, asset_url+open, thumbnail+open, creative-direction autosize,
  hide eye, video/graphic Linear links (paste/blur/clear/move), status pills menu, comments,
  drag-reorder, Saving/Saved/error/retry, optimistic+rollback, thumbnail derivation. _(m2 core)_
- **D) Client share** — render-gating, approve/request-change per comp, fields non-editable,
  internal notes hidden, persist-guard. _(m5b core)_
- **E) Kasper surface** — sub-tab gated, SAMPLE badge, paginated queue, actions persist,
  bidirectional isolation. _(m5a core)_
- **F) Isolation / flag-off** — nav hidden, no _sxr code, calendar↔samples isolated.
- **G) Realtime / multi-actor** — cross-tab push, self-echo window, field-level merge,
  recent-save protection.
- **H) Everything else** — calendar review lifecycle/fields/Linear/drag/comments, Kasper for
  calendar, client share for calendar, onboarding, TikTok pilot, templates.
