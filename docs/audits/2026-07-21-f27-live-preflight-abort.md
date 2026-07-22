# F27 live installation — preflight abort evidence

**Status:** **ABORTED BEFORE DDL, DML, OR EDGE FUNCTION DEPLOYMENT.** F27 is
not installed live. This record is intentionally public-safe: it contains no
client names, row bodies, issue identifiers, credentials, or secrets.

**Decision:** do not apply or deploy PR #894 from its merged source. The exact
merged source conflicts with the requested live procedure and retains two P1
review findings. A corrective source PR and a reconciled drill contract are
required before another installation attempt. This session is not FINAL.

## Exact source and live target

| Item | Readback |
|---|---|
| Live Supabase project | `uzltbbrjidmjwwfakwve` (`ACTIVE_HEALTHY`) |
| Current `main` | `3d8bbfb30ed5e2d8e34acb166747588e1c45f60c` |
| PR #894 head | `3d539ed52580a5f69e75e25e4441337c2fdcab00` |
| PR #894 merge | `c51f897a3e28d111f29a235d60b7d8b0efeb902b` |
| F27 path drift after merge | none; the migration and both affected function closures are unchanged |
| Migration SHA-256 | `fbd8ff7ab84537d18f8a0d17a453f55c15aa087d8d1108ba206c14fcdf8f5e9f` |
| Expected `linear-outbound` closure | `b9f1a3d67fac6f40bc764d7dd6b07a6e83166e962811b682858f0989c8b83295` (4 files) |
| Expected `linear-inbound` closure | `f6e674c33b7bc9aca502bf2d52da05df8fb438a8afeb330efd9840c798caf23e` (3 files) |

## Content-addressed `mirror_outbox` baseline

The full table was captured through one repeatable-read, read-only transaction
at `2026-07-22T00:31:15.033538Z`. The private file contains all 480 rows,
the ten newest full rows, every check definition, the user-trigger set, the
runtime safety flags, and F27-object absence. The compact JSON file was created
with exclusive-write semantics, marked read-only, and independently re-hashed.
The published digest makes later alteration detectable; the local read-only
attribute is not represented as WORM storage. The file is not committed because
it contains live row bodies.

- Full snapshot SHA-256:
  `dd95a9d9693a85e7b7c5071e8db43021708e3990124410aeceb749e468a74edc`
- Declared rows: `480`
- Materialized rows: `480`
- Newest row timestamp: `2026-07-21T06:45:16.382512Z`
- User-defined triggers: `0`
- F27 rollback and intent tables: absent
- F27 hold function and all four F27 RPCs: absent

### Newest-row proof without row disclosure

These are SHA-256 digests of the canonical private row objects. They prove which
newest rows were included without publishing any row value.

| Created at (UTC) | Row SHA-256 |
|---|---|
| `2026-07-21T06:45:16.382512Z` | `27ad130ebbeb7c18be0b74f8329435d1446c874ad83d0600b836409f60cb1f68` |
| `2026-07-21T06:45:15.047552Z` | `5491abfe867739b477288e6dda08c663db58b279476200821dbdeeada1708768` |
| `2026-07-21T06:45:04.932137Z` | `24d6866725ad8c409f8857de246546401936d43cbf171b645b75da3feea75265` |
| `2026-07-21T06:45:03.291989Z` | `8e39e796a0367832dcf9a618ba0c2328f407cb7e8bd336c4b570cef453f34df8` |
| `2026-07-21T06:44:24.593630Z` | `e2f52d2bd3e3bc2638401fc2ee1d45a8c3a095b4e288bece0968a54933268c06` |
| `2026-07-21T06:44:22.530344Z` | `4081ced5a1f5cf334887077280efc62b20bd1c8e45d593d6904d9db1d89f3c94` |
| `2026-07-21T06:44:18.838966Z` | `dd1ee83a043f8db6d5fcc0ac0a148a12da42ac59a3ad722539d053a698565cea` |
| `2026-07-21T06:44:15.312553Z` | `e23afc59f6df9eb6ff12c1a946d27437358383e21dc2c38083c0bf4b20dbc433` |
| `2026-07-21T06:44:12.178983Z` | `70a3ff98bb66c467b909cf386be1e65e887f205a04e7f8b74245f96bb0342b39` |
| `2026-07-21T06:44:08.497540Z` | `c5d3df55ce89741437b84bda24bdf82c0f0d04521481df1ba0f206dc49ce40cf` |

### Live check and trigger definitions

The live table has these five validated check constraints:

```text
mirror_outbox_entity_b4_check
CHECK (entity = ANY (ARRAY['deliverable'::text, 'batch'::text, 'comment'::text]))

mirror_outbox_legacy_parity_operation_check
CHECK (legacy_parity = false OR (operation = ANY (ARRAY['create'::text, 'status'::text, 'comment'::text])))

mirror_outbox_op_check
CHECK (op = ANY (ARRAY['create'::text, 'update_state'::text, 'update_fields'::text, 'comment'::text, 'archive'::text]))

mirror_outbox_operation_b4_check
CHECK (operation = ANY (ARRAY['create'::text, 'status'::text, 'comment'::text, 'due'::text, 'assignee'::text, 'title'::text, 'priority'::text, 'parent'::text, 'archive'::text, 'restore'::text]))

mirror_outbox_status_b4_check
CHECK (status = ANY (ARRAY['pending'::text, 'shadow_ok'::text, 'written'::text, 'failed'::text, 'skipped'::text, 'stale'::text]))
```

There are no user-defined triggers to restore. The only four catalog triggers
are PostgreSQL's internal referential-integrity triggers for the existing
`depends_on_id -> id` self-reference.

This baseline is an evidence anchor for this aborted attempt, not permission to
use it later: `mirror_outbox` is a live queue and must be freshly re-snapshotted
immediately before any future DDL.

## Pre-deploy function baseline and rollback anchors

| Function | Live version | `verify_jwt` | Live bundle SHA-256 |
|---|---:|---|---|
| `linear-outbound` | 33 | false | `14645be4efa3ee7c8b31aeb0124715c75f77cfe75d68d860c645c12601b258b9` |
| `linear-inbound` | 39 | false | `531782b4a9f3f986a683f0e3562a61709a526d593376c4dcfb572f435e74a4bf` |
| `calendar-upsert` (frozen) | 43 | false | `91ce449e8fd19b451f218572a0f42db385c64841b1f4b4b14ff27b76839a425f` |
| `sample-review-upsert` (frozen) | 44 | false | `50b63fbadcdf03d3de0fc04131dd9258f50aabd1631e59bcb6f57554e0b918fb` |

The active v33/v39 source closures were downloaded read-only to a private
rollback anchor. Their source-manifest SHA-256 values are:

- `linear-outbound`: `ddb2a8c6a2ed4e53d7900411396eb5703ca3ed305a7f400ceeebdf5e6a61d32b`
- `linear-inbound`: `a1aa3ed18c1e2cd21adcf1fe5720caff452dc865f45f770181c35d262d6046f2`

Supabase CLI 2.109.0 cannot activate a historical function by version number.
The version IDs are evidence; an exact rollback requires redeploying the saved
source closures, which creates new version IDs, followed by source-fingerprint
and behavior readback. The two function deployments cannot be one atomic
operation.

## Why the live apply stopped

### 1. The requested DDL is not the merged migration

The request describes dropping and recreating a `mirror_outbox` check and
trigger. That matched an earlier PR revision, but commit `60d0972d9b43` removed
the drops to satisfy the repository's additive-only migration rule. The merged
migration creates two F27 tables, one partial unique index, one new trigger and
trigger function, and four RPCs. It contains no `DROP`, no replacement check,
and no replacement trigger. Applying the older DDL would not be applying exact
merged source.

### 2. The requested TEST drill cannot satisfy the hard invariants

- `track_b_team_rollbacks.team` accepts only `video` or `graphics`.
- The rollback and intent tables have no client or `test_only` scope.
- `track_b_f27_begin` snapshots and holds every active row for the selected
  real team across clients.
- `track_b_f27_begin` requires that team already be SyncView-authoritative.
  It correctly refuses while live authority is Linear/Linear.
- `f27Replay` explicitly rejects `test_override` and requires an open rollback,
  an exactly classified team intent, F2 off, F4 false, and SyncView authority.
- `track_b_f27_finalize` requires F2 off; it does not refuse because F2 is off.
  Its guarded action is to change the selected team from SyncView to Linear.
- Completed rollback and intent rows are durable audit evidence. The child FK
  does not cascade, service role has read-only table grants, and no cleanup RPC
  exists. Deleting a supposed TEST row would require privileged deletion of the
  evidence the design promises to retain.

Therefore the requested client-scoped synthetic drill, expected off-state CAS
refusal, and deletion cleanup describe a different contract from #894.

### 3. Two P1 source findings remain live-blocking

- [Unresolved, non-outdated inline P1: keep the team hold active across the
  authority handoff](https://github.com/sidney-afk/client-analytics/pull/894#discussion_r3616338737).
  A pre-authorized writer can wait behind finalization and enqueue after the
  rollback is marked complete and authority has returned to Linear.
- [Post-merge P1: treat bound F27 preflights as acknowledged
  echoes](https://github.com/sidney-afk/client-analytics/pull/894#pullrequestreview-4738266557).
  A webhook racing the replay checkpoint can still be processed as a foreign
  inbound write; a comment echo can be duplicated.

The final-head CI proof is green but does not close either race. The exact
merged source must not be installed merely because its source-only proof passed.

### 4. The normal paths are not literally behavior-identical

Besides the gated replay path, #894 makes normal-path hardening changes: outbound
checkpoint writes now require one-row CAS readback, TEST scoping covers every
`test_only` row, and inbound echo lookup considers rollback-bound `skipped`
rows. These changes may be desirable, but an evidence PR cannot truthfully call
the normal paths byte- or behavior-identical without a deployed regression
proof.

## Hard-invariant readback

A second live readback at `2026-07-22T00:51:10.877740Z` returned the same
480-row count, the same newest-row timestamp, the same flags, absent F27
objects/RPCs, and the same four function versions/bundle hashes.

| Invariant | Result |
|---|---|
| `prod_authority` remains `{video:linear, graphics:linear}` | **HELD** — exact live readback; untouched |
| `linear_outbound_enabled` remains `{mode:off}` | **HELD** — exact live readback; untouched |
| `f27Replay` remains rollback-row-gated and no real team/client rollback row remains | **HELD BY NON-INSTALLATION** — merged-source `f27Replay` requires an open `track_b_team_rollbacks` row, but neither that function source nor the F27 schema was deployed; live outbound remains v33, and no TEST row was created or deleted because the drill was aborted |
| Frozen writers are not redeployed and remain byte-identical | **HELD** — no deploy occurred; v43/v44 bundle hashes unchanged |
| No client data is mutated; TEST-only boundary | **HELD** — the incompatible drill was not started; all live operations were read-only |

`linear_legacy_parity_enabled` also remained `{"enabled":false}`. No n8n
workflow, Linear record, runtime flag, database object, queue row, client row,
or Edge Function changed.

## Rollback for this attempt

No rollback command is required because no DDL, DML, function deploy, authority
change, or client mutation occurred. Live remains on `linear-outbound` v33 and
`linear-inbound` v39; the frozen writers remain v43/v44.

The requested future one-shot recipe is intentionally not published as
executable because it is incomplete for merged #894. The actual migration adds
two tables, one trigger and trigger function, four RPCs, and an index; its audit
rows are designed to be preserved. A corrective PR must define a separately
reviewed, additive retirement/recovery migration and bind function recovery to
the private v33/v39 source manifests above. Restoring a nonexistent old user
trigger or activating a version number directly would be false recovery.

## Required next gate

1. Correct both P1s in source and obtain clean exact-head cloud review.
2. Decide and encode whether the live drill is genuinely team-wide or introduce
   an explicit server-enforced TEST/client scope; do not emulate scope in an
   operator query.
3. Reconcile the off-state CAS expectation and durable-evidence cleanup rule
   with the implemented contract.
4. Publish and review the exact migration wrapper, enqueue savepoint proof,
   complete object recovery plan, and two-function source-anchor rollback.
5. Start a new live attempt from a fresh `main`, repeat the full queue snapshot,
   record its hash in the evidence PR, and only then consider DDL.
