# Bug archaeology — 2026-07-17 (scope: everything changed in the last 3 weeks)

Owner ask: run `/bug-archaeology` on the last 3 weeks, budget at executor judgment (max 5
cycles), ship findings as draft PRs. This is the dated evidence record; conclusions were
propagated to the F-register (F142–F144 addendum in
`docs/independence/CUTOVER_AUDIT_2026-07-13.md`), `ROLLBACK.md`, `docs/truth/BRIEFING.md`,
and `EXECUTION_LOG.md`.

## Plain-English summary

Three real problems survived adversarial verification, all descendants of incidents that
already happened this window:

1. **Staff thumbnail-folder resolution is silently broken in the live app** (F142). The
   `thumbnail-folder-resolve` Edge Function's CORS allowlist was written before the
   2026-07-14 hardening made every signed-in-staff call carry `X-Syncview-Key`; the browser
   preflight now fails and the feature no-ops with only a console warning. Same mechanism as
   the 2026-07-15 share-button outage. Fix + a class-wide guard test are in a draft PR; the
   live function still needs a manual redeploy after merge (no workflow deploys it).
2. **The dark write-UI lane cannot write from a browser until `production-write` is
   redeployed** (F143). The `x-syncview-source` allow-header fix is on `main` (`139a4c8`)
   but the deployed v11 predates it — it is a manual-dispatch-only function and the dispatch
   never ran. Node drills bypass CORS, so soak stays green while every browser write through
   the reroute lane fails preflight. Owner action: pinned manual
   `deploy-onboarding-edge-functions` dispatch at a `main` SHA ≥ `139a4c8`. Not a frozen
   writer; the ⛔ freeze is untouched.
3. **The F44 intake installer would re-break every form intake if ever reinstalled** (F144).
   Linear removed `Project.team`; the live workers were hand-patched on 2026-07-16, but the
   repo-side installer still emitted the removed query and its test mocks pinned the stale
   shape. Fixed in a draft PR by porting the live workers' plural membership check verbatim.

Also shipped: the calendar reconciler's eval sandbox now has the extraction guard its
samples twin got after the `_sxrNormStatus` prod crash, and `ROLLBACK.md` gained the missing
`write_ui_reroute_clients` kill-switch row (the newest live flag was absent from the
emergency runbook).

Honesty counts: 14 scored candidates → 3 confirmed, **8 refuted**, 3 parked undecided.

## Deliverables

| Artifact | Where |
|---|---|
| F142 fix + CORS class guard | draft PR from `claude/bug-archaeology-3-weeks-k8c7ic-f1` (`test/ef-cors-allow-headers.js` control-tested: fails on the unfixed EF) |
| Calendar reconciler extraction guard | draft PR from `claude/bug-archaeology-3-weeks-k8c7ic-f2` |
| F144 installer + test-mock fix | draft PR from `claude/bug-archaeology-3-weeks-k8c7ic-f3` |
| Register F142–F144, ROLLBACK row, BRIEFING bump, log entry, this report | draft PR from `claude/bug-archaeology-3-weeks-k8c7ic` |
| F143 | owner action only (deploy); no repo change beyond register/log rows |

## Method and evidence

Corpus mined: `EXECUTION_LOG.md` (every incident 2026-07-03→16), the F-register F01–F138,
`ROLLBACK.md`, 24 fix-flavored commits, and ~20 bug-born regression suites. Patterns worked,
per the skill's matrix: allowlist-missing-a-member (→F142), two-correct-changes-collide
(F142's mechanism), source-vs-live divergence after incident hotfixes (new pattern this run;
→F143 live-stale, F144 repo-stale — the two directions of the same family), sandbox-symbol-drift
(→reconciler guard), consumer-of-revoked-credential, upstream-shifted-under-us (→F144),
name-as-identity, robot-with-too-broad-a-trigger, whitelist-drop, docs-contradict-live
(→ROLLBACK row).

Live verification was read-only: OPTIONS preflight probes against 19 deployed Edge Functions
(full live allow-header matrix vs source), a key-only REST read proving
`write_ui_reroute_clients` exists (value untouched), and an n8n readback of workflow
`BrJSe8zCKUccfmIq` active version `9e5abc46` to port the live F44 patch verbatim.

## Refuted candidates (kept so the matrix learns)

1. Calendar reconciler grab list currently missing a symbol — sandbox rebuilt from its own
   list and apply-path exercised green (guard added anyway; the gap was the missing guard).
2. `production-comments` CORS gap — allowlist covers everything its staff-gated caller sends.
3. `smm-weekly-reports` CORS gap — direct header build sends only allowed headers.
4. `onboarding-capture` CORS gap — `_obPost` sends `Content-Type` only, never the helper.
5. `key-verify` CORS gap — single call site sends `Content-Type` + key only.
6. `client-review-link` still broken live — live probe shows actor/role present; the owed
   manual redeploy recorded in the 2026-07-15 log entry did happen.
7. Leftover consumers of the four F88-revoked tables — zero direct REST readers remain in
   `index.html`, `qa/`, or `scripts/`.
8. PTO name-as-identity — rows key on `member_id` UUIDs; display-name matching exists only
   at the fail-closed caller-resolution boundary, and the shared-role-key residual is
   owner-accepted (D-36). `write-ui-n8n-authority-gates` uses `Issue.team`, which Linear did
   not rename.

## Parked (undecidable inside their timeboxes — not findings)

- `deploy-pto-edge-functions` migration-first gate: `github.event.before` all-zeros edge
  (branch create/force-push of main) silently passes the SQL-hold; likelihood on `main` low.
- Intake dead-letter alerting depth (`linear_intake_receipts`): whether a dead-lettered
  submission rings any bell needs an n8n+workflow sweep; adjacent to open F131/F132.
- Whether `thumbnail-folder-resolve` should join a deploy workflow: the thumbnail deploy
  loop is deliberately pinned to two slugs by the freeze-landmine guard; widening it is an
  ops-policy decision, not a bug fix.

## Loop accounting

Cycle 1: corpus (3 parallel miners) + lensing + CORS/symbol-drift/robot-trigger sweeps;
cycle 2: live-vs-source matrix, hotfix-divergence family, docs-vs-live; ship. Stop reason:
remaining queue all low-score after the hotfix-divergence family swept dry — executor
judgment inside the owner's 5-cycle cap. Seen-ledger (incl. refuted) kept in the run notes;
known register rows (e.g. F65, F79/F80, F91) were deduplicated, not re-reported.
