# Linear exit owner composition rehearsal

Current extension: the lane also installs the actual provisioning and complete
Workload owners, then verifies provisioning, browser attribution and the native
Workload row. It reaches 44 passing assertions before a hard
`NOTIFICATION_SOURCE_SCHEMA_REQUIRED` failure: the four card/batch/deliverable
`deleted_at` columns have no established source owner. Notification SQL is not
applied past that gate. The earlier 41-check PASS below describes the prior
bounded lane; it is not the current overall result. See
`qa/linear-exit-rehearsal/RESULTS.md` for evidence and limits.

Run `node test/linear-exit-owner-composition.js` only against an owned disposable loopback PostgreSQL instance with `F63_REQUIRE_POSTGRES=1` and the existing F42 PostgreSQL connection variables. It creates and drops its own test database. It never contacts Supabase, Slack, Linear or n8n.

The source order is A1, B0, the native-intake harness prerequisites, legacy artifact owners, full F27, root manifest, label foundation, atomic native intake plus named append, receipt retention, native assignment and label owners, event assignee, ordinary receipts and repairs, then retirement admission and recognizer. Legacy artifact owners must precede full F27: applying their old enqueue replacements afterward discards the F27 wrapper. Fixture authority changes occur only after the F27 preinstall gate accepts the dormant baseline.

The 41 explicit assertions and supporting equality assertions exercise ordinary and provider writes, native receipt retention, comment lifecycle, concurrent replay, actual F27 stale-generation rejection, and a boundary before retirement admission followed by resumption that preserves an existing receipt. The four prerequisite receipt/hold triggers use real production functions; no no-op prerequisite or simulated F27 classification trigger is installed. The deliberate concurrency pause trigger changes timing only.

Scope remains bounded. This is not a full production schema installation, crash/restore rehearsal, or proof of intake/assignment/label business operations. Synthetic cards and external-service scaffolding remain inherited from the established F42 fixture. Workload, provisioning, notifications, media, reconciliation, full backup/recovery and hosted serving gates are outside this lane. Retirement activation still refuses; the later admission concurrency case explicitly sets a future retired state inside the disposable fixture and is not evidence that activation works. Installation remains HOLD.
