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
| `migrations/2026-09-05-card-change-journal.sql` | `1a353835fee61ab8d52ae3f9ed94d83ea1fdb85f6ba9e45eace642409c96ef1e` |
| `scripts/card-change-journal-rehearsal.js` | `6aad9b40d83e7771601a618fa69130665428b5c149f02a901b359c4e86f89595` |
| `scripts/card-change-journal-rollback.sql` | `591e70186d88836df5305a7822c3bacea76304f272d5621d795156778791b6cd` |

**31 SQL assertions passed.** Coverage includes all six owners' INSERT, UPDATE
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
| Disabled | 4.747 ms | 3.593 ms | 3.666 ms |
| Enabled | 89.223 ms | 95.080 ms | 90.115 ms |

This fixture added approximately 0.42–0.46 ms per update locally. The final
journal relation including indexes/TOAST occupied 1,900,544 bytes after fixture
actions and 600 captured benchmark updates. These values are **not** production
latency, concurrency capacity, expected growth or permission to deploy; large
real comment/media/provider payloads and production contention were not modeled.

Before backup integration, the complete offline unit run passed **401 of 402 suites**. Its sole failure,
`test/asset-access-any-team.js`, is the existing Windows absolute-path dynamic
import failure (`ERR_UNSUPPORTED_ESM_URL_SCHEME`, drive-letter protocol), also
reproduced in the untouched pinned-base checkout. The implementation changes
neither that test nor its application code. After integration, the existing
backup suite, all 33 new corpus test groups, the journal boundary suite,
repository map and truth checks passed. Both PostgreSQL rehearsals are wired
into the existing CI unit job; hosted execution remains a separate receipt.

Limits remain explicit: the initial schema fixture uses the real baseline card
columns plus relevant native/Workload migrations, not a serving database dump.
No current full-schema fingerprint equality, real anonymous browser failure UI,
private Drive readback, production-derived expanded-corpus restore, alert
delivery or 30-day retention window is proved by these SQL assertions.
The separate PR #1293 manifest prerequisite must pass its own installation gate.
The first failed local fixture attempt stopped at the existing native dedup
contract before a write and was retained privately; adding valid synthetic
dedup/fingerprint metadata fixed the test setup, not the application.

## Actual 21-table local backup and restore

**14 assertions passed** against the actual export, authenticated package and
restore implementation, using real private backup/scratch grants and a real
`pg_dump`. All 21 tables contain synthetic records. Full typed rows in every
table match the original after restore, including historical old/deleted
comment bodies, source cells and native manifest intent. This full-content
comparison belongs to the local rehearsal: the operational restore script
itself checks counts and its defined core foreign-key queries, not arbitrary
semantic equivalence of every restored value.

The exact separate PR #1293 prerequisite is commit
`5418ab5618595d9469f0527bd94623e9229a637e`; its normalized migration SHA-256 is
`39ac761471e67b2f9e66d78a9783a374070b924cf6abf6d67aeee79da01cfcf1`.
The rehearsal requires this explicit file and hash; it does not copy or
silently stub an uninstalled dependency.

Negative tests execute malformed COPY, deferred foreign-key refusal, an empty
excluded table with an incoming foreign key, a legacy package against an
expanded target, and failure after sequence adjustment. They retain target
rows and trigger state. Sequence values never rewind; harmless gaps remain
possible because `setval` is not transactional. A subsequent accepted journal
insert remains above the preserved counter floor. Foreign keys stay enforced,
`TRUNCATE RESTRICT` remains narrow, and side-effect triggers do not replay
external work during restore. Full installed scratch-schema compatibility,
private Drive delivery and alert delivery remain separate unproven gates.

| Tested backup artifact | SHA-256 |
|---|---|
| `scripts/card-history-backup-rehearsal.js` | `52065a776117b03ce548f7464f6c0cea25b9c476653be0cb3f9779263a5ce5c5` |
| `scripts/track-b-backup.js` | `4e3602ad80e09e3e0955a58de498618e4e859ea7d9e283b51fdbd45b23b5dd3c` |
| `scripts/track-b-restore-rehearsal.js` | `85668d6e7ab5cd1f4eb3be0c6612a72f550679461ca3c12964422aef971dee9f` |
| `scripts/track-b-history-backup-prerequisites.sql` | `00199dfd6aa745a7e7cba1873a8da24b9a0104f4ef366b3d076873bf860ca204` |

Both runners record source hashes before execution and refuse a PASS if any
bound runtime file changes during the run. Initial local fixture failures were
retained privately. The final proof follows correction of the manual grant
artifact's CASE syntax and the restore sequence floor; differing session
timezones are compared as typed UTC values, preserving the actual instant.

## Separate present installation blocker: draft conservation

The independent finite feedback-failure pass at the same `287c16cd` base and
`index.html` SHA-256
`27db2f4e5e40f03cf599fbd43c5d14fdae226ddef987f3b245506012bf1ee638`
reported **18 failing / 9 payload-conservation passing cells** across 27
synthetic cases. These are separate browser assertions, not part of the 31 SQL
assertions above. Source inspection independently confirms the implicated
Kasper handler clears its draft before awaiting persistence and restores only
the post on refusal (`_kasperAddCommentComp`, lines 75108/75119 at this base);
`_kasperRequestTweakComp` restores the submitted body over the active draft at
line 75221. The test pass also exercised `_calReviewComment` and
`_sxrReviewComment`: refused plain notes restore only memory and disappear on
reopening; refused explicit tweaks lack reopen conservation.

This is not a blanket finding that accepted feedback is lost. The separate
Samples preservation candidate at `a3f86c96e99b0d1ff3e93d6ac9f8e2ee496f8ca5`
retains the submitted plain note under its owned recovery record with the same
comment ID, while newer unsent typing still needs protection. Accepted-but-lost
responses retain backend payload in the tested subset; a missing Calendar/
Samples projection alone is not proof of erased work. Actor/client replacement
was outside this finite failure pass. The separate current repair has no final
reviewed head at this report's preparation time.

Installing mandatory atomic capture before those refusal/reopen paths are
fixed would expose users to a known failure-conservation defect when a journal
insert fails. The journal remains draft/unapplied until that explicit dependency
is repaired and proved; the migration is not a workaround for the browser bug.
