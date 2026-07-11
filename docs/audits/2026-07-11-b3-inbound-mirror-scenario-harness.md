# B3 inbound mirror scenario harness - 2026-07-11

## Scope and safety

`scripts/b3-mirror-scenario-harness.js` exercises the live Linear -> Supabase
mirror against the TEST project only. It fails closed unless every configured
issue belongs to that exact project, uses a VID-/GRA- identifier, and
`B3_CONFIRM_TEST_MUTATIONS=1` is present.

Observations use the public Supabase key. Recovery writes use the existing
RPC-backed incremental-refresh and reconciler paths, scoped respectively to
the TEST project and one TEST identifier. Exact fixture restoration uses the
same `deliverable_write` / `batch_write` RPCs. The harness does not read or
write runtime flags or `mirror_outbox`.

Before the live rerun, the current deployed function source was saved outside
the repository and matched the repository source byte-for-byte. Tag
`pre-b3-restore-fix-2026-07-11` records the pre-change code state.

## Measured consistency contract

Retained TEST webhook payloads established which fields Linear actually sends:

| Operation | Payload evidence | Contract used by the harness |
|---|---|---|
| Due-date clear | Execution `248975` omitted `dueDate` | Reconciler-eventual |
| Assignee clear | Execution `248997` omitted `assignee` and `assigneeId` | Reconciler-eventual |
| Re-parent | Execution `249003` sent `parentId` but omitted the parent object | Incremental-refresh-eventual |
| Restore | Execution `249012` sent action `restore` but omitted `archivedAt` | Strict realtime, with explicit marker clearing in the inbound function |

The resulting assertion model is:

- **Realtime:** status, title, priority, due-date set/change, assignee
  set/change, archive, restore, comments, races, and duplicate-delivery
  handling.
- **Reconciler-eventual:** due-date clear and assignee clear when the partial
  webhook omits the cleared field.
- **Incremental-refresh-eventual:** issue adoption and re-parent structure.
- **Skipped/N-A:** unmapped state when every active team state has a valid
  SyncView mapping. The harness does not create a workspace state for a probe.

## Restore fix and rollback rehearsal

The inbound restore path now removes `archived`, `webhook_delete`, `deleted`,
`delete`, and `removed` markers recursively from `linear_raw`, and explicitly
sets `linear_raw.issue.archivedAt` to null. An EF-level test proves an archived
fixture is hidden, the restore transform removes every marker without mutating
the input, and the restored fixture is visible.

Deployment and rollback were both rehearsed:

1. The pre-fix deployed source was function version 11.
2. The fix was deployed as version 12.
3. The private pre-fix bundle was redeployed as version 13. A harmless TEST
   title round-trip mirrored in 2.724 seconds and was restored exactly.
4. The fixed bundle was redeployed as version 14, which is the active version.

The operational kill switch remains
`linear_inbound_enabled={"enabled":false}`. Code rollback is redeploying the
private pre-fix bundle captured before this change.

## Final live matrix

Final run marker: `b3-mirror-mrguysjz`.

| Scenario | Consistency | Result | Duration | Evidence |
|---|---|---:|---:|---|
| Create parent + sub-issue | Refresh-eventual | PASS | 15.350 s | Project-scoped refresh adopted both issues and the batch; cleanup refresh removed the disposable rows. |
| Full status ladder + backward regression | Realtime | PASS | 36.117 s | Every step reflected, including Approved -> Tweak Needed. |
| Title change | Realtime | PASS | 12.822 s | Title reflected and targeted reconciliation stayed at zero. |
| Due date set -> change -> clear | Realtime + reconciler-eventual clear | PASS | 32.290 s | Set/change reflected realtime; clear converged through targeted reconcile event `8285`. |
| Priority change | Realtime | PASS | 18.287 s | Priority changes reflected and cleanup restored the fixture. |
| Assignee set -> change -> clear | Realtime + reconciler-eventual clear | PASS | 32.635 s | Set/change reflected realtime; clear converged through targeted reconcile event `8297`. |
| Unknown assignee repair lane | Realtime repair classification | PASS | 14.095 s | Repair-list count became one while real-diff count stayed zero. |
| Unmapped state tolerated lane | N-A | SKIPPED | 0 s | Every active VID/GRA state maps; no workspace state was created for the probe. |
| Re-parent and preserve parent | Refresh-eventual | PASS | 27.099 s | Project-scoped refresh event `8307` moved the row to the immediate-parent batch; a later realtime title event preserved it. |
| Archive hides mirror row | Realtime | PASS | 14.920 s | The row became hidden. |
| Cancel hides mirror row | Realtime | PASS | 12.985 s | Canceled status reflected and the row became hidden. |
| Reopen reappears | Realtime | PASS | 17.314 s | `mirror_in_restore` arrived, archive markers were absent, and the row became visible. |
| Rapid successive edits | Realtime | PASS | 12.579 s | The final value won and targeted reconciliation stayed at zero. |
| Duplicate webhook within 60 seconds | Realtime | PASS | 16.309 s | The duplicate produced no double material mirror event. |
| Cross-team batch | Realtime | PASS | 13.687 s | TEST VID and GRA rows both reflected and retained the shared batch. |
| Comment add + echo filter + tweak pinning | Realtime | PASS | 23.191 s | One genuine entry, one mirror event, explicit pinned shape, and zero imported legacy-echo copies. |

Totals: **15 PASS / 0 FAIL / 1 SKIPPED / 16 scenarios**.

## Cleanup and final gate

- All original TEST Linear issues and Supabase rows matched their private
  pre-run snapshots after cleanup.
- Disposable issues created by the final run were archived in the TEST
  project; no active probe batch remained.
- Harness final summary event `8346` and independent full v2 dry-run event
  `8347` both reported `diff_count=0`, `repair_list_size=0`, and
  `linkage_actionable=0`. The independent run checked all 4,323 deliverables
  and all four expected webhooks.
- Runtime flags matched their pre-run snapshots. No real-client row, n8n
  workflow, Linear webhook, schema, auth mode, or `mirror_outbox` row changed.

Detailed JSON, Markdown, payload, and console evidence remains in the private
local evidence bundle outside the repository.
