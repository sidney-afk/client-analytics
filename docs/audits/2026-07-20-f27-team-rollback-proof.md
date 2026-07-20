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

- Candidate head: `3e3f6fcaf2fe90be964e2eddb0ed183753d79743`
- GitHub Actions run (observer outside n8n): `29756163070`
- Artifact: `8466748210` (`f27-team-rollback-proof`)
- Artifact digest: `sha256:2a84c6ebe1ec02bc2079a9c74445fd9c8d449a33a6526fbee6b4182facd26e8e`
- Terminal transcript digest:
  `a46c000372082554e40b201d7b2ed0024b11a28063b6ed72c85f8f441ee61530`
- Rollback ID: `fa929dfa-63ce-4e51-89f2-d162b84f7334`
- Snapshot correlation ID: `0ff5d192-4ce2-4748-a975-a25a61427af3`
- Replay terminal correlation ID: `c065341c-f20c-48bf-a1e8-4995f1e50f31`
- Snapshot count: `4`
- Snapshot digest:
  `1411a5522ecfd2f568493079806259778c1a1afbf991a4a7642b388715b959c4`

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
refused, a held-team enqueue refused, and terminal receipts correlated. The
GitHub job summary and retained artifact are the outside-n8n observer; no pager
timestamp or quiet-monitor inference is used.

## Boundary still open

This proof validates the additive SQL and the F63-style isolated transaction.
It does not authorize applying the migration, deploying anything, changing
flags, or flipping authority. A cloud reviewer must verify the draft PR before
the candidate is called merge-ready. After review/merge, applying the migration
to the live project requires a separate owner-approved change window, captured
pre-state, exact migration/readback, and a TEST-client-only deployed drill.
