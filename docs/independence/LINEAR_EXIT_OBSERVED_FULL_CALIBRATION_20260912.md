# Observed installation target calibration

Classification: **ISOLATED_POSTGRES / TARGET_CALIBRATION_ONLY**. This is not
installation authorization, hosted verification, or a completed preparation build.

Receipt `4ff4f80f551b44f3b1cdcda54475112e` passed on disposable PostgreSQL 17;
exit 0 and server stopped. The packaged observed-schema constructor reproduced
the captured 67 public tables and 115 routines exactly. The expanded plan then
applied 42 pinned sources through 49 journaled transaction chunks under the
maintenance gate. The complete ordered journal prefix, 90 public table names,
17 final new routine bodies and their role access checks passed. Unchanged
admission routine fields and observed F203/comment-linkage routine records were
preserved. A second connection's ordinary table write was refused.

The private target includes the exact public catalog and selected private control
catalog for the `core+diagnostics` profile. Target derivation temporarily removed
only maintenance triggers inside a transaction and rolled that transaction back.
The finalizer was **not** run. Maintenance remained closed. Target derivation is
not independent target acceptance.

| Binding | SHA-256 |
| --- | --- |
| Original 42-source plan | `3ecb7bba4f7635ee72abd13066ddb6b3774920b77738214b786f208c35468ad6` |
| Maintenance-derived plan | `66c0195c484f7b575a09d06731ce9478209a4161f54dd2b369be317a632849d0` |
| Private target bytes | `2144ae7a4218092851848692f5859537a9aefb9d6940abf9ca41dc9fd6eb7685` |
| Bare public catalog | `e7fa414a0c757cb6ee9fa18684ea801d43289cba1c76b4bcee789ef1f7199516` |

The target and captured definitions remain private; this document publishes no
raw routine bodies, policy/view definitions, credentials, or application rows.
The receipt's `pipeline-report.private.json` retains all 18 source pins.

## Reproducible entry prepared

`run-portable.ps1 -Lane observed-full-install` requires PG17, an explicit
`-ObservedInputDirectory`, and either `-CalibrateTarget` or both
`-ExpectedTarget` and `-ExpectedTargetSha256`. The lane uses ICU `en-US` and
the repository wrapper/worker. Verification mode requires saved target bytes
and compares the entire public/private target before invoking the finalizer.
It accepts no live connection or installation authorization.

The successful calibration used the private predecessor of this orchestration.
The new repository entry is syntax-checked, with nine offline plan/target checks
and eight offline isolation checks passing, but has **not yet run**. The isolation
test substitutes a Cluster sentinel before module loading and proves seven
unsafe routing configurations refuse before `start`; its positive control proves
the sentinel observes startup. No database connection occurs in that test.
The entry's differences are relative repository paths,
explicit private input/output and calibration/verification arguments, pre-start
loopback/opt-in/routing guards, additional
orchestration source pins, and expected routine bodies read from the exact plan
transport. A fresh isolated replay against a reviewed saved target remains owed.
The newer recorded-create owner under development is not in this 42-source plan.

## Exactness boundaries

The observed F203 linkage body has MD5 `cad02230ee9f1b4e963477586a39be3e`;
the historical owner used by component tests has MD5
`eff0556e018fd45d202e55fc6b5062f9`. Direct string comparison found exactly 115
CRLF pairs and zero standalone CR characters; converting those CRLF pairs to LF
produces the source body exactly. The installation rehearsal preserves the raw
observed body and does not normalize its catalog comparison. This establishes
the bounded source difference, not same-target business behavior.

The full plan's SQL transport removes only the reviewed psql stop-on-error
directive; function body bytes remain unchanged. All 17 raw body checks passed.
The new repository worker derives expected bodies from those exact plan SQL bytes.

External role equivalence, Storage/Auth configuration, sequence/DDL fencing,
runtime deployment, provider dispatch, and hosted installation remain unproven.
Historical 35-source evidence remains separate and is not this expanded target.
