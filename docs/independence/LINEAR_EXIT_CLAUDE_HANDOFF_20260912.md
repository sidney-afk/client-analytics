# Linear exit: Claude continuation handoff

Latest preparation: see `LINEAR_EXIT_OBSERVED_BASELINE_AND_JOURNAL_20260912.md`
for the exact observed starting catalog, routine reconstruction and durable
installation journal.

Continue preparation in draft PR [#1382](https://github.com/sidney-afk/client-analytics/pull/1382),
branch `integration/linear-exit-current-main-20260910`.
Reviewed code checkpoint: `01535b09a562b8be19b1952effb4a6f9ae4034e2`.
Tree: `27f4731cc509b54b8ecaf73bdc8b5ff554835fb5`.
This handoff is a later documentation-only commit. Verify the remote head and that
this code checkpoint is its ancestor. Do not assume an old local scratch directory
or the September 10 repair bundle represents the current preparation.

## Plain-English status

The replacement system has working pieces for saving cards safely, tracking
unfinished follow-up work, retrying interrupted work, and restoring the application
database in isolation. The local checks described in the consolidated checkpoint
pass. It is not yet the complete installation build. The main remaining work is to
match the real starting database, prove installation can recover if interrupted,
and finish the shutdown, asset recovery and notification handover procedures.

Nothing has been merged, installed, deployed or switched off. Installation and
Linear retirement remain HOLD. Do not treat local green tests as hosted proof.

## Persistent owner decisions

- Prepare and publish reviewed code, strategy and sanitized evidence on this draft
  branch. No merge, including local merge; no deployment, installation, workflow
  dispatch, production writes, or n8n execution/edit.
- Narrow atomic-persistence preparation inside Calendar and Samples is explicitly
  approved. Preserve existing URLs, payload compatibility, review links and
  tokenless access. Keep original serving captures and repository 401 controls.
- Keep verified native save/completion receipts. Require zero work still destined
  for Linear and zero unresolved provider debt. Unknown or malformed records and
  unresolved failures still block shutdown. Do not ask for these approvals again.
- Avoid secrets, client display names and share tokens in public content.
- Work economically in bounded steps. Do not restart the broad audit or chase
  unrelated new main changes. The owner requested this wrap-up and handoff; do not
  interpret it as permission to claim the full build is complete.

## Read these first

1. `docs/independence/LINEAR_EXIT_OBSERVED_BASELINE_AND_JOURNAL_20260912.md`:
   latest evidence and remaining starting-schema/journal integration gaps. Then
   `LINEAR_EXIT_CONSOLIDATED_CHECKPOINT_20260912.md` for the preceding seven-owner
   build, exact source hashes and retained historical failures.
2. `docs/ops/LINEAR_EXIT_RELEASE_MATRIX_20260912.md`: preparation versus installation,
   activation, restoration and final retirement requirements.
3. `docs/independence/LINEAR_EXIT_ADMISSION_RELEASE_EXTENSION_V1.json`: current seven
   SQL owners, writer/worker/supervisor source pins and prerequisite contracts.
4. `AGENTS.md`, `docs/FIND_ANYTHING.md`, `docs/truth/BRIEFING.md`, and canonical B5.

The earlier September 12 atomic and recovery/export checkpoints remain useful
historical evidence. Their old hashes and counts are not the current build.

## First bounded task

Finish exact starting-schema reconstruction, starting with
`LINEAR_EXIT_OBSERVED_BASELINE_AND_JOURNAL_20260912.md`. Read-only observation and
routine provenance mapping are complete: the portable `observed-routines` lane
now matches all 115 complete function records, including raw bodies and grants.
Do not redo that audit. Full table/object equality remains unfinished; selected
nonroutine reconstruction is a private partial proof, not a complete baseline.
Recover the private prototype if available, otherwise use authorized read-only
schema captures. Never publish unreviewed raw captures or infer application DDL.

Classify every candidate owner against the observed stage before assembling the
pending installation plan. The 31 source-phase entries are rehearsal entries,
not a proved list of pending hosted migrations. Some candidate routines already
exist live. Do not blindly replay the 64-entry inventory. The new `install-journal`
lane proves 17 actual crash/resume and refusal cases, but journal bootstrap,
pending-owner plan integration and accepted-write exclusion remain unfinished.

Then follow the ordered remaining work in the consolidated checkpoint: actual
installation/resume and internal-commit failure recovery; external Linear worker
fencing and safe replay/disposition; accepted old work reconciliation; verified SQL
asset-reference coverage and independent encrypted recovery/key custody;
notification ownership/configuration/delivery recovery; final refusing-activation
protocol and separately scoped WR-101. A quick review cannot waive these gaps.

## Reproduce without production access

Repository source and sanitized evidence are published. Private receipts and
prepared bundles are not uploaded or implied to be GitHub attachments. Locally,
receipts live under `D:/Sidney/Codex/2026-09-12-fast-finish-evidence`; do not assume
that folder exists on a different machine. Recreate evidence from committed sources
when private originals are unavailable.

Use `qa/linear-exit-rehearsal/run-portable.ps1` and its exact named lanes. Portable
PG17 is available locally under
`D:/Sidney/Codex/2026-09-09-repair-evidence/postgres17/pgsql/bin`.
Docker is not required. The harness refuses inherited production credentials;
clear them only in the child process, never print values or mutate hosted state.

The latest added lanes are `observed-routines` and `install-journal`.
The preceding affected lanes are `source-phases`, `source-baseline`,
`followup-outcome-matrix`, `admission-preflight`, and
`complete-application-recovery -ApplicationDataV2`. Follow the runner's parameters
and use a new private output directory. Do not rerun every historical lane solely
because this handoff is new. Exact pin and offline bundle/cadence/export tests are
listed in the checkpoint and repository map.

Generate worker and writer bundles with their committed bundle scripts into new
absolute directories. The generated worker passes Deno checking from its own
function directory with `--no-config --node-modules-dir=none --no-remote --frozen
--lock=deno.lock`. No endpoint, schedule or independent observer is installed.

Completion must mean a reviewed full preparation build with all remaining work
honestly resolved or separately categorized as an authorized hosted acceptance
step. Installation requires fresh, separate owner authorization afterward.
