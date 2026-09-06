# Recovery package: independent review of PR #1313

**Changes required at `8fa163b79475f50474c092eafa6e6db446d2241e`, based on `aab2acd23112f7bdff849a9c0b68306d41bbf62c`. Nothing may be installed or used for an approved recovery on this evidence yet.** Three exact-head hosted checks pass. The independent local review nevertheless reproduced three successful-looking restores that did not preserve the source. The earlier six-owner journal and closed 33-table data-restore work are not withdrawn; these findings concern the new schema reconstruction package.

## Executed evidence

From 2026-09-06T00:20:25.144Z to 2026-09-06T00:21:15.742Z, the coordinator ran the real capture, authenticated-package parser and reconstruction functions against separate synthetic source/empty target databases on a newly owned loopback PostgreSQL 16.14 server with SCRAM-authenticated restricted roles. The original 16-group rehearsal passes with an external Windows-only adapter adding psql's noninteractive password-refusal option; repository SQL and assertions are unchanged. The unadapted passwordless probe had blocked for input and was stopped, not reported as a pass. Earlier missing runtime/manifest setup failures are also retained separately. The owned server is stopped.

| Additional full capture/reconstruct case | Source next ID / preserved content | Restored result | Tool verdict |
|---|---|---|---|
| Set sequence to 9007199254740993, called | Next ID 9007199254740994 | Next ID 9007199254740993 | success, matching schema fingerprint |
| Set sequence to 9000, uncalled | Next ID 9000 | Next ID 1 | success, matching schema fingerprint |
| Restored CHECK calls a routine that updates an already copied corpus row | Original ordered fixture text-field digest | Different ordered fixture text-field digest | success, matching schema fingerprint, zero flagged egress routines |

The side-effect canary was a synthetic SQL/PLpgSQL function on a CHECK in linear_intake_receipts: it updates team_members.name only when the connecting role is the disposable target. Source insertion therefore preserves the fixture; reconstruction executes the expression and changes the target. The comparison is MD5 of names aggregated in ID order, not a whole-row or whole-corpus digest. No network call was attempted. Row counts remain equal. This proves an undetected content change; it does not prove real provider egress or a currently installed instance of this exact rule.

Independent source/permission review separately passes the existing 10 offline groups and accepts six adverse classifier forms. The [aggregate JSON](2026-09-06-recovery-package-independent-review.json) retains source hashes, baseline attribution, outcomes and limits. Root SQL receipt SHA256: `8dca9011c4513d684bff702992208a434e9a7111166df8d1e2163d70ed29a00b`. Private source data, package bytes, passwords and machine paths are not published.

## Required corrections

**R1 (P1): restored expressions can change data while verification reports success.** At the reviewed commit, `classifySchemaStatement` permits callable CHECK/default/index expressions and SQL/PLpgSQL routines; `reconstructSql` restores expressions around COPY. Deferring triggers does not prevent those expressions from executing. `verificationSql`/`verifyReconstruction` verify counts and schema, not typed-content equality. Bound executable dependencies before mutation, retain supported schema exactly, and verify actual restored content. Unknown dependencies must remain held, not silently omitted. Counting selected egress keywords cannot establish an execution boundary.

**R2 (P2): complete sequence state is lost.** `sequencesSql` emits bigint JSON numbers and omits `is_called`; JavaScript rounds large values. `sequenceValueSql` skips null catalog values and always emits called=true. Two actual next-allocation comparisons fail even though the tool returns success. Carry exact decimal strings and the actual called state throughout capture, package compatibility and verification. Preserve old artifact meanings or refuse incomplete old state clearly.

**R3 (P2): runtime permissions and parser scope do not match their stated restrictions.** Setup refuses BYPASSRLS but reconstruction does not repeat that check; effective inherited capabilities are not established. Setup grants EXECUTE on all functions in the extensions schema. The classifier accepts a multi-target grant beginning with a public object and continuing to an auth object. These are source/filter findings; no unauthorized cross-schema grant or network side effect was executed. Recheck the actual role and explicitly permitted dependencies, and validate every target in every accepted ACL statement.

**R4 (P2): verification failure is not database rollback.** The generated SQL commits before a separate verification process. A later error leaves a nonempty committed target; deleting package files does not reverse it. Distinguish precommit rollback, committed-but-unverified and verified states; retain/quarantine failures and use a fresh empty target. Do not automatically erase diagnostic state. This finding is source-proven; a separate failed-postcommit transport drill is still owed.

## Exact source ledger

Every entry below is pinned to `8fa163b79475f50474c092eafa6e6db446d2241e`; line numbers refer only to that commit.

| File | Symbol / line | Meaning |
|---|---|---|
| scripts/track-b-recovery-package.js | classifySchemaStatement:140; callable forms:157-189 | Expressions, routine bodies and ACL prefix acceptance |
| scripts/track-b-recovery-package.js | sequencesSql:300; sequenceValueSql:484 | Numeric precision, nullable last value and absent called state |
| scripts/track-b-recovery-package.js | targetPrerequisiteSql:450; role check:467 | Runtime permission boundary |
| scripts/track-b-recovery-package.js | reconstructSql:495; commit:506 | Transaction ends before separate verification |
| scripts/track-b-recovery-package.js | verificationSql:511; verifyReconstruction:534 | Count/schema/sequence comparison, no typed-content equality |
| scripts/track-b-recovery-reconstruct.js | reconstruct:56-62 | Apply, then separate verification; temp cleanup only |
| scripts/track-b-recovery-prerequisites.sql | target setup:57; extensions grant:67-69 | BYPASSRLS refusal and blanket function execution grant |
| docs/ops/TRACK_B_BACKUP.md | reconstruction claims:183-203; rollback:240-242 | Claims requiring correction |

## Integration and owner boundaries

The reviewed native label foundation is [draft PR #1316](https://github.com/sidney-afk/client-analytics/pull/1316), `f0e77a47a1e26a1e2a97b514ee06cec824c31b90`. Its new `production_label_catalog_versions` table, functions, ACLs and immutable triggers are outside the 33-table data corpus. Capturing its schema would recreate empty storage, not recover its staged catalog. Installation remains held until authenticated schema and explicitly versioned data recovery preserve it, with trigger-aware restore. Do not broaden a catalog activation or import task here. Further table changes from the two still-running Claude tasks must enter the final integration census; this checkpoint does not certify their unseen schemas.

The [finite correction handoff](../independence/LINEAR_EXIT_HANDOFF_SCHEMA_RESTORE_CORRECTIONS_2026-09-06.md) goes to the existing card-history session. Preserve 8fa and its parent and return a newly reviewed exact head. The original e9fb hosted unit failure and 8fa lexer correction remain history; three green 8fa checks do not override these independent findings.

Clients see the existing served site throughout this documentation/draft work because no main merge, function deployment, migration or flag change occurred. No installed/production capture privilege was granted; disposable fixture grants were exercised. Whole-public capture access includes private operational/HR tables and remains a separately held installation decision. Installed-schema parity, actual anonymous journeys, cloud retrieval, assets, key custody, retention and delivered/acknowledged operational alarms remain unproved. Watcher source exists but product watchers remain inactive. Decision A remains NOT READY under the single G0-G10 checklist.
