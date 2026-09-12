# Observed starting schema and installation journal

This continues the seven-owner preparation checkpoint. The full build remains
incomplete. Nothing here authorizes installation, deployment, activation, merging,
production writes or n8n execution/edit.

## Exact read-only starting observation

A fresh read-only PG17 catalog query observed 67 public tables, 115 functions,
177 indexes, 31 policies, 28 user triggers and five views. The public certificate
contains section counts and SHA-256 digests, not function bodies or application
rows. Its exact full-catalog digest is
`809c5dc72a629d1c240631ca34e1050ac3ad559091b8c0127b8d5fab8cbf7edd`.
The certificate artifact SHA-256 is
`824a39b43491fef2d9289c9bcdc1f3665e26ad8fca992e76b1a9f77ecaa872d5`.

`linear-exit-observed-public-catalog.js` pins the certificate and catalog-query
bytes, and compares every captured section. Thirteen offline checks include
raw function-body changes, permission changes, missing/extra columns or sections,
wrong project context, query drift and artifact drift. The observed live snapshot
matches; the earlier PRE67 reconstruction refuses in 12 catalog sections.
Caller-supplied project context does not authenticate a connection. Matching this
public-catalog observation does not prove external platform configuration or
source-rehearsal equivalence and does not authorize installation.

The difference is now mapped rather than inferred from counts:

- 29 live routines were missing from the earlier PRE67 reconstruction.
- 13 shared bodies differed after CR normalization; 22 others differed in raw bytes.
- Source mapping found 65 raw body matches, 31 CR-normalized matches, nine differing
  named routines and ten B3 routines without a located historical source.
- Nonroutine mapping found 18 missing Calendar/Samples columns, four missing views,
  seven indexes, nine policies and four user triggers. Some policy sources belong
  to operational F2 evidence roles, not application installation owners.
- Other differences include grants, default privileges, column positions and
  dependent attribute numbers. They remain visible; no equality assertion was
  weakened or replaced with a table-count check.

## Observed routine reconstruction

The exact captured definitions provide explicit LIVE_READ observed source for a
rehearsal baseline. They are not guesses about historical migrations and must not
be applied after candidate owners or replayed by the installer. Sixty-four selected
CREATE OR REPLACE definitions cover the missing/differing raw bodies. Existing
function transport preserves CR bytes without normalization. Ownership and ACL
reconstruction accepts only the observed postgres ownership/grantor, five known
roles and EXECUTE grants without grant options; unknown forms refuse.

Private PG17 receipt `cfc7b5627fc6436d81e5c15043965434` matched all 115 complete
function catalog records, including raw bodies, attributes, ownership, exact ACL
strings and effective permissions. No business routine was invoked. The database
stopped. Earlier receipt `9620b92cc3e44e1f892f4746b9edd885` proved all 64 bodies and
metadata but only 23 of their permissions; that intermediate mismatch is retained.
Final portable PG17 receipt `dcefdf56972e4350968021c76dba4137` repeated the
115/115 exact-record result and stopped the server. Independent review requested
an exact contract-byte pin before parsing; that is now added, along with a
loopback-host check before queries. Offline tampered-contract and
wrong-host/zero-query controls pass.
SQL SHA-256: `79f1903193f684c0ac3e0560f07ad3bd371f6a87c1d07443280ee5f9a74b7bde`.
Contract SHA-256: `1406d4c0e068aedf1824f09a30b1221f9a29f65ee781544a2b23362a8cf58bb8`.
Other schema objects are a separate remaining reconstruction requirement.

Private nonroutine receipt `f5204381b62246b7b0816701e784d6ac` reproduced the
18 missing column fields (ordinal positions excluded), four views, seven indexes,
nine policies and four triggers. Functions, indexes, policies and user triggers
matched the observation. Full equality still refused rules, view permissions,
schema/table/sequence grants, column positions, default privileges, dependencies
and publication metadata. This selected-object proof is not full schema equality.
The complete observed-schema prototype and its raw captures remain private.

Raw captures stay private until their particular publication review passes.
The selected routine definitions passed credential-pattern and 49-name fresh
roster scans with zero matches. Those scans do not authorize unrelated captures.

## Durable transaction-chunk journal

The new isolated component uses a dedicated connection and a session advisory
mutex. It binds the database identity, reviewed plan, initial stage, source order
and chunk hashes. Each progress record commits in the same transaction as its
source chunk. A crash after COMMIT can therefore resume without replaying a
row-only change even when the public catalog hash did not change.

Before any source effect, the component validates the private journal owner and
exact structure, permissions, triggers and inheritance state. Wrong identity,
plan, stage, source prefix, current catalog or concurrent installer refuses.
Original explicit transactions and supported savepoints retain their boundaries;
unsupported transaction/session controls refuse.

- SQL owner: `20260912203454_installation_transaction_journal_preparation.sql`.
- SHA-256: `9ecca800529af9b153d83b488f3b05a5e7ac5e1a53fb93483f3d0d1f4cd6c406`.
- Final PG17 receipt: `65bd344cb2b64f1a94394cc8e9d0a8e6`.
- Seventeen actual checks and thirteen offline checks passed; server stopped.
- Tests kill real child processes before and after commit, verify row-only
  exactly-once chunk application, and resume the actual Workload function owner
  between its function replacement and remaining ACL statements.

This component is not the complete installer. Its private journal bootstrap,
reviewed pending-owner plan, source-stage integration and application-write
exclusion still need integration. It makes no claim that sequence/external effects
roll back, that application writers have stopped, or that hosted installation ran.

## Fast remaining dependency order

1. Complete observed baseline reconstruction and classify each candidate owner's
   current presence or supported upgrade. Table absence alone cannot classify a
   migration. Keep preexisting owners explicit; never replay the full baseline.
2. Connect that reviewed pending-owner plan to journal bootstrap and crash recovery,
   with a proved accepted-write boundary. Run one consolidated affected acceptance
   pass after these inputs stabilize.
3. Finish external writer fencing/replay, required-asset reference coverage,
   independent recovery/key custody interfaces, notification handover and final
   retirement activation preparation. Implement the separate WR-101 release.
4. Publish the exact reviewed full preparation build and a new reviewer handoff.
   Keep fresh hosted data capture, configuration, custody, delivery and activation
   acceptance in their separately authorized installation window.

Verified native receipts stay retained. Zero Linear-bound work and unresolved debt
is required for shutdown; unknown or malformed records and unresolved failures
still block it. Current URLs and tokenless access remain protected.
