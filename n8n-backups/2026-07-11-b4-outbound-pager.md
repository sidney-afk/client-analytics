# B4 outbound pager snapshot - 2026-07-11

- Workflow: `qllIDZPkdNAPRj0b` (`SyncView Monitoring Pager + Reconciler Trigger`)
- Private pre-change export: `n8n-pager-qllIDZPkdNAPRj0b.pre-outbound-edit.json`
- Pre-change SHA-256: `1E90DCD9461BDE2574ED190B719B22D926E7DC1CA6CFBF680861C51545550F46`
- Private pre-repair export: `n8n-pager-qllIDZPkdNAPRj0b.pre-outbound-fix.json`
- Pre-repair SHA-256: `98C36DB9A3B56F789BF0240A8EB0C05C2D712A00D32E0A34735A0F7ABE82F431`
- Private post-change export: `n8n-pager-qllIDZPkdNAPRj0b.post-outbound.json`
- Post-change SHA-256: `7F422C7253C2475438BAD3DA82281209E4D1439F2AF3D3E5DB702D78581C7102`

The active workflow gained an outbound Actions dispatch and an outbound-summary read. Its existing
one-hour alert throttle now also covers failed writes, growing backlog above 100, a run writing more
than 50 rows, shadow-vs-actual mismatch, and a summary older than 90 minutes while outbound mode is
active. Before the draft lands on `main`, the new Actions dispatch is fail-soft because GitHub cannot
dispatch a workflow file that is not yet on the default branch; stale paging is suppressed while the
global mode remains `off`.

Scheduled executions `250299` and final dark-state check `250463` completed successfully after the repair. The outbound trigger,
summary read, and pager-condition nodes all completed; the condition node produced zero alert
items. The Actions request remains intentionally non-operative until the workflow file exists on
`main` after owner merge.

Rollback: restore the private pre-change export, or remove/disable only `Trigger Outbound Drainer`
and `Fetch Outbound Summary`. Disable workflow `qllIDZPkdNAPRj0b` to stop every pager dispatch and DM.
No credential values or raw workflow JSON are stored in this public repository.
