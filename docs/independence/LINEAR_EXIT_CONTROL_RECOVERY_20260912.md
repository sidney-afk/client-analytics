# Private control-record recovery

> Current exact-source refresh (2026-09-14): receipt `f80f2315c00c49468ea8b85918c43588` passed the full retirement-profile encrypted recovery: 94 tables, 32 selected public routines, all three required markers, exit 0, empty error log and server stopped. Current retirement JSON source pins match current tested disk, including the final operator runner lane and install-manifest. The earlier `fa971f36` refresh and `db8b0671` and lower receipts remain historical. Closed admission/maintenance and provider fence assertions remain unchanged; no hosted restore or activation occurred.

> Current exact-code retirement-profile refresh, 2026-09-13: PostgreSQL 17.11 receipt `db8b06715a7f41b4ab95ca2d366ff982` passed the 94-table encrypted local recovery with 32 public routine metadata checks, including explicit ACL owner 190840, and stopped its server. [Current machine-readable proof](LINEAR_EXIT_CONTROL_RETIREMENT_PROOF_20260913.json) binds the unchanged tested checkout and current source pins. Historical receipts below retain their original scope. This proves neither hosted recovery nor switch authorization.

The opt-in control companion now has an integrated isolated PG17 pass:
`c4b4eef93262422aa27b4235dbb9d11c`, exit zero, server stopped. Exact tested source
pins and bounded results are in `LINEAR_EXIT_CONTROL_RECOVERY_PROOF_20260912.json`.

The original two fixed profiles remain supported unchanged: `core` includes the installation journal,
maintenance gate and provider attempts; `core+diagnostics` also includes WR-101
receipts. Each authenticates its exact private schema/ACL/trigger-state contract
and required profile marker. Ordinary capture refuses to omit these namespaces,
including a check inside the exported snapshot. A core capture refuses an installed
diagnostics namespace. Unmarked legacy packages retain their old decoding behavior;
they do not acquire new coverage claims.

The public capture keeps its restricted read role. A separately supplied privileged
read connection imports the same exported snapshot for fixed private queries,
without changing private ACLs. Database identity and snapshot binding are checked;
credentials and raw rows remain private. Restore creates fixed private dependencies
before public definitions, verifies exact rows and ownership-relative ACLs, retains
the source journal identity, and clears maintenance PID/start authorization.
All 90 public table guards are enabled ALWAYS, including any source guard that was
disabled. The restored database cannot automatically resume installation or sends.

The integrated `core+diagnostics` test covers 94 tables through capture, encrypted
reopen and actual restore. It proves shared private snapshot behavior, omission and
wrong-database refusal, disabled private-trigger refusal, tampered/stripped package
refusal, late typed-value rollback, preserved source identity and actual closed-write
refusal. Independent review corrected omission and trigger-state gaps before this
pass. Earlier failed diagnostic runs remain retained, including the successful
capture with a failed boolean test adapter (`f49ef296677d4909af58703dbec80f77`) and
its exact-artifact restore-only pass (`d0bdf8a3b21742bd9061c2beeaac3828`).

Reproduce with portable PG17 lane `control-recovery`. The standalone restore-only
helper requires the private artifact and key inputs from its source capture; do
not assume those files exist on another machine. No private key is published.

The original receipt above includes provider owners through ACK receipt context
and WR-101. The later opt-in current-public mode passed on PG17 in receipt
`308a5b7e3b034abc96d4133bd3233e30`, exit zero, server stopped. Its exact tested
pins and retained assertions are in
`LINEAR_EXIT_CONTROL_CURRENT_PUBLIC_PROOF_20260913.json`. It adds the reviewed
comment, create, create-observation and recorded-create owners (45704, 51511,
54339 and 55621) without changing the fixed private profile. All 94 tables passed
encrypted capture/reopen/restore, and 15 selected routine records matched after
restore, including raw body hashes, signatures, configuration and role access.

This mode explicitly supplies the previously missing F203 linkage function from
the pinned private observed definition capture. It installs only that definition
and its exact observed ACL, not the historical migration or seed data. Its raw
body MD5 remains `cad02230ee9f1b4e963477586a39be3e`. The first attempt,
`8e5ee9ecdc4a493385d991130fdaf53d`, failed before capture because the lexer required
a statement terminator absent from `pg_get_functiondef`; the fixture now appends
that delimiter while preserving the captured bytes and strict hash validation.
The failed receipt remains retained.

Reproduce this extension with `-Lane control-recovery -CurrentPublicOwners` and
an explicit `-ObservedInputDirectory`, alongside the usual PG17 and output paths.
The required private input is `live-routine-definitions-20260912.private.json`,
SHA-256 `3728b7b676cfd7971515f03bb90f9204ac7e764a901804f8318571ea496ba6a7`.
Both ordinary control and current-public completion markers are required.

The exported source catalog is private, SHA-256
`64538589c363bedcc175e2bf49a4a81fecf1b9fb60fc6affcc7fd23e8c9e6d2c`.
It describes the synthetic source composition with observed F203, **not** an
observed full-installation target. This remains a pre-activation recovery proof:
that receipt excludes the retirement-switch and provider terminal-history owners. A changed private trigger contract requires a separately reviewed
profile update; this pass must not silently acquire that coverage.

It does not prove hosted installation, fresh source provenance, external-worker
fencing, key retrieval from an independent location, off-device custody, or safe
activation of the restored system. Those limits remain explicit.

The separate `core+diagnostics+retirement` profile passed the supported PG17
recovery lane in final receipt `b353532767364586a6a6f997c8eb3bbc`, exit zero, server
stopped. `LINEAR_EXIT_CONTROL_RETIREMENT_PROOF_20260913.json` records exact pins.
It installs terminal-history 62741, comment observation 181213, issue observation 183021, then retirement
switch 62149 after the prior current-public owners. All 94 tables passed encrypted
reopening and actual restore; 32 selected public routine records matched exactly.
Earlier receipt `cfbf66455be44f98ad49e42fce2a4cb0` remains historical evidence for
29 routines before issue observation; its owner pins and artifact digest remain in the manifest.
The new private schema contract is separately pinned at `a26fb62cd7cf332aa1db56c164bd6da2d4f3ad4510a01457fa1bcc351a9af803`.
Its difference from the diagnostics contract is exactly the private retirement
fence function and its ALWAYS trigger. Existing profile contracts stay unchanged.

Restore first creates the original private dependencies, then public predata and
archival rows. Only afterward does it install the four fixed retirement fence
statements. The new function uses the established CR-preserving transport, so raw
body hash `575f10ca7b9865005d9666393628c395` remains exact. Initial metadata receipt
`960033b347784e8bb5d623e392277ae3` exposed Windows stdin CR removal. Although that
command exited zero, it is not accepted as source-exact evidence. It is superseded
by source-exact metadata receipt
`6093bcfb72424964a1606e0e13938fa5`. That calibration used only the pinned source
admission CREATE TABLE as a type prerequisite, without application seed data.

The new profile deliberately restores the admission singleton with `mode=closed`.
Authenticated source bytes remain unchanged; the render-only row view preserves
epoch, history, timestamps, reason and every other field. COPY and exact multiset
verification both use this declared view. It also preserves the source journal
identity and clears maintenance PID/start authorization. All 90 public maintenance
guards and the private retirement fence are enabled ALWAYS.

The source test uses an explicitly privileged synthetic retired/open state through
the real context/preimage guards. It retains 16 outbox rows, one unresolved provider
attempt and one unresolved followup. This tests restoration under a demanding state;
it does not claim successful activation with unresolved work. The target restored
admission closed, refused ordinary writes and rejected a provider-attempt INSERT
through its retirement fence. Disabled private-fence capture refusal, signed typed
row rollback, tampered and stripped package refusal, shared snapshot binding and
encrypted reopening remain enforced. Offline phase/quarantine checks cover open,
closed, sealed and malformed/multirow inputs; they are separate from SQL evidence.

Reproduce with `-Lane control-recovery -CurrentPublicOwners -RetirementProfile`,
the same explicit observed input directory, and supplied portable PG17/output paths.
All three control, current-public and retirement completion markers are required.
The final issue-observation owner is included. This profile proof does
not replace the independent actual-switch proof or authorize a restored system.

Final receipt source pins matched every tested working-tree byte. At review, the
index still contained the older companion, retirement helper and switch owner;
those are pending source changes, not line-ending-only differences. Every other
recorded source pin matched raw index bytes. No staging was performed by this review.

A subsequent ACL-only owner, `20260913190840_provider_terminal_private_acl_preparation.sql`
(SHA `439db3390b299b519af1a110bb0678ee8680d4b88be5c5ceb96faf1aae108942`),
is now included after 62741 in the recovery fixture. It revokes service EXECUTE
from two helpers whose captured and restored privileges were already false.
This source-only fixture change was not executed in receipt `b353532767364586a6a6f997c8eb3bbc`;
the receipt pins remain historical exact bytes. The owner is needed when composing
against observed default ACLs and requires the separate installation proof.
