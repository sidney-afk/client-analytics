# `qa/` — live golden-path interaction probes

> **Want to run everything at once?** See **[`MASTER_TESTER.md`](./MASTER_TESTER.md)** —
> one command (`npm run test:master`) runs every lane (unit, parity, probes,
> scenarios, temporal) plus a **vision pass** that looks at real screenshots and
> judges whether the UI looks right *and* behaves right. The `/master-test` skill
> drives it with Claude's eyes in the loop. The probes below are individual lanes.

Runnable, end-to-end probes for the 6 golden review paths in
`docs/testing/CALENDAR-TEST-CATALOG.md` §10.4. They drive the **real** Kasper and client
handlers across surfaces and assert on the backend after every step.

> **These hit the LIVE backend and mutate the `sidneylaruel` test client.** They
> are deliberately **not** in `test/` (that suite is offline/pure). Each probe
> archives its card at the end. Only ever run these against the test client.

## Run
```bash
# serve the app (same code the live site/extension serve)
python3 -m http.server 8000 &
# then, from the repo root:
node qa/golden_1_clean_approve.js
node qa/golden_2_kasper_tweak_loop.js
node qa/golden_3_client_tweak_loop.js
node qa/golden_4_approve_after_tweaks.js
node qa/golden_5_undo_approve.js
node qa/golden_6_archive_cross_surface.js
```
Each prints `GOLDEN n: pass=… fail=…` and exits non-zero on any failure.

## What each covers
| Probe | Path |
|---|---|
| `golden_1_clean_approve` | SMM→Kasper → Kasper approve → client approve → mark posted |
| `golden_2_kasper_tweak_loop` | Kasper request change → SMM resolve→Kasper → Kasper approve → client approve |
| `golden_3_client_tweak_loop` | Kasper approve → client request change → SMM resolve→client → client approve |
| `golden_4_approve_after_tweaks` | Kasper "approve after tweaks" → SMM resolve→client (no Kasper re-review) → client approve |
| `golden_5_undo_approve` | Kasper approve → **undo** (toast) → request change |
| `golden_6_archive_cross_surface` | archive from Kasper Approval / Tweaks Needed → card leaves Kasper's queue → un-archive restores |

## How they work (`golden_lib.js`)
- **Kasper actions** → real handlers (`_kasperApproveComp`, `_kasperRequestTweakComp`, `_kasperApproveAfterTweaksComp`, and the Undo toast).
- **Client actions** → real `_calReviewApprove` / `_calReviewRequestTweak` on a live client page (client mode).
- **SMM status moves** → the upsert webhook (the exact write the SMM status control performs).
- **Assertions** → the Supabase row (what every surface renders from), polled after each step, plus Kasper-queue membership.

The probes model **one component** (caption — no Linear dependency), pinning
video/graphic to `Approved` so the lower-wins overall status tracks caption. To
extend to the full 33 transition-pairs, reuse `golden_lib.js` the same way.
See `docs/testing/HEADLESS-TESTING-GUIDE.md` for the harness conventions and
`docs/testing/interaction-path-generator.js` for the full path/pair enumeration.
