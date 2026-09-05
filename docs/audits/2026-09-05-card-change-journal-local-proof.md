# Private card journal: local SQL proof

**DRAFT / UNAPPLIED; synthetic local evidence only.** The operative installation,
retention, backup and rollback contract is
[`docs/ops/CARD_CHANGE_HISTORY.md`](../ops/CARD_CHANGE_HISTORY.md).

Source base: `287c16cd1c46da18c9d6e302e9a8d7c66c746e50`. Remote main was observed
at `731e7c248fd8c055a577e7c7f40a81236532250c`; unrelated drift was not included.
The final SQL rehearsal ran against portable PostgreSQL **16.14**, using only
literal loopback, a uniquely named synthetic database and actual source
migrations. No live backend, browser, provider, alert or cloud backup was called.

| Tested artifact | SHA-256 |
|---|---|
| `migrations/2026-09-05-card-change-journal.sql` | `32f2b1362ba859dfd136bc8568967dbe2c3420af064b0dccba665b6837a1fd9c` |
| `scripts/card-change-journal-rehearsal.js` | `5282f580f4b234dd1740300b2ac4a14ce52f304ebe6baf643cce49e32d972d3a` |
| `scripts/card-change-journal-rollback.sql` | `591e70186d88836df5305a7822c3bacea76304f272d5621d795156778791b6cd` |

**30 SQL assertions passed.** Coverage includes all six owners' INSERT, UPDATE
and DELETE; actual native row/comment RPCs and both Calendar/Samples source-cell
merge RPCs; retained native semantic events and outbox intents; idempotent
canonical replay; a committed first request with a rejected second; precise
client/key reassignment and future-column schema changes; normal/direct writes;
and full typed before/final values restored into isolated scratch tables without
side-effect triggers.

Concurrency is real: two database sessions overlap on one Workload row. The
test observes the first holding its transaction and the second waiting for a
database lock before asserting both committed versions and their exact before/
after chain. It does not dispatch a synthetic JavaScript event or assume two
sequential writes are concurrent.

Fault tests prove both directions of atomicity: an injected journal INSERT
constraint failure leaves the business row, native event ledger and outbox
unchanged; a later semantic-event failure rolls back the business row and its
already-inserted journal entry. Anonymous/authenticated reads and erasure are
denied; service role cannot forge journal entries; owner UPDATE/DELETE/TRUNCATE
are refused by immutable guards. Selected transport claims are explicitly
unverified and malformed optional metadata does not reject a valid save.
The exact rollback SQL disables six capture triggers, keeps all previous
history and immutable guards, and allows the existing service writer to save.

The representative local overhead exercise changes a full Calendar row with
approximately 2.8 KB of synthetic note text, 200 times per transaction, for
three alternating disabled/enabled rounds. Database-side elapsed times were:

| Capture | Round 1 | Round 2 | Round 3 |
|---|---:|---:|---:|
| Disabled | 4.002 ms | 4.439 ms | 4.333 ms |
| Enabled | 99.912 ms | 102.440 ms | 102.238 ms |

This fixture added approximately 0.48–0.49 ms per update locally. The final
journal relation including indexes/TOAST occupied 1,900,544 bytes after fixture
actions and 600 captured benchmark updates. These values are **not** production
latency, concurrency capacity, expected growth or permission to deploy; large
real comment/media/provider payloads and production contention were not modeled.

The complete offline unit run passed **401 of 402 suites**. Its sole failure,
`test/asset-access-any-team.js`, is the existing Windows absolute-path dynamic
import failure (`ERR_UNSUPPORTED_ESM_URL_SCHEME`, drive-letter protocol), also
reproduced in the untouched pinned-base checkout. The implementation changes
neither that test nor its application code. Repository map and truth checks
passed. The PostgreSQL proof is separately wired into the existing CI unit
job; hosted execution remains a separate receipt.

Limits remain explicit: the initial schema fixture uses the real baseline card
columns plus relevant native/Workload migrations, not a serving database dump.
No current full-schema fingerprint equality, real anonymous browser failure UI,
private Drive readback, expanded-corpus package restore, alert delivery or
30-day retention window is proved by these SQL assertions. The expanded backup
tests and separate PR #1293 manifest prerequisite must pass their own gates.
The first failed local fixture attempt stopped at the existing native dedup
contract before a write and was retained privately; adding valid synthetic
dedup/fingerprint metadata fixed the test setup, not the application.
