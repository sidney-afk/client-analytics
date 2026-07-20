# F27 per-team rollback — isolated TEST proof

**Status:** candidate source proved on a disposable PostgreSQL flag/outbox store;
not applied to the live Supabase project. No forward production flip, live
authority change, live-client mutation, Edge Function deploy, or n8n change
occurred.

## Candidate contract

Migration `migrations/2026-07-20-f27-team-rollback.sql` adds a service-role-only
rollback ledger and four guarded operations:

1. `track_b_f27_begin` requires F2 `off`, F4 `false`, and exact authority CAS;
   locks out enqueue races, installs a team hold, snapshots/hashes every active
   team intent, and quarantines only that team's rows.
2. `track_b_f27_classify` records exactly one owner decision per captured intent:
   replay, quarantine, discard with reason, or already reflected.
3. `track_b_f27_record_terminal` accepts a replay receipt only when the outbox
   row is terminal and the receipt is correlated and `ok:true`.
4. `track_b_f27_finalize` is the one guarded SQL statement that changes only the
   requested team's authority key. It refuses unless the exact captured
   authority still matches, both emergency stops remain engaged, every intent
   is classified, every replay has a terminal receipt, and the machine-read
   active count for that team is zero.

The open rollback row also blocks new `pending|failed|shadow_ok` outbox writes
for its team. Because native writer/event/outbox work is transactional, the
guard raises instead of allowing a source write to commit without its outbound
intent. The other team is not held or mutated.

## Isolated TEST transaction

- Candidate head: `65edd5953e4ac2aa3f1607235ccc350e1b29e24d`
- GitHub Actions run (observer outside n8n): `29756927254`
- Artifact: `8467076082` (`f27-team-rollback-proof`)
- Artifact digest: `sha256:7faf66a457d0108c4f26b4d570758afde646e49366ac0735683e6cc87fcdf349`
- Terminal transcript digest:
  `7330315891294baae3cbb87f55d62200ab32dc3fabbd861154d3b96601a5fd91`
- Rollback ID: `783f5bea-9c73-43ec-98ec-0c29ed65819b`
- Snapshot correlation ID: `42803f45-ae1c-4835-bb14-8403b0936574`
- Replay terminal correlation ID: `87ac2439-335d-480d-bc2d-568f2ab4f7be`
- Snapshot count: `4`
- Snapshot digest:
  `60878439a4946db8a8262477b13184d17e69c2bb71715092f8fb25f09e6396d5`

The disposable TEST store used only `client_slug='test-client'` with
`test_only=true`. It simulated Linear/Linear + F2 off + F4 false, moved Graphics
through a synthetic SyncView/live/parity-forward state, engaged both emergency
stops, then exercised replay/quarantine/discard/already-reflected decisions and
the guarded final statement. The terminal receipt reported:

- `active_team_rows: 0`
- `unclassified: 0`
- `unreceipted_replays: 0`
- authority before final CAS: Video Linear / Graphics SyncView
- authority after final CAS: Video Linear / Graphics Linear
- F2 after final CAS: off
- F4 after final CAS: false

Independent assertions proved exact prior flags restored, the Video row
byte-hash unchanged, every payload hash unchanged, premature finalization
refused, an already-claimed lease refused, a held-team enqueue refused, and
terminal receipts correlated. The
GitHub job summary and retained artifact are the outside-n8n observer; no pager
timestamp or quiet-monitor inference is used.

Cloud review of the first candidate found that clearing an already-claimed
lease could race a stateless drainer and that direct service-role UPDATE grants
made evidence rewritable. Head `65edd59` refuses begin while any affected active
row has `lock_token` or `locked_at`, never clears those leases during capture,
and exposes the ledgers read-only to service role while SECURITY DEFINER
functions own mutations. The proof above is the post-fix run and includes the
negative in-flight assertion.

## Boundary still open

This proof validates the additive SQL and the F63-style isolated transaction.
It does not authorize applying the migration, deploying anything, changing
flags, or flipping authority. A cloud reviewer must verify the draft PR before
the candidate is called merge-ready. After review/merge, applying the migration
to the live project requires a separate owner-approved change window, captured
pre-state, exact migration/readback, and a TEST-client-only deployed drill.
