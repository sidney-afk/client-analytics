# Linear exit preparation: reviewer handoff

Draft PR [#1382](https://github.com/sidney-afk/client-analytics/pull/1382), branch
`integration/linear-exit-current-main-20260910`.

**The preparation build and strategy are ready for a fresh review.** The complete
installation and interruption/resume rehearsal passed. Installation and actual
Linear retirement remain HOLD until their separately authorized acceptance gates.

Published preparation code revision:
`75f3c2bfc4f5ff9f9b2df259b57834b9b4b88d09`.
Tree: `03b8eac7b5b3574c42df355f3ca411ea7283b602`.
Later documentation commits do not expand the tested source scope. Verify the
revision and evidence pins; do not substitute a different branch snapshot.

## What the next review must establish

Review the final preparation revision against the release matrix, its exact
installation target and evidence. Do not restart the historical audit. The
September 10 repair bundle and older 35/42-source targets are historical; they
are not substitutes for the final build. Current-main integration is pinned to
`14fb430afd82471ba6f875ccd460ca304fa0721f`.

| Area | Latest evidence | Boundary |
| --- | --- | --- |
| Complete installation | Calibration `332df4aeaf7b48218006e705b9128ff7`; fresh replay `e0b065b2a07b470681bab971ed8fca64`: 48 sources, 55 chunks, 39 exact public bodies, actual interruption/54-chunk rollback prefix/fresh resume, target comparison and finalizer pass; servers stopped | Selected final-owner interruption; no hosted baseline or installation authorization |
| Final switch and ordinary work | `870e686ac23d4b029daf9322dd999066`: 46 PG17 checks, server stopped | Actual isolated native reopen, ordinary mutations/comments/intake/assignment/labels; no hosted activation |
| Complete relational/control recovery | `b353532767364586a6a6f997c8eb3bbc`: encrypted recovery of 94 tables and 32 selected public routines; 27 source-pin entries verified | Restores admission closed, retains unresolved work and permanent provider fence; no automatic resume/activation |
| Uncertain issue/attachment recovery | `c11222c47c3642328380235cb39eca4d`: 56 PG17 checks; 10 offline transport controls | No mutation resend or fabricated acknowledgment; unknown reads and unsupported historical dispositions remain unresolved |
| Other provider recovery | Recorded create 27, comment observation 20, terminal history 31 PG checks; earlier checkpoint/ACK/create proofs retained | Requires original recorded intent/context; old unrecorded attempts cannot acquire invented evidence |
| Client saves and public intake | Existing isolated atomic Calendar/Samples handler proofs; captured public journey 24 checkpoints | Preserve tokenless captures and repository 401 negative controls; no hosted acceptance or cross-request exactly-once claim |
| Native approval completion | 172 reconciler and 39 native offline checks, with isolated SQL verification/revalidation | Hosted REST serialization and grants remain owner-window checks |
| Asset custody | 102-object loopback Storage custody/restore; 11 original/copy byte-equality checks and historical coverage scanner | Not proof of all real assets, external provider access or independent custody |
| Notifications and background work | SQL/adapter/actual health-handler checks, disabled worker and transactional recovery proofs | Delivery, destinations, configuration and independent outage observer require acceptance |
| WR-101 diagnostics | 13 isolated PG17 checks; separate prepared function release | SQL installation alone does not deploy or activate diagnostics |

Evidence is isolated/offline unless explicitly stated otherwise. The provider V2
composed handler retains the same 12 Deno diagnostics as baseline: both remain
red, with no additional diagnostics. Do not report a clean typecheck.

## Read in this order

1. `../ops/LINEAR_EXIT_RELEASE_MATRIX_20260912.md`: release decisions and remaining gates.
2. `LINEAR_EXIT_CONTROL_RECOVERY_20260912.md` and
   `LINEAR_EXIT_CONTROL_RETIREMENT_PROOF_20260913.json`: final recovery profile and exact pins.
3. `../ops/LINEAR_EXIT_RETIREMENT_SWITCH_PREPARATION.md` and
   `../ops/LINEAR_EXIT_PROVIDER_ISSUE_OBSERVATION_PREPARATION.md`: final switch/recovery evidence and trust boundaries.
4. `../ops/LINEAR_EXIT_EXTERNAL_WORKER_HANDOVER_PREPARATION.md` and
   `../ops/NATIVE_NOTIFICATION_HANDOVER_PREPARATION_20260912.md`: inventory, stop/readback, debt reconciliation, delivery and recovery.
5. `LINEAR_EXIT_OBSERVED_FULL_PIPELINE_20260913.json` and
   `../ops/LINEAR_EXIT_OBSERVED_FULL_PIPELINE_PREPARATION.md`: final target,
   source pins, interruption scope and retained failed runs. Also read
   `LINEAR_EXIT_ASSET_REFERENCE_COVERAGE_20260912.md` for custody boundaries.
6. `../ops/LINEAR_EXIT_ATOMIC_WRITER_INSTALLATION_BINDING.md`: exact observed
   catalog input, final-plan binding and unchanged generated writer files.

## Separately authorized installation and retirement window

Capture and classify the actual hosted baseline before selecting the pending
installation prefix. Never replay historical prerequisite owners merely because
a generated writer bundle lists them. Bind writer/worker artifacts to the final
observed installation plan; a partial prerequisite list is not an install plan.

Prove real data and asset census closure, readable originals/copies, independent
key retrieval, off-device custody and restore/access. Unsupported external access
flows, including some Drive assets, can require an additional reviewed adapter
if the actual census includes them. Storage tests do not waive that requirement.

Inventory and stop all actual external workers under separate authorization,
reconcile in-flight provider and follow-up work, and keep ambiguous outcomes
blocking. Verify hosted configuration, destinations, delivery receipts and an
independent outage observer before enabling senders. Installation, native
capability acceptance, Linear retirement, retention and deletion are separate
decisions. Local green tests authorize none of them.

## Owner boundaries

- Publish reviewed code and sanitized evidence to draft branches/PRs only.
- No merge, including local merge; deployment, installation, workflow dispatch,
  production writes, or n8n execution/edit in this preparation.
- Narrow internal atomic Calendar/Samples preparation is approved. Preserve URLs,
  compatible payloads, existing review links and tokenless access.
- Keep verified native/save/completion receipts. Require zero Linear-bound work
  and unresolved provider/follow-up debt; unknown or malformed work still blocks.
- No secrets, client display names or share tokens in public artifacts.

## Reproduction

Private receipts/captures remain under
`D:/Sidney/Codex/2026-09-12-fast-finish-evidence`; they are not GitHub attachments.
On another machine, reproduce from committed sources or transfer required private
inputs securely. Do not assume scratch directories survive.

Use `qa/linear-exit-rehearsal/run-portable.ps1` and its explicit named lanes.
Portable PG17 is available locally at
`D:/Sidney/Codex/2026-09-09-repair-evidence/postgres17/pgsql/bin`.
Docker is unnecessary. The harness refuses hosted routing/credentials. Reuse
existing receipts and rerun only changed or unverified boundaries.
