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
It exhausts the bounded scheduled-run history for the exact release across the pre boundary, expands
every rerun from attempt 1 through the current attempt, and requires the selected post run/attempt to
be the first one started after F2, including a queued run created before F2. Post mode also inventories
every written row from the durable F2 flip through the selected terminal, so an older or cross-release
rerun omitted from the release inventory still cannot hide a normal write. A later success or
successful rerun cannot hide an earlier failure, attempt, or write. Current `live` state cannot make
an older same-release drainer terminal pass. The snapshot is anchored to the first qualifying
`off→live` transition after the bound pre receipt and requires it to be the only transition in the
window; a later toggle cannot erase the earlier interval.

## Isolation and rollback

The pull-request proof uses a disposable PostgreSQL 17 service and contains no production project
reference or credential. The production workflow is manual, main-only, confirmation-gated, and
requires a separately provisioned dedicated PostgreSQL role and protected Linear credentials. Direct
and pooled URLs are accepted only when they bind the production project; the login must not be an
owner/reserved role, and PostgreSQL must prove the role has exactly the four required effective/direct
`SELECT` privileges plus one singleton role-targeted all-rows `SELECT` RLS policy per evidence table,
no direct role membership, no application table, sequence, PostgreSQL `MAINTAIN`, or column-level
write privilege, and no directly granted application routine `EXECUTE`. Effective application
routine access derived solely from `PUBLIC` is recorded in the receipt and accepted only for
security-invoker routines. Every `PUBLIC`-executable `SECURITY DEFINER` routine is fatal, including
a trigger function: an unprivileged caller can attach an otherwise non-invocable trigger function
to a caller-owned temporary table while the default `PUBLIC EXECUTE` grant is present. Accessible
application aggregates are also traced through every transition/final/combine/serialization support
function; a `SECURITY DEFINER` support function is fatal even when direct `EXECUTE` on that support
function was revoked, because the aggregate remains an invocation path. Accessible range
range types are likewise traced to their canonical support function: PostgreSQL 17 proves that range
input still invokes a `SECURITY DEFINER` canonical function after direct `EXECUTE` is revoked on
both the canonical function and the generated constructors. The role must also have no
application operator whose `SECURITY DEFINER` implementation remains executable; PostgreSQL 17
proves operator syntax is refused when direct `EXECUTE` on the implementation is revoked. Cast
and domain-constraint coercion are refused at the same boundary. The role must also have no application schema `CREATE`, no
database ownership or database-level `CREATE`,
no reserved `pg_*` identity, and no elevated role attribute. Provisioning those
credentials/policies remains an owner precondition; the evidence workflow never creates them. The
existing scheduled drainer's artifact construction is non-blocking, while the original drainer
success gate remains binding. Evidence runs fail closed when either read credential or the selected
terminal artifact is unavailable.

Tool rollback is source-only: revert the workflow/tool commit. The separate owner-only inverse for
the one production ACL revoke is definition-hash and trigger-binding-hash gated before and after the
re-grant; any function or trigger drift blocks it. Restoring that pre-existing exposure makes the F2
evidence gate red and is not an F2 action.

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
| Grant `SELECT` on a fifth `public` application relation | `FAIL` with `postgres_role_not_read_only` |
| Replace a direct evidence-role RLS policy with `TO PUBLIC` | `FAIL` with `postgres_role_not_read_only` |
| Select a later success after an earlier scheduled post-F2 failure | `FAIL` with `post_drainer_not_first_scheduled_after_f2` |
| Select a successful rerun after an earlier attempt of the same scheduled run | `FAIL` with `post_drainer_not_first_scheduled_after_f2` |
| Insert a normal written row after F2 but before the selected terminal | `FAIL` with `normal_lane_write_present` |
| Toggle outbound after F2 and attempt to re-anchor on a later `off→live` | `FAIL` with `f2_transition_ambiguous` |
| Grant database-level `CREATE` to the evidence role | `FAIL` with `postgres_role_not_read_only` |
| Target an all-rows policy to the evidence role plus another role | `FAIL` with `postgres_role_not_read_only` |
| Grant column-level `UPDATE` to the evidence role | `FAIL` with `postgres_role_not_read_only` |
| Grant PostgreSQL 17 `MAINTAIN` to the evidence role | `FAIL` with `postgres_role_not_read_only` |
| Grant PostgreSQL 17 `MAINTAIN` on an application materialized view | `FAIL` with `postgres_role_not_read_only` |
| Grant `SELECT` on an application sequence | `FAIL` with `postgres_role_not_read_only` |
| Use a login-enabled predefined `pg_*` role | `FAIL` with `database_target_invalid` before connection |
| Grant application function `EXECUTE` directly to the evidence role | `FAIL` with `postgres_role_not_read_only` |
| Leave a non-trigger application `SECURITY DEFINER` function executable by `PUBLIC` | `FAIL` with `postgres_role_not_read_only` |
| Leave an application `SECURITY DEFINER` window function executable by `PUBLIC` | `FAIL` with `postgres_role_not_read_only` |
| Leave a `PUBLIC`-executable aggregate backed by a revoked-direct `SECURITY DEFINER` support function | `FAIL` with `postgres_role_not_read_only` |
| Use an accessible range backed by a revoked-direct `SECURITY DEFINER` canonical function after revoking both generated constructors | PostgreSQL range input still invokes the canonical function; `FAIL` with `postgres_role_not_read_only` |
| Invoke an operator backed by a revoked-direct `SECURITY DEFINER` function | PostgreSQL refuses the operator with `permission denied`; the receipt remains `PASS` |
| Invoke a cast backed by a revoked-direct `SECURITY DEFINER` function | PostgreSQL refuses the cast with `permission denied`; the receipt remains `PASS` |
| Coerce through a domain constraint backed by a revoked-direct `SECURITY DEFINER` function | PostgreSQL refuses the coercion with `permission denied`; the receipt remains `PASS` |
| Restore `PUBLIC EXECUTE` on `track_b_enqueue_outbound_intent()` | `FAIL` with `postgres_role_not_read_only` |
| Fire the existing `deliverable_events` trigger after revoking its function's `PUBLIC EXECUTE` | `PASS`; the existing binding remains enabled and executes as its owner |

This correction is the third portability mismatch in this lane caused by applying plain PostgreSQL
assumptions to Supabase defaults, after PostgreSQL 17 `MAINTAIN` and the hold-guard ACL. Supabase's
default `PUBLIC` routine grants cannot be revoked per role, so the evidence gate inventories and
classifies their provenance instead of silently treating them as direct role grants. The earlier
return-type exemption was wrong: `track_b_enqueue_outbound_intent()` was a pre-existing global
`PUBLIC` attachment path surfaced by provisioning and checking the new read-only role; the role did
not introduce the exposure. The narrow correction revokes `PUBLIC EXECUTE` on that exact function
only. The checker now fails closed on every `PUBLIC`-executable `SECURITY DEFINER` routine, every
accessible application aggregate backed by a `SECURITY DEFINER` support function, and every
accessible range type backed by a `SECURITY DEFINER` canonical function, plus all
per-role grants, memberships, write/sequence/`CREATE` privileges, and elevated attributes. The
owner-gated runbook action emits a bounded inventory of any other matching `public` routines for owner review and
does not alter them.

The production preflight on 2026-08-03 used Supabase's dedicated read-only SQL endpoint and proved
`transaction_read_only=on`. It found one enabled exact
`deliverable_events.track_b_outbound_intent_after` binding and exactly one `public` routine that was
both `SECURITY DEFINER` and executable by `PUBLIC`:
`public.track_b_enqueue_outbound_intent()`. No other routine matched the sweep. This was an
observation only; the reviewed runbook action remains the sole authorized ACL mutation. Keeping the
one-time SQL in the existing F2 runbook also preserves the owner's zero-file-overlap boundary with
F133; no new migration inventory entry is required.

The proof also captures the clean database read surface twice and requires byte-stable output,
showing that the packaged verifier itself leaves no database mutation.
