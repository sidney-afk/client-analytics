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

The candidate `linear-outbound` source also has an explicit
`F27_ROLLBACK_REPLAY` mode. It selects only the exact rollback/dedup-bound
quarantined row, requires the open intent to be classified `replay`, rechecks
the authorization after claiming, requires F2 off + F4 false + SyncView
authority, and persists rollback/outbox/dedup/operation/correlation fields in
the real Linear result before releasing it. Failed attempts return only that
row to `quarantined`; neither global lane is armed. The shared request/result
helper is exercised by `test/f27-linear-outbound-replay.js`. This Edge Function
source is part of the draft only and was not deployed.

The open rollback row also blocks new `pending|failed|shadow_ok` outbox writes
for its team. Because native writer/event/outbox work is transactional, the
guard raises instead of allowing a source write to commit without its outbound
intent. The other team is not held or mutated.

## Isolated TEST transaction

- Candidate head: `afee809aefbf5cc3242df05a3047561548171d89`
- GitHub Actions run (observer outside n8n): `29764430971`
- Artifact: `8470167032` (`f27-team-rollback-proof`)
- Artifact digest: `sha256:8021ac47758b46d1d4de37183ebd5828053c66f6f52cb7ea36d32bd6c9f513f8`
- Terminal transcript digest:
  `9f48084737145e112a59e6d9a370f4fa54ca932ad1dd542afe8fc5164cce7ece`
- Rollback ID: `f77731a8-2503-4121-85e2-514cff596eee`
- Snapshot correlation ID: `bfcf2f5a-35b4-47f8-b2b8-e0029fee042b`
- Replay terminal correlation ID: `8e874155-81ec-46cf-966d-a412a97af6d3`
- Snapshot count: `4`
- Snapshot digest:
  `5f4becf405e32ba97859b0729cedbb48289c510243d642a5d15a18d07406fe11`

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
refused, an already-claimed lease refused, a held-team enqueue refused, an
unbound/copied replay receipt refused, and terminal receipts correlated to the
exact rollback ID, outbox ID, dedup key, operation, immutable intent snapshot,
and persisted Linear-result hash. The
GitHub job summary and retained artifact are the outside-n8n observer; no pager
timestamp or quiet-monitor inference is used.

Cloud review of the first candidate found that clearing an already-claimed
lease could race a stateless drainer, direct service-role UPDATE grants made
evidence rewritable, and a merely nonempty receipt correlation was not bound to
the replay. Head `69d85fb` refuses begin while any affected active
row has `lock_token` or `locked_at`, never clears those leases during capture,
exposes the ledgers read-only to service role while SECURITY DEFINER functions
own mutations, and binds terminal receipts to the exact immutable/persisted
intent and result. The proof above is the post-fix run and includes both
negative assertions.

## Boundary still open

This proof validates the additive SQL and the F63-style isolated transaction.
The same exact-head gate exercises the scoped real-writer request/result
contract without sending a network mutation. It does not authorize applying
the migration, deploying anything, changing
flags, or flipping authority. A cloud reviewer must verify the draft PR before
the candidate is called merge-ready. After review/merge, applying the migration
to the live project requires a separate owner-approved change window, captured
pre-state, exact migration/readback, and a TEST-client-only deployed drill.
