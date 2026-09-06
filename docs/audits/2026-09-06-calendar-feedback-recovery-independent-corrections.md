# Calendar feedback recovery: independent corrections

Date: 2026-09-06 UTC. Scope: isolated corrections over preserved PR1317 author
head `a9d798e6120ddf13c6461bec496715dc06c4bcef`, whose base is
`7e5a743cce8a1552bc822e0e560896451f983cdf`. No production, provider or TEST
access; no push, merge, deployment, flag change or applied production migration.
The coordinator owns subsequent integration and publication.

## Independently reproduced defects

All references in this section name the preserved author head, not an installed
service. The original 19 handler groups / 621 assertions and 11 browser groups /
266 assertions independently passed before these additional probes.

| Defect | Actual baseline result | Source anchor at author head |
| --- | --- | --- |
| P1: another same-card comment's accepted status can certify this comment | HTTP 200 `materialized`, one evidence row, although this comment's status was never sent | `supabase/functions/production-write/index.ts`, `recoverCalendarFeedback`, line 4987; migration `calendar_feedback_recovery_apply_v1`, line 287 |
| P1: claimed owned fields can change another component or grant an approval | HTTP 200 `materialized`, another component changed and an invented approval timestamp was stored | gateway `recoverCalendarFeedback`, line 4969; RPC field validation |
| P2: missing source body is treated as a matching existing copy | HTTP 200 `already_present`, one evidence row, no body in the existing source entry | `migrations/2026-09-05-calendar-feedback-recovery.sql`, `calendar_feedback_recovery_apply_v1`, line 329 |
| P1: root-note precommit refusal erases ordinary draft text | Actual gateway HTTP 403, zero accepted comments/receipts/source writes, durable draft text missing | `index.html`, `_calComposeMsgAdd`, line 46069; `_reviewDraftFinish`, line 43057 |

Wrong-client refusal and a valid note materialization remained positive controls.
Baseline failures are preserved separately from corrected receipts. The root-note
negative used the exact older document with the corrected handler refusing before
acceptance; its page hash was checked. Earlier probe setup failures (SQL syntax
and a mismatched harness document pin) were retained, corrected, and excluded
from product-defect evidence.

## Bounded correction

New tweak status IDs hash the complete deliverable/native-comment identity with
a versioned domain separator. The gateway derives the required identity; the
RPC derives it again from the locked, receipt-validated canonical comment.
Merely asserting an accepted result or borrowing a same-card receipt cannot
prove acceptance. Existing unbound reservations remain visible and held; no
automatic resend, re-identification or receipt rewriting occurs.

Forward fields are limited to this component and overall `Tweaks Needed` status,
plus empty approval values that satisfy the existing stale-approval rule under
the source-row lock. Notes own no scalar fields. SQL missing/null/non-string
identity/body checks cannot fall through three-valued comparisons. Explicit
root-note refusal has a separate draft outcome, preserving original or newer
typing and retaining owned evidence if storage cannot be updated.

The accepted-comment fingerprint helper, shared policy/imports and both frozen
anonymous writers are byte-identical to the author head. Existing status writer
semantics are unchanged; only the new owned-tweak caller supplies a bound request
ID. There is no new endpoint, table or privilege change beyond the original
unapplied PR1317 migration.

## Focused proof

| Lane | Corrected result |
| --- | --- |
| Actual handler + repository migrations, owned disposable PostgreSQL 16.14 | 22 groups / 855 assertions PASS; original 19 retained; direct RPC bypass negatives and positive canaries added |
| Complete document + real client controls + actual handlers/SQL | 12 groups / 276 assertions PASS; includes actual old document → accepted unbound status → updated document → visible hold |
| Actual root-note precommit 403 → refresh | 1 group / 6 assertions PASS; baseline text-loss negative retained |
| Existing accepted fingerprint contract | 238 assertions PASS |
| Actual composer helpers | 15 cases PASS, including newer typing and storage failure |
| Existing intercepted hold / nullable-cell / alias / lifecycle controls | 5 hold cases and 10 source/lifecycle cases PASS |

All browser and SQL fixtures are fictional; external requests are intercepted or
refused. The owned PostgreSQL cluster was stopped. The SQL transport uses an
administrator fixture connection behind actual gateway authentication; installed
role privileges are not proved. `Promise.all` retries use synchronous psql and
do not establish overlapping SQL transactions. Lifecycle hooks finish their
change before the recovery RPC; no new lock-contention claim is made.

The harness and browser proof are tied to these exact runtime SHA-256 values:

- `index.html`: `53b46642e1b95d0e387059c43682a1d72d77e7519fb9d0a5c39d8ddb937167f1`
- `supabase/functions/production-write/index.ts`: `6b43921849a525838c4169b2aea485638c42b3d19251915ee72aa6a4449791f2`
- Recovery migration: `ee6858accc21b28c03f18579c49d4361dd1287645b785dd20e0136e7ee5851cb`
- Five-file gateway closure: `044614b21547e78b14f5cb45c73a3281926c15f4eec910933b3e5b9ea59717e9`

## Integration and rollback limits

No full-unit or Production polish rerun is claimed here; the coordinator will
run the combined candidate's affected/full integration checks. Gateway, RPC and
browser serving parity are unproven. Earlier unbound attempts, missing original
context, missing status receipts, later native lifecycle changes and divergent
legacy aliases remain visible holds, not automatic reconstruction.

`calendar_feedback_materializations` has 13 columns, a text `attempt_key` PK,
one secondary card index, no FK/sequence/triggers, RLS with no policies, and
service-role SELECT/INSERT. Its two functions and selected data need authenticated
recovery-corpus integration before installation. Retain this evidence on rollback;
disable recovery at the gateway before removing its RPC, preserve owned drafts,
and never restore the unsafe author recovery implementation as an operational
inverse. The [contract](../ops/CALENDAR_FEEDBACK_RECOVERY_CONTRACT.md) and
[rollback runbook](../../ROLLBACK.md) carry these requirements.

## Private evidence digests

Only hashes are public; private paths, credentials and records are omitted.

| Evidence | SHA-256 |
| --- | --- |
| Original handler receipt | `88e82a54a8253c3643c9642ec77469689f3fca90b3910c426f2cfa17b89b0abf` |
| Original three SQL negatives | `c01ade68c99079f2363f11db3fb88fc2bdcf5b18de4ce9499d1ca54df6fa4bae` |
| Original browser receipt | `c38c2f5cea3b086c4f5820110faf11c247fc7b92a4d38bc32ef8d7a86ff7f130` |
| Root-note baseline negative | `b6fc4a8caa559907eb07d8dd613e98654c6f22b921721c1926cc6c43fd1f5419` |
| Corrected handler receipt | `27d1303c4b27bffce584a09c689fbc90fbead6b0a635c9fe40f405450985289f` |
| Corrected root-note browser | `06f14b4e41e2165ae94f5a7444c591be5a9ec3f92dc751f2cf91230ced9cf240` |
| Corrected browser receipt | `670b936ba17c1b2c4eb9b5ac411e87196a2e31a24da68c84b16a86429822687a` |
