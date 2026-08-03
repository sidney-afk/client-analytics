# Graphics F2 evidence lane — source and isolated proof

**Date:** 2026-08-02

**Scope:** F98 pre-F2/post-F2 evidence only

**Live action performed:** none

## Boundary

This lane closes the evidence-tool gap between the documented F98 order and an owner-executable
Graphics F2 window. It does not authorize or perform F2, F1, an authority change, an n8n edit, a
Linear mutation, a database mutation, or a production deploy. The owner remains the only actor who
runs the F2 SQL between the two evidence modes. F133 is independent and no F133-modified file is in
this change.

## Packaged tool

`scripts/graphics-f2-evidence.js` owns four commands:

- `drainer-terminal` converts one already-occurring scheduled drainer execution into a bounded
  correlation artifact. The GitHub run identity becomes the correlation; the outbound HTTP request
  carries it as a header; the returned Supabase request ID, exact response-body hash, durable
  `linear_outbound_summary` event ID/hash, and GitHub artifact stay on the same chain.
- `linear-credential` performs the one typed Linear viewer read from the protected production
  Environment and binds its hashed accepted identity to the selected drainer/evidence run.
- `pre-f2` requires exact `linear/linear` authority and F2 `off`.
- `post-f2` requires exact `linear/linear` authority and F2 `live`, plus the byte hash of the passing
  pre receipt, the same operator binder, release SHA, and deployed function closure hashes.

Both evidence modes run the inventory in one PostgreSQL `REPEATABLE READ, READ ONLY` transaction.
The residue predicate is the complete set of real, non-parity outbox rows in
`pending|failed|shadow_ok`; it is not a limit, sample, age check, or estimate. A nonzero result emits
the exact count, a digest of the complete private inventory, and public-safe team/status/operation
counts, then fails for owner classification.

The protected manual workflow step exposes `LINEAR_MIRROR_API_KEY` only to the packaged
`linear-credential` command. That command executes one typed Linear viewer query and returns a
correlation-bound viewer-identity hash. The verifier then requires every counted written row in the
exact drainer interval to carry a typed provider mutation or idempotent provider-readback receipt
bound to that same viewer hash. Merely sending a request, terminalizing locally, or reporting a
success timestamp is insufficient.

The independent liveness observer is GitHub Actions. The verifier reads the selected run through the
GitHub Actions API and requires the exact workflow path, release SHA, run/attempt, `schedule` event, completed
state, successful conclusion, and matching terminal artifact. n8n is not an input to the verdict.
Post mode also reads the completed pre-evidence run through that API and requires an increasing run
identity plus the durable F2 `flag_flips` event in between the pre completion and post drainer start.
Current `live` state cannot make an older same-release drainer terminal pass.

## Isolation and rollback

The pull-request proof uses a disposable PostgreSQL 17 service and contains no production project
reference or credential. The production workflow is manual, main-only, confirmation-gated, and
requires a separately provisioned dedicated PostgreSQL role and protected Linear credentials. Direct
and pooled URLs are accepted only when they bind the production project; the login must not be an
owner/reserved role, and PostgreSQL must prove the role has every required `SELECT` plus one direct
all-rows `SELECT` RLS policy per evidence table, no direct role membership, no application table/sequence
write privilege, no application schema `CREATE`, and no elevated role attribute. Provisioning those
credentials/policies remains an owner precondition; the evidence workflow never creates them. The
existing scheduled drainer's artifact construction is non-blocking, while the original drainer
success gate remains binding. Evidence runs fail closed when either read credential or the selected
terminal artifact is unavailable.

Rollback is source-only: revert the workflow/tool commit. Removing it cannot change flags,
authority, outbox rows, Linear records, or n8n; it only makes the F2 evidence gate unavailable and
therefore red.

## Sabotage matrix

The hosted `Graphics F2 evidence` pull-request job uses PostgreSQL 17 and requires both clean modes
green, then proves at least these red outcomes:

| Sabotage | Required verdict |
|---|---|
| Insert real non-parity `pending`/`failed` residue for Video and Graphics | `FAIL`; exact count, inventory digest, and both bounded classifications retained |
| Break the dispatch/drainer correlation identity | `FAIL` with `drainer_correlation_broken` |
| Remove the typed Linear viewer credential receipt | `FAIL` with `credential_receipt_missing` |
| Remove the completed successful GitHub Actions observer | `FAIL` with `outside_observer_absent` |
| Select an older `live` drainer that does not follow the pre evidence run | `FAIL` with `post_drainer_not_after_pre_evidence` |
| Select a manual or repository-dispatched drainer run | `FAIL` with `drainer_not_scheduled` |
| Remove one dedicated-role all-rows RLS policy | `FAIL` with `postgres_role_not_read_only` |
| Add a non-inherited but settable writer-role membership | `FAIL` with `postgres_role_not_read_only` |

The proof also captures the clean database read surface twice and requires byte-stable output,
showing that the packaged verifier itself leaves no database mutation.
