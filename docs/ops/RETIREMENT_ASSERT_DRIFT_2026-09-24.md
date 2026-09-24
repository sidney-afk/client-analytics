# Retirement contract assert drift — 2026-09-24

Proposal only. Nothing was applied; every database read below was a read-only SELECT against production.

## Symptom

`select public.production_retirement_contract_assert_v1();` raises
`retirement_dependency_contract:production_assignment_epoch`. The assert is a
pure raising check (catalog reads + `raise exception`, no writes), and only
`production_syncview_retirement_activate_v2` and
`production_syncview_retirement_native_reopen_v1` call it (live `pg_proc`
scan). No cron job, Edge Function, workflow or repo script calls either of
those; only `test/linear-exit-retirement-switch-postgres.js` does, against an
isolated database.

## How the assert pins

It embeds a `$expected$` JSON with 33 function entries and 192 trigger
entries. For each function it builds, from `pg_proc`: name, identity
arguments, result, kind, language, owner, `proacl::text`, `md5(prosrc)` (raw
body, not `pg_get_functiondef`), volatility, security definer, strict,
leakproof, parallel, `proconfig`, and `has_function_privilege` EXECUTE for
`service_role`, `anon`, `authenticated`. It raises on the first entry that is
not identical. So the error names the first drift in array order, not the
only one.

## Live result of every check (2026-09-24)

| Check | Result |
|---|---|
| 4 private control tables (RLS, owner, no anon/authenticated/service_role writes) | pass |
| `production_assignment_epoch(p_team text)` | **fail** — body md5 `a5010614cc8a63256a2f7cd2fc040541` is unchanged; **ACL** is now `{postgres=X/postgres}` and `service_execute` is false (pin: `service_role=X` and true) |
| `production_label_catalog_check_manifest` | **fail** — pin `cdddaeca…` = 2026-09-05 foundation; live `ae8b6d3d…` = `2026-09-18-native-label-retired-state.sql` |
| `production_label_catalog_read_version` | **fail** — pin `591b3342…` = 2026-09-05; live `3fc8a41a…` = `2026-09-18-native-label-retired-state.sql` |
| `production_native_assignment_receipt_guard` | **fail** — pin `f46ecebe…` = 2026-09-06; live `0afdad25…` = `2026-09-18-native-test-client-parity.sql` |
| `production_native_label_receipt_guard` | **fail** — pin `ee99c634…` = 2026-09-06; live `3d82a07e…` = `2026-09-18-native-label-test-client-parity.sql` |
| `production_native_ordinary_event` | **fail** — pin `0b07bb0d…` = `2026-09-12-native-ordinary-envelope-repair.sql`; live `b4918fb7…` = `2026-09-18-native-test-client-parity.sql` |
| `production_native_ordinary_receipt_guard` | **fail** — pin `05076600…` = 2026-09-09; live `297a3428…` = `2026-09-18-native-test-client-parity.sql` |
| remaining 26 function entries | pass |
| trigger set (192 live = 192 pinned) | pass |
| provider send fence (`linear_exit_provider.retirement_send_fence_v1`) | pass |

Each hash was computed the assert's way (`md5` of the dollar-quoted body) for
every repo migration defining the function; every pinned and every live value
matches exactly one repo definition.

## Cause

Two reviewed changes landed after the assert was installed and the live
assert was never re-pinned:

1. `b63c6804` (2026-09-17, merged via PR #1408) — `migrations/2026-09-17-notification-service-role-revokes.sql`
   line 38 revokes EXECUTE on `production_assignment_epoch(text)` from
   `service_role`. This is the drift the error names.
2. `80fcdf03` (PR #1412/#1413), `dfc5fd05` (#1414) and `b653cf3c` (#1415),
   all 2026-09-18 — the native test-client parity and retired-label
   migrations redefined six pinned functions.

The assert itself came from `supabase/migrations/20260913062149_retirement_switch_preparation.sql`
(`87283f92`, 2026-09-13; contract regenerated in repo by `89405832` 09-16,
`da028c59`/`dfc5fd05`/`b653cf3c` 09-18). The **repo** file already carries the
six new body hashes, but not the epoch ACL change, and the live assert
(prosrc md5 `c28cb0972b52596d75134a05a7980418`) still has the older pins. No
row in `supabase_migrations.schema_migrations` mentions these objects, so the
installs were applied outside the migration ledger.

## Is activate/reopen still meaningful?

Yes, as a one-shot. `syncview_retirement_admission.mode` is still `active`
(never activated). `prod_authority` is `syncview` for both teams and the
capability check inside activate requires exactly that plus outbound off, so
the switch is the remaining step that formally closes Linear admission; it is
just not scheduled or called by anything today. Reopen is its reverse.

## Options

**A. Re-pin (recommended).** `migrations/2026-09-24-retirement-assert-repin.sql`
recreates the assert with the live body verbatim and changes only seven JSON
values (listed in the file header). It runs the new assert before `commit`, so drift since this read aborts the apply. Rollback: `migrations/2026-09-24-retirement-assert-repin.ROLLBACK.sql`, the exact live definition read 2026-09-24 (body md5 `c28cb0972b52596d75134a05a7980418`, bytes incl. CRLF preserved). Neither file is applied. Activate/reopen keep working and keep
failing closed on any future unreviewed drift.

**B. Retire the assert.** Drop it or make it a no-op. Activate and reopen
`perform` it, so dropping it breaks both with "function does not exist"; a
no-op removes the only check that the provider fence, guards and ACLs are the
reviewed ones before the switch flips. Retiring the assert honestly means
retiring the switch too, which is a larger decision than this drift.

## Recommendation

A. The drift is fully explained by reviewed, merged changes; nothing unknown
is live. Re-pinning is a pure metadata change to a read-only check, restores
the switch, and keeps its fail-closed value. Also: OPEN_REPAIRS 248 tells the
owner to run this assert after applying its migration — it will raise until
this re-pin is applied, for the reason above, not because of 248.

Separately worth noting: the repo migration file's pin for
`production_assignment_epoch` still says `service_role=X`; a future
regeneration of the contract should pick up the 09-17 revoke.
