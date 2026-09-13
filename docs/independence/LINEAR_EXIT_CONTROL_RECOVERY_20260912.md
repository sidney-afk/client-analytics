# Private control-record recovery

The opt-in control companion now has an integrated isolated PG17 pass:
`c4b4eef93262422aa27b4235dbb9d11c`, exit zero, server stopped. Exact tested source
pins and bounded results are in `LINEAR_EXIT_CONTROL_RECOVERY_PROOF_20260912.json`.

Two fixed profiles are supported: `core` includes the installation journal,
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
the forthcoming retirement-switch owner and provider terminal-history owner are
not included. A changed private trigger contract requires a separately reviewed
profile update; this pass must not silently acquire that coverage.

It does not prove hosted installation, fresh source provenance, external-worker
fencing, key retrieval from an independent location, off-device custody, or safe
activation of the restored system. Those limits remain explicit.
