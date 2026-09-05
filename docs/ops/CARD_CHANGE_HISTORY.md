# Private card change history

**DRAFT / UNAPPLIED.** This is the bounded database/backup slice of the owner's
request to retain every card change for at least 30 days. Source base:
`287c16cd1c46da18c9d6e302e9a8d7c66c746e50`. Remote main observed during preparation:
`731e7c248fd8c055a577e7c7f40a81236532250c`; unrelated changes were not incorporated.
No database migration, grant, writer deployment, flag, backup setting or live
test was performed. Merging these files does not install database capture.

## What this preserves

`migrations/2026-09-05-card-change-journal.sql` installs one private append-only
`card_change_journal` with AFTER INSERT/UPDATE/DELETE triggers on these six
actual row owners:

| Owner | Exact identity | Responsibility |
|---|---|---|
| `calendar_posts` | `(client,id)` | Calendar, SMM/Kasper/client review, source comment cells, status, schedule, ordering, asset links and native bindings |
| `sample_reviews` | `(client,id)` | Samples and review state, ordinary source notes/tweaks, ordering, assets and bindings |
| `batches` | `id` plus recorded `client_slug` | Native parent, name, brief, folders, status and intake parent |
| `deliverables` | `id` plus recorded `client_slug` | Native work, assignment, due date, status, brief, assets and crosswalk |
| `production_comments` | `id` plus nullable recorded `client_slug` | Canonical body, audience, component, reply ancestry, edits/resolution/deletion and attribution metadata |
| `workload_plan` | `issue_id` plus recorded `client` | Internal planned date and stored updater, distinct from native due date |

The complete old/new row, changed-column names, both keys and client scopes,
actual column type/nullability metadata and its fingerprint, database name,
transaction ID and server times are stored in the same transaction as the
business change. Changed keys preserve both identities; missing clients on
unmapped retained canonical comments remain honestly NULL. Direct SQL and
stale/legacy writers receive the same capture while the triggers are enabled.
Future columns on those six owners are captured, not silently omitted by an
outdated browser allowlist. New owner tables require an explicit next migration
and backup corpus revision.

This records **committed row changes**, not every click or HTTP request. A
multi-request UI action may commit one part and reject another; the journal
retains exactly the committed part. Rejected/rolled-back writes leave no journal
entry. Existing idempotent no-op requests make no new row version; an actual
no-op UPDATE is still a database event. Identity sequence gaps are normal after
rollbacks. IDs/times are not global commit order; use transaction grouping and
the serialized before/after chain for a particular entity, not a guessed global
timeline or count of user actions.

Existing native semantic events, versioned canonical-comment events and outbox
receipts remain in place. The journal never consults `app.event_written` and
does not replace the mutable comment store or make the canonical reader cover
source-only notes. Legacy review notes in card cells remain separately
identifiable through the exact card/component/comment IDs in the snapshots.
Do not correlate comments by body text or assume a source note was imported.

## Privacy and attribution

No public/client reader, history UI, realtime publication or retention job is
added. RLS plus revoked privileges deny anon/authenticated access. Service role
may SELECT, but cannot insert, alter or erase history. Private backup access is
a separate reviewed grant to the existing restricted database backup role.
Row and TRUNCATE guards reject accidental history mutation even by the table
owner; a privileged owner can deliberately disable guards and therefore remains
outside an application-level immutability guarantee. There are no foreign keys
from history to current rows, so deleting those rows cannot cascade evidence.

Full snapshots contain confidential briefs, comments and possibly signed media
URLs. Keep dumps, row samples, restore output and client/person identifiers out
of this public repository, CI logs, browser APIs and alert messages. The six
owners do not include credential/token identity tables. Do not add sensitive
authentication columns to these business tables without reviewing history
retention. The journal stores no JWT, request headers, IP address or share token.

Database session user/role and only the request's selected `role`/`sub` claims
are retained as **transport evidence, person unverified**. Service-role requests
and direct SQL can assert claims. Row author/updater fields remain source
metadata, not proof of who performed the current edit. An unchanged original
comment author is not an editor identity. Existing verified semantic receipts
may provide richer actor evidence where an exact correlation exists. Anonymous
author text remains a claim; unknown actors remain unknown. Malformed optional
JWT metadata is ignored rather than making an otherwise valid save fail.

## Retention and recovery boundary

Proposed retention: **90 days, with a minimum of 30 days**, plus the preceding
recoverable checkpoint needed to reconstruct that interval. There is no auto
prune, drop or overwrite in this draft. Do not announce a 30-day guarantee on
installation day: it requires proof of a continuous retained window, complete
authenticated off-database packages and successful restore drills. Changes
never recorded before installation cannot be reconstructed retroactively.

Atomic capture survives application bugs that overwrite or delete current
rows. Off-database recovery is still limited by the existing six-hour snapshot
cadence and scheduler reliability; this does not enable continuous WAL/PITR.
Historical asset URLs are not the attachment bytes. Asset rescue and independent
private storage remain separate work. Privileged DDL/TRUNCATE on owner tables,
disabled triggers, replication modes that bypass ordinary triggers, and database
loss since the latest off-site package are explicit limits, not silently covered.

## Staged installation and completion gates

All steps below are **future owner-operated work**, not authorization from this
draft. No frozen Edge Function source is redeployed and no anonymous review
link is replaced or re-gated.

1. **Prepare and review source.** Run the unit suite and real local PostgreSQL
   rehearsal on the exact candidate. Independently review SQL permissions,
   dependencies, dump parser and restore boundaries. Clients see the current
   site because this stage installs no database code or website changes.
2. **Keep current backups operating.** Merge reviewed preparation only after
   proving the existing default 14-table corpus still exports/restores as its
   limited historical format. Record a fresh authenticated private package and
   current six-owner schema/trigger/grant definitions before installation. A
   missing future table must not interrupt the default legacy schedule. The
   expanded history corpus is explicitly selected only after its prerequisites
   exist; see [TRACK_B_BACKUP.md](TRACK_B_BACKUP.md). Clients continue to use
   unchanged writers; backup SQL is read-only.
3. **Prepare scratch and prerequisites.** The expanded corpus also requires
   `production_intake_manifests` from PR #1293, reviewed at
   `5418ab5618595d9469f0527bd94623e9229a637e`, migration
   `2026-09-05-native-intake-root-manifest.sql`. That PR is a separate unmerged/
   uninstalled dependency at this draft's base; existence in a local checkout
   is not deployment proof. Do not silently omit it or copy/reimplement it here.
   Its production-write deployment is a separate release decision. Reconstruct
   the matching scratch schema and exact restore helper before testing the
   expanded package. No client surface changes in this preparation.
4. **Install database capture in a reviewed quiet window.** Apply the exact new
   journal migration once in its transaction. It refuses missing owner tables,
   unexpected primary keys/client columns, or an existing partial installation.
   The five-second lock timeout prevents a migration from waiting indefinitely;
   a timeout aborts the entire install. SQL table locks can briefly delay saves,
   so this is not a promise of zero added latency. Bound lock/latency/error
   observations and abort without proceeding if clients encounter errors.
   Read back the exact function/trigger/table/grant definitions and verify six
   enabled capture triggers and no public privileges before calling it installed.
5. **Prove real client continuity through the reserved TEST lane.** Use the
   separately approved designated TEST client and exact reserved disposable
   IDs, anonymous share link and actual UI. Test create/edit/status/approval,
   ordinary note/tweak/reply, assignment/due/planned date through their real
   staff surfaces, and read back the matching committed row versions. Preserve
   residue when acceptance is unknown. Do not retarget existing client cards,
   race cleanup, or automate unattended writes without their separate gates.
   Regular clients keep the same UI and writer access; capture adds database
   work to saves. If history insertion fails, the matching save fails rather
   than committing without evidence. That failure must stay visible/retryable
   in real clients before rollout is considered complete.
6. **Activate complete private backup.** Install reviewed grants only after all
   expanded-corpus tables exist, export the exact new corpus, authenticate and
   download the actual stored package, then restore it into isolated scratch
   with external effects disabled. Verify current rows and old versions, keys,
   counts, checksums and preserved journal. Only then explicitly change the
   backup corpus setting. Refuse missing tables, old-format fallback or missing
   private privileges; do not silently treat a limited package as full history.
   Clients see no UI change because export reads the database and restore targets
   scratch only. Scheduled backup code must remain usable before this activation.
7. **Observe before claiming coverage.** Track six-trigger health and serving
   writer versions, failed saves, capture exceptions, committed-row/journal
   correlation on the reserved canary, local storage growth, backup age/corpus,
   HMAC/readback and restore outcomes. Test actual alert delivery to the owner's
   selected channel; code or a GitHub failure without delivered notification is
   insufficient. Record sanitized counts/times/hashes only. Review at 24 hours,
   seven days and at the 30-day retention boundary; retain 90 days by default.

Any client save regression, missing capture, changed dependency/serving revision,
unexpected actor disclosure, incomplete package, restore mismatch or unreceived
test alert stops progression. Reassess migration/storage overhead against
current production measurements before scheduling installation; local timings
are not capacity approval.

## Retained-data rollback

The behavior rollback is the one owner-run transaction in
`scripts/card-change-journal-rollback.sql`, disabling **only** the six
`card_change_journal_after` triggers. Preserve the journal table, its identity
sequence, immutable guards, private grants and all signed backup packages. No
business row, outbox, auth policy, writer, native-intake manifest or provider
state is rolled back. This stops new capture and suspends complete-history
claims from that timestamp; it does not erase earlier evidence. Re-enabling
requires resolving the failure and a new canary. Do not try to backfill the
unobserved gap with invented actions.

For data repair, reconstruct into scratch from a checkpoint plus exact journal
images, validate client/key/schema/foreign-key relationships, compare with the
present state, and prepare a separate minimal owner-reviewed CAS repair. Never
blindly replay historical UI actions, events or outbox rows; those may notify
people or call providers again. A v3 limited package cannot be substituted for
a complete expanded-corpus restore. Keep old signing keys in private recovery
storage so historical packages remain verifiable.

## Local proof and limits

Run `node scripts/card-change-journal-rehearsal.js` with
`CARD_HISTORY_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY`, literal-loopback
`CARD_HISTORY_PGHOST`, its disposable port, and optionally `CARD_HISTORY_PSQL`.
The runner starts no service, creates a uniquely named synthetic database,
retains it on failure, and drops only its own database on success. It refuses
non-loopback targets. CI runs the same SQL rehearsal against its PostgreSQL 16
service. No live HTTP transport, alerts or provider workers are invoked.

The rehearsal applies real baseline card columns and the owning SQL/RPC chain,
then checks all six INSERT/UPDATE/DELETE owners, normal native and source-comment
RPCs, direct writes, idempotent replay, a committed first request followed by
rejected second request, overlapping locked writes, private read denial,
immutability, schema drift, client/key moves, injected capture failure, and
typed prior/final reconstruction with no side-effect triggers. It preserves
existing semantic/outbox behavior. Live writer deployment, real browser failure
UI, durable Drive delivery, full installed schema compatibility, 30-day retention
and production capacity remain unproven until their separate gates above pass.
