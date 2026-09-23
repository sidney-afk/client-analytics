---
name: dawn-check
description: The weekday MORNING CHECK for SyncView — a fixed ~10-minute walk, in a real browser against the live backend on the test client sidneylaruel only, of the seven flows that matter most (client approve, client request changes, staff card save, card rename with sub-issue following, Workload open time, SyncLinear first rows, Analytics first numbers), ending in a short plain-English report with a screenshot per failure and timings against the 2026-09-23 speed map. Use when the owner says "run the morning check", "dawn check", "is SyncView OK this morning", "did anything break overnight", or when the scheduled weekday workflow fails and needs reading. Does NOT author new probes (that is /overnight-test), run every lane (/master-test), or do Production-tab parity (/human-audit).
---

# Dawn check — is SyncView OK this morning?

Why this exists (owner, 2026-09-23, relayed by Lighthouse): a daily morning check
that walks the flows that matter most on the test client, and says in plain English
what passed, what failed (with a screenshot), and how fast the key tabs opened
against the numbers in `docs/audits/2026-09-23-speed-map.md`. It reuses what exists
(`qa/sxr_courier_lib.js` contexts and Linear mock, `qa/probes/ot4_lib.js` client
clicks, `qa/test-client-entry.js` for the client link) instead of new machinery.

## Safety (read first — non-negotiable)

- **Test client `sidneylaruel` only.** The script's page-level guard aborts any
  POST that names another client and turns the run red. Never widen the slug.
- **Put everything back.** The three `p_dawn_*` seeds are archived and verified;
  the renamed card and its sub-issue are renamed back and verified. The
  "Everything put back" line must be ✅. If it is not, fix the leftovers before
  anything else (archive `p_dawn_*` rows, restore the card name).
- **Linear never hears about it.** The courier context mocks every Linear hook and
  aborts `api.linear.app`; the rename uses a card whose sub-issue has **no Linear
  mirror** (`deliverables.linear_issue_uuid` empty).
- Contract: `docs/testing/HEADLESS-TESTING-GUIDE.md` §5. Frozen client writers are
  never "fixed" from this skill — a red flow is reported, not patched in passing.

## Inputs

- `SYNCVIEW_STAFF_KEY` in the environment (staff writes + minting the client link).
  It lives as a repo secret; locally it must be exported in the shell. Without it
  the script exits 2 and says so.
- `SYNCVIEW_ROLE_KEY` (optional secret): a staff ROLE key. Role-gated reads refuse
  the staff key above (`workload-plan` answers 401), so without it Workload is
  reported ⚠️ "not measured" instead of failing. Adding the secret turns it on.
- Baselines: the cold/warm medians in `qa/dawn/dawn-check.js` `BASELINE`, copied
  from the speed map §2. When a newer speed map lands, update that block.

## The walk (fixed, bounded — one pass, no loops)

| # | flow | pass means |
|---|---|---|
| 1 | Client approve | fresh client context lands on the Review tab; the real Approve button saves the caption as `Approved` + approval stamp, and it holds |
| 2 | Client request changes | real Request-changes button with text; `Tweaks Needed` + the text saved |
| 3 | Staff card save | caption typed + blurred; DB has it and the card's save mark reaches "Saved" (a "Saved, syncing" step is allowed only if it clears) |
| 4 | Card rename | card name and its linked sub-issue title both change; then both put back |
| 5–7 | Workload / SyncLinear / Analytics | first real content within 30 s; 🐢 "slow" if over 1.5× the speed-map cold median; ⚠️ "not measured" if the tab needs a role key the run lacks |

Client flows act on the **caption**: a disposable seed has no native work item,
and a video approval without one is refused by design (`native_link_required`,
since the 2026-08-28 video flip). Caption writes are source-only, so the seed takes
them and the real Approve / Request-changes buttons and save path are exercised.

Stop conditions are built in: every wait has a cap (35 s DB, 60 s sub-issue, 30 s
tab); the run ends after one pass. Exit 0 = all passed (slow is a warning), 1 = a
flow failed, 2 = missing key.

## Running it

Scheduled: `.github/workflows/dawn-check.yml`, Mon–Fri 11:30 UTC. On demand:

```bash
gh workflow run dawn-check.yml
```

Locally (serves the app itself on :8000):

```bash
SYNCVIEW_STAFF_KEY=... SXR_COURIER=0 node qa/dawn/dawn-check.js
```

## Output contract

`qa/dawn/out/DAWN_REPORT.md` (git-ignored; also the Actions run summary and the
`dawn-check-<run>` artifact with screenshots): a one-line verdict, one line per
flow (✅ / 🐢 / ❌ with a screenshot path), a timing table against the map, and
the put-back line. When reporting to the owner, lead with failures, attach failure
screenshots (SendUserFile), and keep it to a few lines.

**Findings earn their name:** before calling a ❌ a product bug, re-run that one flow
once (`gh workflow run` again or locally). A failure that does not reproduce is
reported as "flaky once", not as a bug. A reproduced one goes to
`docs/ops/OPEN_REPAIRS.md` as a candidate, value-free, and the owner decides its tier
(`docs/QUALITY_TIERS.md`) — a one-line question, never absorbed.

Pairs with: `/master-test` (everything, on demand), `/overnight-test` (continuous
new coverage), `/site-assurance`. Dawn check is the small, fixed, daily one.
