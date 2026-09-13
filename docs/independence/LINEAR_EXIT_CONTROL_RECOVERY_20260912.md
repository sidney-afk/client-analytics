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

This test includes provider owners through ACK receipt context and WR-101; newer
comment/create public recovery owners still need final combined restore coverage.
It does not prove hosted installation, fresh source provenance, external-worker
fencing, key retrieval from an independent location, off-device custody, or safe
activation of the restored system. Those limits remain explicit.
