# Linear exit continuation handoff — September 12

## Start here

Continue preparation in draft PR [#1382](https://github.com/sidney-afk/client-analytics/pull/1382),
branch `integration/linear-exit-current-main-20260910`.
The code checkpoint is `2de445389b578d2307c05ece7f0a540734d29725`,
tree `d2cab6b04de2729e656169d6f372fa76bf316ef8`.
This handoff is a subsequent documentation-only commit. Verify the remote head
and that this code checkpoint is its ancestor before continuing. Do not substitute
the old September 10 repair bundle or the September 11 handoff as current code.

The build has advanced substantially, but it is incomplete. Installation and
retirement remain HOLD. No merge, installation, deployment, production write,
workflow dispatch or n8n execution/edit was performed for this checkpoint.

## Owner decisions

Prepare and publish reviewed code, strategy and sanitized evidence on this draft
branch. Do not merge, including locally; do not deploy, install, dispatch workflows,
write production data or run/edit n8n. Keep current client URLs, payload compatibility,
review links and tokenless access.

The owner explicitly approved narrow atomic-persistence preparation inside Calendar
and Samples. Keep the original serving captures and repository 401 controls. The
owner also approved retaining verified native save/completion receipts while
requiring zero work destined for Linear and zero unresolved provider debt. Unknown
or malformed records still block shutdown. These approvals do not authorize switching.
See canonical B5 and the September 12 final-switch decision; do not ask again.

## What is prepared

- Atomic Calendar/Samples candidates save the card, comments, event and two pending
  follow-up tasks in one database transaction. Both tokenless captured handlers and
  both repository authentication refusals were rehearsed. Conflict, maintenance and
  actual SQL fault rollback controls pass. Operation replay is an RPC guarantee,
  not an exactly-once guarantee across separate browser requests.
- Four new SQL owners add admission history, guards across 86 original tables,
  protected worker transactions, SQL-derived completion proof and narrowly scoped
  discard/quarantine for an existing real F27 rollback.
- A disabled private worker bundle runs the source-derived graphic helper in one
  transaction. Actual Deno/SQL capture and resolution, stale attempts and durable
  failure tests pass; external graphic transports were synthetic. Immutable image
  paths prevent overwrite. No worker or schedule was installed.
- V1 recovery remains compatible. V2 restores all 90 tables, with 89 populated and
  the private transaction context correctly empty. Exact schema/row comparison,
  corruption rollback, clean retry and encrypted reopening pass. A Windows function
  body transport defect was fixed without weakening exact schema fingerprints.
- Object export and encrypted custody have passing synthetic adapter tests. The
  live source adapter and independent off-device/key custody are still missing.
- A separate four-owner release extension pins source bytes and order. Its SHA-256
  is `5bfa474d9623cfc68b52a4ccc6d4f125967a7c0245f5ffe6be9861c26f121c63`.
  It supplements the old 64-entry inventory; it is not the completed installer.

Read these focused documents instead of restarting the audit:

1. `docs/independence/LINEAR_EXIT_ATOMIC_SAVE_CHECKPOINT_20260912.md`
2. `docs/independence/LINEAR_EXIT_COMPLETE_DATA_CHECKPOINT_20260912.md`
3. `docs/ops/LINEAR_EXIT_RELEASE_MATRIX_20260912.md`
4. `docs/independence/LINEAR_EXIT_ADMISSION_RELEASE_EXTENSION_V1.json`

## Evidence index and limits

| Lane | Final receipt | Classification |
| --- | --- | --- |
| Both atomic handlers | `f4588674c3bd44aaacb8095f98dcfe79` | Isolated handler/SDK-to-PG17; not hosted REST |
| Application DML admission | `f5951f9e254443288fdcf9067d555f0f` | Isolated PG17; not a global platform fence |
| Follow-up outcome proof | `992c36c9a47d45e591132635e50efff2` | Ten SQL-derived cases and ten forged-outcome refusals |
| Actual helper/worker | `e182b29247d14f7e84f00a855b73e832` | Actual Deno/PG17, synthetic external bytes |
| Provider disposition | `0fa74b00f6714360857352138ca0661f` | Two dispositions and eleven refusal controls |
| Admission preflight | `1f9a1fdd85a74ac99bee193de162f7cf` | 17 functions, four tables, 173 triggers; five catalog mutation refusals |
| Complete V2 recovery | `f56c618f50dd4103bf3c7813f8167820` | Isolated PG17, exact 90-table restore and encrypted reopen |

Raw local receipts remain in the sibling `2026-09-12-fast-finish-evidence` directory.
They are not all uploaded and must not be assumed to exist on another machine.
The public repository contains source, harnesses, sanitized summaries and exact
source contracts, not private database artifacts or credentials. No secret keys
belong in GitHub. Preserved failed runs remain failed; later passing runs supersede
only their documented defects.

Final offline checks pass for release extension, writer bundle, transaction,
worker, private endpoint, worker bundle, admission preflight (28 corruption cases),
V1/V2 data, application custody, object export, object custody (21 groups), recovery
package (18 groups), and repository map. Staged Git blob hashes were checked against
the release extension after correcting two script line endings. Production writer
candidate bytes did not change. Captured SQL CR bytes remain deliberately preserved.

## Next bounded work, in order

1. Finish recovery of failed/unknown follow-up tasks, preserving evidence and proving
   effects before any retry. Claimed tasks cannot currently be cleared by merely
   declaring them disposed. Cover remaining helper outcomes; do not invent success.
2. Complete the prepared installer/resume ordering for the four-owner extension and
   worker/writer bundles. Preserve refusing activation. Test interrupted installation
   and exact installed-prefix classification in isolation.
3. Resolve external Linear worker fencing/replay and creation of a final F27 snapshot
   after closure. The existing disposition owner covers only an existing rollback.
   Reconcile accepted work predating durable admission. Direct sequence operations,
   DDL, new tables, Auth and Storage are outside the 86-table DML guard proof.
4. Prepare worker cadence/monitor ownership, the live object export adapter and
   notification/recovery handover. WR-101 refusal diagnostics remains unbuilt and
   requires its own separately reviewed Edge Function release.
5. Obtain a focused review of the completed preparation revision. Hosted baseline,
   serving/configuration, real recovery custody/restore and delivery checks belong
   to a separately authorized owner window. Do not erase these requirements to
   describe the build as finished.

Use the existing portable PostgreSQL runner; Docker is not required. PG17 lanes
include `card-atomic-handlers`, `followup-worker`, `followup-outcome-proof`,
`provider-debt-disposition`, `admission-preflight` and `complete-application-recovery`
(the latter with `-ApplicationDataV2`). Start with affected tests, not another broad
audit. The runner refuses inherited production credentials: clear those variables
only in the child test process and never print them. Keep all transports isolated.
There is no justified final completion date until the remaining recovery/fencing
design is resolved; report small verifiable milestones instead of a guessed ETA.
