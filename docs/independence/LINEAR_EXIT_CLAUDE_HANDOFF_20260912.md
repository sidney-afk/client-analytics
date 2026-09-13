# Linear exit: Claude continuation handoff

Continue preparation in draft PR [#1382](https://github.com/sidney-afk/client-analytics/pull/1382),
branch `integration/linear-exit-current-main-20260910`.
Reviewed preparation code checkpoint: `4e78529ac2e0268fdd84791182dc06d4a1b57a97`.
Tree: `5009d68b6295862f0eb74c189ec7ff6b4ea77827`.
Verify remote HEAD and ancestry before continuing. Later documentation commits
do not expand the evidence scope of this checkpoint.

Reviewed follow-up `01b8a60158cfb72a7adefcdedac7e385cedd7e24` adds authenticated
original/rescued byte-equality evidence (11 isolated tests plus coverage checks)
and notification health refusal for malformed/inconsistent counts (nine existing
plus twelve added handler cases). Read
`../ops/NATIVE_NOTIFICATION_HANDOVER_PREPARATION_20260912.md` for the prepared
operator acceptance sequence. No hosted asset or notification acceptance is implied.

The subsequent deterministic read-observation recovery is documented in
`../ops/LINEAR_EXIT_PROVIDER_CREATE_OBSERVATION_PREPARATION.md`: 11 isolated PG17
checks and eight offline transport checks pass. Matching exact reads can recover
a lost acknowledgment without fabricating one; absence/conflict remains unresolved.
The expanded observed installation plan is still under calibration and is not
yet accepted as a new combined target. Recorded batch/non-F203 creates and other
uncertain operations still require preparation.

## Plain-English status

The replacement has tested pieces for saving safely, keeping unfinished work
visible, recovering several interrupted sends, and backing up and restoring the
application together with its private control records. The newest pieces are not
yet assembled into one fully tested installation package. The full preparation
build remains incomplete. Installation and Linear retirement remain HOLD.

Nothing has been merged, deployed, installed, activated or switched off.
This is a continuation handoff, not approval to install.

## Persistent owner decisions

- Publish reviewed code, strategy and sanitized evidence only to branches/draft PRs.
  No merge, including local merge; no deployment, installation, workflow dispatch,
  production writes, or n8n execution/edit.
- Narrow atomic Calendar/Samples internal preparation is approved. Preserve URLs,
  payload compatibility, review links and tokenless access. Original serving
  captures and repository 401 controls remain immutable evidence.
- Keep verified SyncView save/completion receipts. Require zero work destined for
  Linear and zero unresolved provider debt. Unknown, malformed or failed work
  still blocks shutdown. Do not ask for these approvals again.
- No secrets, client display names or share tokens in public content.
- Work economically. Reuse exact evidence; do not restart the audit or chase
  unrelated main changes. Main integration is pinned to
  `14fb430afd82471ba6f875ccd460ca304fa0721f`.

## What is proved, and what is not

| Component | Evidence | Important limit |
|---|---|---|
| Observed starting schema and older installation plan | Exact captured public catalog reconstructed; 35 sources, 42 journal chunks, maintenance refusal and finalization passed | New recovery/diagnostics owners are outside that target |
| Private control recovery | PG17 receipt `c4b4eef93262422aa27b4235dbb9d11c`: 94 tables captured, encrypted, reopened and restored; server stopped | Includes provider owners through ACK context plus diagnostics; later public comment/create owners need combined coverage |
| Original admission/checkpoint recovery | 14 PG checks, `ea7cd892b03a46928467ec4d85aa525c` | Legacy attempts without original proof refuse |
| Acknowledged issue update recovery | 8 PG checks, `7832d19ef4e9492aa65d1a8bd6930eef` | Lost/uncertain provider responses remain unresolved |
| Acknowledged comment recovery | 10 PG checks, `93a10d02de15462b985096dad85bae3a` | Delete requires immutable pre-send evidence; absence alone is insufficient |
| Deterministic issue-create recovery | 9 PG checks plus six parser comparisons, `406bda5591b54ab5bd1078edd0f46cdc` | Legacy/batch/nonplanned creates and uncertain observations remain open |
| WR-101 refusal diagnostics | 13 PG checks, `28dd7d7f6a844554b46896c51cdd4021`, including composed gateway and real SQL conflict | Separate prepared release; no hosted full-browser proof, cadence or activation |
| Asset references | Authenticated package/inventory plus actual synthetic file-byte checks; reused historical scanner passes 30 tests | External copies, full estate coverage and independent custody remain open |
| Notification health | Nine actual-handler cases with injected SQL results; overdue retries now count as unhealthy | No hosted delivery or handover acceptance |

The provider V2 composed handler retains the same 12 Deno diagnostics as baseline.
Both checks remain red; there are no new diagnostics, but no clean typecheck.
Tests above are isolated/offline evidence, never production acceptance.

## Read these first

1. `LINEAR_EXIT_CONTROL_RECOVERY_20260912.md` and
   `LINEAR_EXIT_CONTROL_RECOVERY_PROOF_20260912.json`: exact private profile,
   source pins, restoration behavior and evidence limits.
2. `LINEAR_EXIT_PROVIDER_RECOVERY_20260912.md`: original intent binding,
   acknowledged recovery, retained review findings and remaining operations.
3. `../ops/WRITE_REFUSAL_DIAGNOSTICS_PREPARATION_20260912.md` and
   `LINEAR_EXIT_ASSET_REFERENCE_COVERAGE_20260912.md`.
4. `LINEAR_EXIT_OBSERVED_BASELINE_AND_JOURNAL_20260912.md`,
   `LINEAR_EXIT_OBSERVED_INSTALL_TARGET_V1.json` and
   `../ops/LINEAR_EXIT_RELEASE_MATRIX_20260912.md`.
5. `AGENTS.md`, `docs/FIND_ANYTHING.md`, `docs/truth/BRIEFING.md` and canonical B5.

Earlier checkpoints are historical. Their hashes/counts must not be presented as
coverage of subsequently added owners. The September 10 bundle is not this build.

## Remaining preparation, in order

1. Finish provider recovery coverage: legacy/batch/nonplanned issue creation and
   operation-specific read evidence for uncertain sends. Do not resend blindly,
   fabricate successful mutation responses, or use a caller boolean as proof.
   Preserve newer native edits and exact linkage/audit effects. Reconcile accepted
   older work; new ledgers cannot retrospectively prove it.
2. Add reviewed new owners to the exact observed pending installation plan. Create
   a new target and full table/trigger preflight; never append owners while reusing
   the old 35-source target hash. Preserve already-present historical owners.
   The F203 historical owner used by component fixtures is a test prerequisite,
   not permission to replay it on the observed database.
3. Run one combined installation/interruption/resume/recovery rehearsal using the
   packaged observed-schema entry point and final source inventory. Include all
   new public recovery functions and private profiles. Restored systems must stay
   closed to writes/sends until separately verified; source journal identity is
   retained and does not authorize automatic resume on another database.
4. Finish external asset/reference verification, original-versus-copy byte proof,
   recovery custody interfaces, notification handover and external-worker fencing.
   Define exact refusing activation checks and operator recovery steps.
5. Publish a reviewed full preparation build and evidence index. Separate fresh
   hosted configuration/data checks, independent key retrieval, delivery drills
   and installation/activation into an owner-authorized acceptance window.

There is no reliable completion-time estimate until the unresolved provider
cases and combined rehearsal pass. Do not trade missing proof for a deadline.

## Reproduction and private evidence

Repository source and sanitized evidence are published; raw receipts, database
captures and keys are not GitHub attachments. Local private evidence is under
`D:/Sidney/Codex/2026-09-12-fast-finish-evidence`. On another machine, reproduce
from committed sources or obtain private artifacts securely; do not assume old
scratch directories survive.

Use `qa/linear-exit-rehearsal/run-portable.ps1` with its named lanes and a fresh
private output directory. Portable PG17 is available locally at
`D:/Sidney/Codex/2026-09-09-repair-evidence/postgres17/pgsql/bin`.
Docker is not required. The harness refuses inherited production credentials;
never print them or point these tests at a hosted database.

Added lanes include `control-recovery`, `provider-checkpoint-recovery`,
`provider-ack-recovery`, `provider-comment-recovery`, `provider-create-recovery`
and `write-diagnostics`.
Consult the runner for exact parameters. Reuse component receipts and test only
changed boundaries; do not repeat every historical suite merely for a new handoff.
