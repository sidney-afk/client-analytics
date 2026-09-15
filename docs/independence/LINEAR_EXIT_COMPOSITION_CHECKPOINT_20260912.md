# Composition checkpoint - 2026-09-12

Preparation only. Installation HOLD; no merge, deployment, workflow dispatch,
production write or n8n execution. This checkpoint is not the final handoff.

## Exact source inventory

The installation inventory now contains 64 entries, including the native
sign-off verifier after the final ordinary-envelope owner. SHA-256:
`6c57462d97876157322b8ecffbc6d46b0b40d9cfc669c14be61df871c5e43122`.
This identifies the ordered SQL sources, not the entire application revision or
a complete hosted schema. Historical 63-entry results remain historical.

## Completed isolated checks

| Check | Result | Private receipt directory |
| --- | --- | --- |
| PG17 native sign-off | 43 verifier checks plus 6 integration controls; 30 actual SQL requests | `linear-exit-native-signoff-4fe66594c46a4ab9bb470713376fa522` |
| PG16 ordered deployment preflight | 150 required objects; verifier volatility refusal control included | `linear-exit-preflight-installed-ca410567aa5d4e0d8a065d2d1189aa4f` |
| PG17 upstream-ledger recovery | 31 checks, 52-table recovery corpus | `linear-exit-recovery-upstream-ledger-f4f12aa6afec473cb095da559e1012fb` |

All three runs exited zero. The native integration uses the actual SQL verifier
and service-role SQL adapter, not hosted PostgREST. It covers valid approval,
fresh revalidation, missing verifier, unbound admission, replaced receipt above
JavaScript's safe integer limit, and a reopen one microsecond later. The frozen
Calendar handler is not modified. No hosted configuration or readiness is proved.

The preflight's earlier negative-control failure is retained in receipt
`linear-exit-preflight-installed-7d27bbd9f03842b69b33573a661164a5`:
the signature predicate omitted `public.` and failed to check volatility. The
predicate was corrected; the failing assertion was preserved in the passing run.
Earlier native integration fixture failures remain in private evidence as well.

## Installation order clarification

After step 11's final envelope repair in `docs/ops/LINEAR_EXIT_REPAIR_INSTALL.md`,
install `migrations/2026-09-11-native-signoff-verifier.sql` before enabling the
updated reconciler. Read back its exact body, stable volatility, table result,
security-definer search path and service-only execution grant through the updated
deployment preflight. Do not rerun a divergent installed migration blindly.

## Still open

The selected newer main-branch runtime integration is now implemented locally:
staff admission/boot, matching QA setup, and importer-derived sign-off identity.
The reconciler passes 172 offline checks, its native verifier helper passes 39,
and the changed reconciler passed a fresh actual PG17 integration in receipt
`linear-exit-native-signoff-ccd4a4bd7fd74b52bd9b610e5e40f61b`.
Staff entry passes 20 checks and client entry 23 groups; boot parity and bounded
Calendar cache checks pass. These are isolated checks, not hosted observations.
Unrelated upstream documentation, screenshots and workflows were not imported.

The
52-table recovery result does not close the separately identified remaining
table or asset-custody coverage. Final admission/drain and retirement activation
remain unresolved. A final application acceptance run and reviewed publication
must follow integration; this intermediate evidence cannot substitute for them.
