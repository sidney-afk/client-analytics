# Provider recovery preparation

These are separate prepared owners after the existing admission and provider-send
owners. They are not yet part of the tested 35-source observed installation plan.
Default outbound source is unchanged; no Linear call, deployment or installation
is authorized by these tests.

## Verified components

| Owner | Behavior | Actual PG17 evidence |
|---|---|---|
| `20260913043506_provider_checkpoint_recovery_preparation.sql` | Stores an immutable original admission row; finishes an acknowledged send with an exact local checkpoint while admission is closed | 14 checks, `ea7cd892b03a46928467ec4d85aa525c` |
| `20260913044939_provider_ack_receipt_recovery_preparation.sql` | V2 admission stores the source receipt context; reconstructs an acknowledged issue-update receipt before local checkpoint completion | 8 checks, `7832d19ef4e9492aa65d1a8bd6930eef` |
| `20260913045704_provider_comment_recovery_preparation.sql` | Recovers acknowledged comment create/update/delete through the existing canonical binding owner with narrow audit/journal permissions | 10 checks, `93a10d02de15462b985096dad85bae3a` |

All three servers stopped. The tests cover original-identity/payload changes,
legacy attempts without original proof, immutable-context tampering, locking,
late transaction rollback and repeated completion. Comment recovery preserves a
newer native body and does not duplicate audit work. Deletion requires the stored
pre-send deletion-attempt evidence; absence of a provider comment is insufficient.

The V2 composer stores the existing handler's resolved receipt inputs before its
send. Its generated handler has the same 12 Deno diagnostics as the pinned
baseline, with no added diagnostics. Both checks remain red; this is not a clean
typecheck. Imports were constrained by cached dependencies, disabled remote imports
and a refusing loopback proxy. The default handler and original send owner remain
unchanged.

## Boundaries

The protected recovery RPCs require the closed epoch, stopped sender/parity flags,
the attempt and exact current outbox state, and the immutable original intent.
They complete local work without resending. A caller's fresh row comparison alone
cannot substitute for the original intent. Legacy rows are not retroactively
promoted into evidence.

Keep the initial pre-review checkpoint pass as provisional history: review found
its missing original preimage. The final version adds and tests that protection.
Comment proof failures involving source-generated journal fields, timezone
representation and an existing event default were retained; final comparisons
preserve complete typed row values and exact event scope.
Independent review also found a nullable deletion-proof comparison. The final
owner uses a null-safe comparison; absent and JSON-null mutation fields both
refuse in actual SQL tests. The earlier eight-check pass predates this repair.

Deterministic F203 issue-create recovery also passed after independent review:
9 actual PG17 checks plus six source-parser comparisons, receipt
`406bda5591b54ab5bd1078edd0f46cdc`, exit zero and server stopped.
Owner `20260913051511_provider_create_recovery_preparation.sql` SHA-256:
`196b6a2c92a5e9f20920960e52bc41471730b020a47ef7f703bebd6c7327446a`.
It verifies the immutable planned UUID and intent, calls the existing linkage
owner, preserves later native edits and pending work, and avoids duplicate audit
effects. The actual source GraphQL query includes `labelIds`. Review found a JSON
description coercion discrepancy; the final SQL rejects numeric/object descriptions,
including string `123` versus numeric `123`, while rewritten autolinks still pass.
The earlier six-check pass predates this correction. The historical F203 owner is
only an isolated fixture prerequisite, not an instruction to replay it on hosted SQL.

Recorded batch and non-F203 create linkage recovery is now prepared: receipt
`6b9ae18a114e44a1a512ab00bab182cd`, 27 isolated PG17 checks, exit zero and server
stopped. It preserves later native edits and verifies exact linkage/audit replay.
Deterministic create read-observation recovery also passed, receipt
`022e0a15fb6041c19a4705b11c008db6`, 11 isolated PG17 checks, exit zero and server
stopped. Its read evidence is separate from a mutation acknowledgment.

Remaining implementation includes operation-specific evidence for other
lost/uncertain provider responses, including comments, and unsupported historical
receipt variants. Unresolved sends still block drain and seal. New ledgers do not
prove older accepted work retrospectively. The historical classifier's 31-check
component proof is described in
`../ops/LINEAR_EXIT_PROVIDER_TERMINAL_HISTORY_PREPARATION.md`; it does not prove
that every hosted historical row is eligible. Full final-owner installation,
updated target/preflight evidence, private-record recovery and external-worker
fencing remain separate integration/acceptance requirements.

Reproduce the components with portable PG17 lanes `provider-checkpoint-recovery`,
`provider-ack-recovery`, `provider-comment-recovery` and `provider-create-recovery`. Their scripts use synthetic
data and isolated database connections; never point them at a hosted database.
