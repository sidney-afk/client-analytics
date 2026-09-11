# Sequence allocation safety for recovery preparation

Status: proposed acceptance contract; not implemented for the complete recovery
inventory. Installation remains HOLD.

A blanket pause of ordinary ID allocation is not necessarily required for a
snapshot backup. A captured sequence position may safely exceed the IDs present
in that snapshot: caching reserves values ahead of use. This is an inference
from PostgreSQL's documented behavior, not proof for every SyncView sequence.
[PostgreSQL CREATE SEQUENCE](https://www.postgresql.org/docs/17/sql-createsequence.html)

The bounded target property is: the next generated ID cannot collide with any
restored snapshot row. For a positive, noncycling sequence with unchanged
configuration, compute next = last_value + increment when is_called is true,
otherwise next = last_value. Use integer arithmetic, require next within the
sequence range, and require next greater than the maximum restored ID across
EVERY consuming column. Include shared sequences and explicitly assigned IDs.
The target must use fresh sessions and exclude concurrent writes or resets.
An empty table does not prove absence of another consumer.

Sequence allocation and resets are not rolled back with row transactions.
Backward resets, restarts, cycling, descending sequences and unknown consumers
need separate treatment. A row snapshot alone does not prove sequence safety.
[PostgreSQL sequence functions](https://www.postgresql.org/docs/17/functions-sequence.html)

Current capture reads sequence state after opening its exported snapshot and
restoration verifies the captured state. It does not yet bind complete consuming
column mappings or snapshot extrema. Cycle/cache settings occur in the schema
fingerprint, but the state record alone does not carry them. Do not turn the
proposed formula into an unqualified readiness flag.

Next implementation requirements:

- Classify all captured sequences and bind their definitions and consumers.
- Capture consumer extrema through the existing exported snapshot.
- Authenticate the definitions/mappings/extrema together with the package.
- Refuse unsupported definitions, unknown consumers and unsafe bounds.
- Recheck the bound before restored business writes and exercise reset/manual-ID
  counterexamples without weakening existing exact sequence-state verification.

Snapshot-relative noncollision does not protect against IDs or business writes
created on the old source after capture. Final cutover needs a separate reviewed
write/delta boundary. This document neither pauses writers nor authorizes that
operation. Source maintenance, hosted restoration and Linear retirement remain
future explicitly authorized actions.

## Application sequence catalog probe

PG17 sequence-application passed for15 catalog-mapped public sequences in receipt
`linear-exit-sequence-application-d5e42b1b78864e13b98c410e4ae1f402`, exit0 and
server stopped. All had positive increment1, no cycling and cache1. The next
allocation was within sequence range and above each known integer consumer's
maximum. Thirteen consumer tables were empty; only flag_flips and
production_card_provenance had rows. This is a mostly-empty local catalog/bound
probe, not authenticated populated-snapshot verification or consumer closure.
Separate catalog/state/max reads do not prove concurrent-capture consistency.
The report LINEAR_EXIT_SEQUENCE_APPLICATION_20260911.json preserves those limits.

A bounded review of inventoried owners, atomic inputs and supplements found no
executable direct nextval/setval/restart/currval/lastval call. That does not prove
absence of external/manual or future calls. Native identifiers are a separate
allocator: production_native_identifier_allocate updates the transactional
production_native_identifier_mint.next_ordinal cursor and checks deliverables
and grants (2026-09-07-native-identifier-mint.sql). Random review tokens,
UUID defaults and epoch/base36 thumbnail tokens are also outside sequence bounds.

Next: bind complete supported sequence/consumer definitions and snapshot extrema
into capture validation, with populated counterexamples. Keep native identifier
cursor/cutover coordination separate. No runtime format or hosted writer change;
installation stays HOLD. No merge/deployment/production/n8n write occurred.
