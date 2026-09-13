# Recorded comment read-observation recovery preparation

This component completes recorded uncertain comment attempts from source-bound read observations without resending a mutation or fabricating a mutation acknowledgment. Preparation only: no hosted/provider/n8n operations occurred. Observations are supplied through the authorized service-role recorder and bound by its source contract; they are not cryptographically signed provider attestations or hosted proof.

## Contract

Owner 20260913181213 follows 62741 in the explicit reviewed plan and precedes the final retirement checker. It adds public marker/observation/recovery functions, extends late-ACK refusal for the new observation envelope, and extends terminal eligibility only for exact completed observed-comment receipts. Private tables and the application DML guard are unchanged.

Observation requires the original immutable V2 admission/context, held original lock, current closed epoch, exact outbox/previous-observation CAS, and the exact source issue/comment queries. The envelope preserves each bounded response, variables, query hash, recording time, round and cursor position. It never changes an admitted attempt into acknowledged. Limits are 128 observations, 1 MiB per response, 16 MiB total and 50 comment pages per round. A fresh issue read starts a new round; malformed old rounds remain preserved and cannot masquerade as current evidence.

Add/edit recovery follows the source first-marker decision. The first marker parsed from each returned body must match the original deduplication key and the returned comment must belong to the exact original issue; updates additionally bind the original provider comment ID. A positive source marker may occur on a page whose hasNextPage remains true, just as the source reader returns immediately on a match. This is not proof of global marker uniqueness or unchanged provider body. No marker on a partial page stays unresolved; continuation cursors are checked, and multiple matches already observed refuse.

Deletion requires the immutable original source pre-send commentDelete checkpoint, matching request/comment/native identity and a matching read showing null or the source-recognized sanitized not-found result. Absence without that prior proof stays unresolved. Authentication, provider identity and external worker fencing remain operator evidence requirements; recorded database time is not a certified provider timestamp.

Recovery preserves later canonical edits, uses the existing exact scoped comment-link/audit owner and writes the source already_applied receipt. Non-F27 source semantics terminalize these as skipped. Only the corresponding completed ledger, immutable original intent and exact local observation receipt make that skipped row eligible; unrelated skipped/conflicted work remains ineligible. Repeat completion preserves receipts and native rows. All effects and ledger completion share one transaction.

## Evidence

Supported PG17 lane: provider-comment-observation. Receipt 25761f1aa2804224a2357fd94a77bd55 passed 20 checks, exit 0, LINEAR_EXIT_PROVIDER_COMMENT_OBSERVATION_OK; server stopped. Six successful recorded scenarios cover add/edit/delete, edit-to-create materialization, cursor continuation and source not-found deletion; an unproven delete remains admitted. Source-extracted compact issue and recovered-receipt expressions match actual SQL results. Five marker parser comparisons cover case/Unicode whitespace/first-match behavior. Wrong first marker, malformed current page, wrong cursor/query target, late ACK and missing delete proof refuse. Whole-transaction rollback, exact replay, later body preservation and malformed older-round recovery pass.

The transport test passed 10 offline checks with zero actual network calls: exact query allowlist, variable boundaries, fixed endpoint, redirect refusal, bounded response body, malformed JSON retention, authorization newline refusal and supplied abort signal. The source uses a seven-second fetch deadline. This is not hosted transport identity proof.

| Artifact | SHA-256 |
| --- | --- |
| SQL owner | b92fbbe60b3e64d4cc3da7f297d3c6f6900cb7aaf225f1f6e0151ef55ea3004b |
| Observer helper | 9c8d7802b5896c543a1a263b86255b3b7b49308b01d1e1e53d784d9c9c44b044 |
| PostgreSQL test | 755d69adb94421bf11f064202593292fc1bfa7a5c038c803b2b71a658ebfe484 |
| Transport test | 862bec6823250346b446d5a9f05beb01905bf91e4a85a2142abea20f641be482 |

Prior receipt 836b8f5118df46b3829f59e348ad9f83 passed 18 checks before the first-marker and malformed-round corrections. Runner failure 1df71c482aa847bdaad7598d941d1a4e remains preserved; it did not exercise this SQL. The dispatch fallback is now guarded separately.

## Remaining scope

Unrecorded attempts and missing immutable context are not retroactively invented. Uncertain non-comment issue updates and attachments still need their operation-specific read/reconciliation paths. Full installation/current-catalog/private recovery and retirement-switch integration must use this final public classifier body. These isolated checks do not authorize installation, activation, provider writes or removal of operator gates.
