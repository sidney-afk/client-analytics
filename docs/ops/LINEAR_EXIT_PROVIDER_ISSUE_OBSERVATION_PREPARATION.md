# Recorded issue and attachment observation recovery preparation

This component reconciles recorded uncertain issue updates, archive/restore and attachments from source-bound read observations without resending provider mutations or fabricating acknowledgments. It is preparation only. No hosted/provider/n8n operation occurred.

## Contract

Owner 20260913183021 follows the recorded comment observer and precedes the final retirement checker. It adds public plan/record/recover functions and extends the existing ACK refusal and terminal eligibility functions. Private table shape and the application DML guard remain unchanged.

The original immutable V2 outbox intent, recorded request/context, current closed epoch, original held lock, exact outbox CAS and previous-observation CAS bind each read. Only the exact existing issue and attachment-page queries are accepted. Raw response JSON, variables, query/response hashes, original attempt/request hash, round and cursor position remain recorded. The recorder never changes an admitted attempt into acknowledged. Limits are 128 observations, 1 MiB per response, 16 MiB history and 50 continuation pages. A fresh issue read starts a new round while preserving older failed observations.

Recovery rebuilds the original issue-update input and exact source query, then compares the observed selected value with the immutable intent. Status plus due remains one combined intent. Missing or malformed selected fields cannot impersonate explicit clears, empty labels, zero priority or an unarchived issue. Historical parent/restore cases governed by the source historical disposition refuse this already-applied route.

Attachment canonicalization uses the actual existing canonicalAttachmentUrl implementation. A versioned service-supplied projection includes original payload URL, current native URL/revision and each raw observed URL/subtitle alongside their canonical values. SQL binds the projection to the stored raw response and exact original request, checks raw-node correspondence, and requires matching current native revision and canonical intent before completion. It also reconstructs original title/metadata/input. The helper hash labels reviewed source provenance; it does not cryptographically attest that JavaScript executed. The authorized service reader and canonicalization implementation remain the explicit trust boundary, as with the existing observation components. No caller success boolean is accepted.

A matching attachment may be found on the first or a continued page. Absence on a partial page stays unresolved. Newer native attachment revisions cannot be overwritten or reconciled using an older intent. All successful operations produce the existing source already_applied receipt with status skipped and recovered_idempotently false. Only that exact completed ledger receipt becomes terminal eligible. Recovery updates no native business row and preserves newer local work. Outbox completion and ledger completion share one transaction.

## Evidence

Receipt c11222c47c3642328380235cb39eca4d passed 56 checks across 22 fixtures, exit 0, LINEAR_EXIT_PROVIDER_ISSUE_OBSERVATION_OK; the server stopped. Nineteen cases recover and replay with exact actual-source receipt equality, including status-plus-due, explicit clears, empty labels, whitespace intent semantics and URL-equivalent attachment continuation. Three cases deliberately remain unresolved: contradictory original request, source historical parent disposition and superseded native attachment revision. Missing selected fields, malformed label members, wrong query variables, late ACK, mismatched projection, partial attachment absence and transaction rollback controls pass. Later native title and all native rows remain preserved. Earlier provisional receipt e7383012b1e44e819ef7ffb3e042a3ae passed 34 checks across 13 operation fixtures and stopped cleanly. That receipt predates selected-field and contradictory-request review controls and is retained as prior evidence.

| Artifact | SHA-256 |
| --- | --- |
| SQL owner | 5c5e24aef2c2710975d769378f58c812a78a32ff2e5eeb2392e36c515e5d33a2 |
| Observer helper | 527ef128cba67e3770f632a0b5a0ca3aed5550ec3030fe46c8c58215b2671039 |
| PostgreSQL test | 0628cfacd3e7541f94f82c643000f4cc27607c2f7dfd7c81033f51b60720600c |
| Transport test | 1e8a85dfe042c1a1cd7475960a850cff25d9b7f42a8265ffecf226a2f09a1bf5 |

The portable lane is provider-issue-observation. The transport test passed 10 offline controls with zero actual network calls. The offline transport test covers exact query/variables, fixed endpoint, redirect refusal, response-size bound, malformed JSON retention, authorization newline refusal, supplied deadline signal and actual canonical URL equivalence without changing raw response JSON.

## Limits

These are synthetic isolated database and offline transport proofs, not fresh hosted provider observations. Unknown/contradictory reads, historical dispositions, unrecorded attempts and missing immutable context remain unresolved rather than receiving invented receipts. Attachment replay after a later accepted native revision can refuse while preserving its existing completed receipt; it never rewrites newer native work. Final installation, current catalog, private recovery and retirement-switch preparation must incorporate this final function metadata. Deployment, external worker fencing and authorized owner-window evidence remain separate gates.

Checkout provenance: the c11222 receipt records working-copy hashes for two preexisting dependencies, `scripts/linear-exit-provider-send-v2-compose.js` and `supabase/functions/linear-outbound/provider-send-v2-preparation.mjs`. Their staged Git versions differ only by one CRLF-to-LF line ending each, outside string literals. This lane treats those entries as before/after provenance checks, not fixed expected-hash requirements; neither hash is embedded in the new SQL. The receipt describes the tested checkout bytes, not byte-identical staged copies of these two dependencies. The four component code/test files retain their exact tested bytes.
