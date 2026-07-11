# B4 incremental-refresh heartbeat — private n8n snapshot stub

- Workflow: `qllIDZPkdNAPRj0b` — `SyncView Monitoring Pager + Reconciler V2 Trigger`
- Change date: 2026-07-11 UTC
- Scope: additive B1 incremental-refresh dispatch every ~30 minutes plus a 90-minute summary-staleness alert.
- Pre-change full JSON: private local backup, SHA-256 `35dad89b793a12ee7074aedded9d706233ec50d116ef35f4c5de0000d9589a24`.
- Post-change full JSON: private local backup, SHA-256 `0f524fa1a4b0e8837df7f5ce864ab40a0a9e3235dd5e2441a8af76b4c5f202cc`.
- Public-repo safety: no workflow JSON, credentials, tokens, webhook URLs, or private payloads are committed here.
- Focused rollback: disable node `Gate Incremental Refresh 30m`.
- Full pager rollback: deactivate `qllIDZPkdNAPRj0b`, or restore the private pre-change JSON and publish it.
- Live proof: tick `244578` dispatched green B1 run `29143764570` and wrote summary event `7772`; tick `244646` skipped the intervening dispatch and emitted no alert.
