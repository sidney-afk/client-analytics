# Linear exit owner composition rehearsal

Current extension: 65 assertions pass. Calendar/Samples table definitions,
composite keys and status-stamp functions/triggers come from eight statements
in `migrations/live-schema-baseline-2026-07-03.sql`. Function bodies are retained
with SQL terminators added; they are installed before their captured triggers.
A fresh catalog-only read confirmed the six journal-owner primary keys match,
but this dated extraction is not a complete current hosted schema.

After the earlier 48 cases, the lane installs journal, feedback recovery and
crosswalk owners, then checks tenant-separated journal keys, rollback, actual
canonical comment mutation, matching crosswalk import/replay, identity refusal
and feedback hold after canonical deletion. This late installation is a bounded
test sequence, not the recommended production installation order. The lane
reports `history-v11` table presence explicitly; full recovery remains unproven.

The next source-owner group installs Samples events, write attribution, legacy
intake receipts, PTO, team-shaped project mapping, native intake reconciliation,
card materialization, outbound cutoff, legacy intake triage, native identifier
minting, native brief media and description images. These are actual migrations,
not placeholder tables. Ten additional checks exercise PTO stale-write refusal,
exact retained materialization request bytes/hash and refusal replay without a
card, native identifier allocation and rename/reseed protection, media custody
constraints, immutable media-history privileges and browser-role audit denial.

All 52 `history-v11` table names are now present. The diagnostic explicitly says
`RECOVERY_TABLE_PRESENCE_ONLY`, with `missing_tables: []` and
`full_restore_proven: false`. Presence does not establish complete schema,
rows, callable contracts, restore correctness or recoverability.

The external Storage scaffold supplies `storage.buckets` column shapes confirmed
by a catalog-only read on 2026-09-10: non-null text `id`/`name`, nullable boolean
`public`, bigint `file_size_limit` and text-array `allowed_mime_types`. This is
explicit synthetic platform scaffolding, not an application schema owner or a
copy of hosted bucket rows. Applying the real media owners to it does not prove
hosted Storage configuration, object bytes, access behavior or custody.

Current extension: the lane also installs the actual provisioning and complete
Workload owners, then verifies provisioning, browser attribution and the native
Workload row. The notification owner now consumes existing archive status and
raw lifecycle markers; no synthetic `deleted_at` columns are supplied. The lane
also checks target liveness and actual ordinary-writer intent creation. The
earlier `NOTIFICATION_SOURCE_SCHEMA_REQUIRED` failure exposed the mistaken
soft-delete assumption; its receipt remains historical evidence. See
`qa/linear-exit-rehearsal/RESULTS.md` for evidence and limits.

Run `node test/linear-exit-owner-composition.js` only against an owned disposable loopback PostgreSQL instance with `F63_REQUIRE_POSTGRES=1` and the existing F42 PostgreSQL connection variables. It creates and drops its own test database. It never contacts Supabase, Slack, Linear or n8n.

The source order is A1, B0, the native-intake harness prerequisites, legacy artifact owners, full F27, root manifest, label foundation, atomic native intake plus named append, receipt retention, native assignment and label owners, event assignee, ordinary receipts and repairs, then retirement admission and recognizer. Legacy artifact owners must precede full F27: applying their old enqueue replacements afterward discards the F27 wrapper. Fixture authority changes occur only after the F27 preinstall gate accepts the dormant baseline.

The 41 explicit assertions and supporting equality assertions exercise ordinary and provider writes, native receipt retention, comment lifecycle, concurrent replay, actual F27 stale-generation rejection, and a boundary before retirement admission followed by resumption that preserves an existing receipt. The four prerequisite receipt/hold triggers use real production functions; no no-op prerequisite or simulated F27 classification trigger is installed. The deliberate concurrency pause trigger changes timing only.

Scope remains bounded. This is not a full production schema installation, crash/restore rehearsal, or proof of intake/assignment/label business operations. Synthetic cards and external-service scaffolding remain inherited from the established F42 fixture, with the declared Storage metadata extension above. Workload, provisioning, notification and media checks cover only the explicit cases above. Installing reconciliation, cutoff and triage owners does not prove their complete business flows; successful card materialization, full backup/recovery and hosted serving remain outside this lane. Retirement activation still refuses; the later admission concurrency case explicitly sets a future retired state inside the disposable fixture and is not evidence that activation works. Installation remains HOLD.
