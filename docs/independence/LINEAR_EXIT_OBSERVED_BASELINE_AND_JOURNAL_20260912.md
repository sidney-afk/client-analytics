# Observed starting schema and installation journal

This continues the seven-owner preparation checkpoint. The full build remains
incomplete. Nothing here authorizes installation, deployment, activation, merging,
production writes or n8n execution/edit.

Current result: exact observed public-schema reconstruction and the complete
35-source journal/bootstrap/maintenance/finalizer rehearsal pass in isolated PG17.
The full preparation build remains incomplete: private-ledger recovery and provider
reconciliation, external fencing, asset custody, notifications and WR-101 remain.
Earlier failed receipts below are retained as history; they are not replaced by
the later passing evidence.

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
The later full-schema reconstruction below covers the other captured objects.

Private nonroutine receipt `f5204381b62246b7b0816701e784d6ac` reproduced the
18 missing column fields (ordinal positions excluded), four views, seven indexes,
nine policies and four triggers. Functions, indexes, policies and user triggers
matched the observation. Full equality still refused rules, view permissions,
schema/table/sequence grants, column positions, default privileges, dependencies
and publication metadata. This selected-object proof is not full schema equality.
The complete observed-schema prototype and its raw captures remain private.

Later strict full-schema receipt `a2346217045e452c8e56b9260a570524` passed every
captured catalog group, including all 1,336 dependency records. PostgreSQL stopped.
The ACL parser now accepts digits only within its explicit observed role whitelist.
The last apparent difference was dependency ordering: exact multisets matched,
but the portable C locale sorted differently. Fresh read-only hosted metadata
reported ICU `en-US`; using that locale reproduced literal array equality without
changing the comparator. This proves the captured public schema, not full hosted
platform/role equivalence, business rows or sequence last-values. The private
reusable API is `observed-schema-api.private.cjs` (`applyObservedSchema(cluster)`).

Earlier private full-schema attempt `482c9706833f4b59823390184e3e4eb5` stopped with
a failure before final catalog comparison. It reached permission restoration after
creating tables at captured positions, 14 identities, the generated column,
routines, defaults, constraints, indexes, views, triggers, policies and table state.
Its ACL adapter accepts only `[a-z_]` role names and refused the captured
`graphics_f2_*` roles because their names contain a digit. This is an uncorrected
private adapter limitation, not a passed full-schema test. The server stopped.
That adapter gap is closed by the later passing receipt above. Do not infer role
membership or login privileges from the isolated dependency shells.

Private local continuation files under
`D:/Sidney/Codex/2026-09-12-fast-finish-evidence`:
`observed-schema-restore.private.cjs`, `observed-schema-portable.private.ps1`,
`live-full-catalog-20260912.private.json`,
`live-routine-definitions-20260912.private.json`,
`live-structural-definitions-20260912.private.json`, and
`live-sequence-ownership-20260912.private.json`. These are not GitHub attachments
and raw structural definitions have not passed publication review. The prototype
uses isolated external dependency shells; their equivalence to hosted roles,
Auth and Storage is explicitly unproved. No business data or sequence last-values
are covered by the schema observation.

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

The opt-in bootstrap wrapper now passed eight actual PG17 checks in receipt
`058bf00623af4850a18fb69784cc6689`: wrong identity/stage, partial schema refusal,
crashes before/after bootstrap COMMIT, wrong resumed plan, successful resume and
completed replay. The server stopped. Bootstrap and its empty progress record
commit together under the existing installer mutex; unknown partial schemas refuse.

The pending-plan builder verifies the full observed catalog and source inventory,
retains 32 historical setup owners and four preexisting owners, and compiles 28
candidate/new-or-upgrade owners plus seven admission owners. It removes only the
exact leading psql `ON_ERROR_STOP on` directive from generated atomic SQL; dedicated
query execution already stops on errors. Historical urgent-event backfill remains
separate reconciliation. Seven offline transport/refusal checks pass. This is not
an installation authorization. The later combined transition evidence is below.

Actual transition receipt `01e4079624964303905d3d4ba6bc13a5` verified the exact
starting catalog and the journal's `pg_catalog,public` search-path rendering, then
stopped after 15 committed chunks at the minimal external Storage scaffold's
missing bucket columns. The explicit isolated platform scaffold was supplemented.
Receipt `579ca7303bd54b568c7f7d941febe56b` then reached 22 chunks and refused the
CREATE-only Workload membership setup because its four routines already exist.
The reviewed plan now preserves that owner, including service-only grants, while
retaining the later label-state and roster correction owners. No migration body
was changed to hide the conflict. Both failed runs stopped; their journals were
not rebound to a changed plan. The revised 35-source plan SHA-256 is
`f0540602c9e36af93eb17b2614eb3117b963bcf169454ad1885088a1a3c48160`.

Subsequent worker execution completed all 42 chunks. Receipt
`cb3be8af3e5341338ab7e73c038787a6` remains failed because its final psql read exceeded
the harness output buffer. Its complete JSON output was recovered and parsed:
exact 90 table names, and all 22 admission functions matched raw body/definition
hashes and shared contract metadata. Full public-catalog SHA-256:
`43a623f388e57db6219415dbe968237791354f3a0dd433596a118f46ebb1a612`.
Independent journal-row readback and the full table/trigger preflight were not
captured in that run. This is bounded worker/catalog evidence, not a green overall
receipt. The combined maintenance/finalization rehearsal uses private file output
for large reads rather than weakening checks or replaying a changed journal plan.

`scripts/linear-exit-observed-schema.js` now packages the reconstruction body for
repository reuse, with explicit private input/output directories, a pinned
foundation prefix, certificate validation and empty-schema checks before any DDL.
Seven offline refusal controls pass with zero DDL. The packaged entry point has not
yet repeated the full private reconstruction proof; raw captures remain private.

This component is not the complete installer. The later combined rehearsal below
proves its tested public-schema integration and ordinary DML boundary. It makes no claim that sequence/external effects
roll back, that application writers have stopped, or that hosted installation ran.

## Fast remaining dependency order

### Installation maintenance component

The new opt-in maintenance wrapper passed 12 actual PG17 checks in
`e25dc9fa607b4010a3edadd6c5bafa0c`; the server stopped. It protects public ordinary
table DML and TRUNCATE using exact backend PID plus backend-start identity, not a
client-controlled setting or role name. Its initial transaction waits for earlier
DML before installing guards; new-table guards join each source chunk before its
COMMIT. Crashes retain the closed boundary. Resume verifies private owner/catalog,
original and derived plans, database identity, journal prefix and actual catalog
before rebinding the installer.

Combined full-plan receipt `ebd8adf3fc6d4a5cbb68f615d054be50` subsequently passed
with exit 0 and stopped PostgreSQL. It ran the 35-source plan through maintenance,
read back all 42 journal chunks with an exact source prefix, refused a second
connection's ordinary UPDATE statement, and finalized only after the expected
full catalog matched. All 90 maintenance guards were removed. Exact 90 table
names and the 22 admission function contracts matched; eight execution source
pins remained unchanged. `LINEAR_EXIT_OBSERVED_INSTALL_TARGET_V1.json` binds this
isolated result to its source plan, initial/final public digests and source pins.
This closes the observed-plan/maintenance/finalizer integration gap for the tested
public schema. It does not prove business-row migration behavior, the complete
table/trigger preflight, private-ledger backup, external platform configuration or
external-worker coverage. The separate provider-send release was not included.

The guarded execution plan records its actual initial catalog, including guards;
no catalog objects are normalized away. The component proof used a bounded
synthetic plan; the later combined receipt covers the full 35-source transition.
Non-installer DDL, direct sequence operations,
Auth, Storage and external effects still need their separate fence. Full
observed-plan integration is recorded above; the separate finalizer follows.

The subsequent separate finalizer passed nine actual PG17 checks in
`92e50095f3b14040a2fcc12d75c97dc8`; server stopped. It requires complete journal
prefix and exact private bindings, then removes only verified maintenance guards
inside one transaction. The resulting full public catalog must match the supplied
reviewed final hash before commit. Wrong hashes and pre-COMMIT crashes preserve
all guards. Post-COMMIT recovery requires the completed journal and exact bare
catalog. Repetition refuses a changed final hash. Authority and sender flags are
untouched. This closes finalizer component preparation; its later full-plan
integration is recorded above.

After the journal's optional before-commit guard hook was added, original journal
regression `ed81219c574a4ecfa67c0716d821ee65` passed all 17 actual checks and
bootstrap regression `512c9875b08c47f98bb0c143b48a20b5` passed eight. Both stopped.
An earlier wrapper receipt remained failed despite a passing journal test because
the lane-marker selector was wrong; it is retained and the runner was corrected.

### External provider send component

The separately prepared outbound composer leaves the default handler unchanged.
Its private send ledger passed 18 actual PG17 checks in
`a06bc172dc6b4334bbaa14ab772a2e0d`; the server stopped, with empty stderr.
SQL SHA-256: `a9e2783a504581a6005340fa98f727e36997dd7b2a28cb5631850bc592227e87`.
Admission binds epoch, outbox lock and exact mutation request before sending.
Unknown responses remain unresolved; duplicate attempts refuse. Completion checks
the provider result and exact terminal, unlocked outbox receipt. Unresolved sends
block both tracked drain and the existing seal transition. Review corrected an
earlier receipt-binding gap and moved completion after comment binding, create
linkage and normal final release; placement checks pass.

Generated-handler Deno checks remain red: the original and prepared handler have
the same 12 diagnostics, with no added errors. This is not a clean typecheck.
Replay/reconciliation recovery, completion under the full closed gate, private-ledger
backup inclusion and actual external-worker coverage remain unfinished. Existing
automation is neither changed nor proved fenced by this preparation.

### Remaining order

1. Extend recovery custody to the private journal, maintenance and provider-send
   ledgers. Preserve the already passing 90-table path and snapshot consistency;
   these private records are not covered by that inventory today.
2. Complete provider reconciliation/replay and local completion under the closed
   gate, then integrate its separate owner and revise the target/preflight evidence.
   Reconcile older accepted work without durable intents; new ledgers cannot prove
   historical coverage retrospectively.
3. Finish required-asset reference coverage, independent recovery/key custody,
   notification handover, WR-101 and final retirement preparation. Use the packaged
   observed-schema entry point on the next necessary full rehearsal, and complete
   the remaining table/trigger preflight and affected functional acceptance.
4. Publish the exact reviewed full preparation build and a new reviewer handoff.
   Keep fresh hosted data capture, configuration, custody, delivery and activation
   acceptance in their separately authorized installation window.

Verified native receipts stay retained. Zero Linear-bound work and unresolved debt
is required for shutdown; unknown or malformed records and unresolved failures
still block it. Current URLs and tokenless access remain protected.
