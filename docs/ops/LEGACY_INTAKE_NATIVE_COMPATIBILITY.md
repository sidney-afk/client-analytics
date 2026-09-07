# Remaining legacy intake and card compatibility

Bounded source preparation at base `b60a9705492002830eed60ece874e0686fc4b538`.
The execution authority remains G6 in the canonical PR1268 checklist at
`74765c2308b56419afe9ccf46de06577ee4c20a4`; this is a route contract, not a new
release plan. No deployment, n8n edit, live/TEST write, flag or credential change.

## Current caller correction

`_submitLinearFormRoutedOnce` formerly chose F44 before inspecting a saved native
request when the optional cohort helper was absent. A storage read error also
chose F44. The corrected selector preserves existing F44 receipt priority, reads
the native slot before consulting that helper, and sends known native ownership
to the existing native authentication/recovery path. Unreadable storage or a
nonempty native record without a readable request identity produces a visible
hold. No record, draft, actor, payload or request ID is changed by selection.

This is a routing correction, not a new recovery owner or a complete validator.
The existing native lock, actor checks, request validation and saved retry remain
responsible for recovery. If both stores exist, the previous F44-first behavior
is retained; this does not settle the two debts or prove they are related.
Sign-out still applies the existing sensitive-data policy. Browser storage loss,
unknown original intent and incompatible old bundles remain unresolved.

The focused `test/submit-owned-intake-routing.js` has 16 offline groups, including
two actual b60 selector counterexamples. It stops at the existing authentication
boundary and proves route selection/storage preservation, not server acceptance.
The first F44 regression run failed because its extracted-shell fixture lacked
the newly read existing native-slot constant; adding that constant restored all
72 checks without changing assertions. Existing Calendar routing, 23 legacy card
uncertainty groups, 11 native card route groups, cutover UI, native intake UI and
59 retained-refusal groups pass. No Chromium or installed-route proof is claimed.

## Exact remaining server contracts

| Current entry | Existing owner and required treatment |
|---|---|
| `_linearAwaitCreate` to `VIDEO_FORM_WEBHOOK` / `GRAPHIC_FORM_WEBHOOK` | Preserve the F44 `team`, canonical `payload_hash`, `receipt_key` and equal `idempotency_key`, original payload and per-team results. An accepted/unknown legacy receipt cannot be replaced with a fresh native request. |
| Fresh Submit without a native job, missing cohort helper or unenrolled/failed routing | Still selects the offered F44 workflow. Removal must follow serving compatibility for its actual legacy payloads, not infer native readiness from a failed flag read. |
| `_calUpsertUrlForClient` / `_calUpsertFetch`, plus Samples equivalent and pinned old transports | Retain ordinary offered approval/comment/edit routes. Cold/failed flag reads and old jobs can reach n8n. Browser-only changes cannot protect these endpoints. |
| `_nativeAcceptedCardTransport` | Already pins server-projected immutable native epochs to EF; malformed metadata holds. A provider-era accepted result without that metadata keeps its original transport. Do not infer an epoch from a `p_native_` ID, current authority or current client cohort. |
| `_writeLinearVideoCardsToCalendar` / `syncview_calCardJobs_v1` | Retained legacy attempts and exact fragments are legacy debt. Unknown outcomes need authoritative acceptance/current-card evidence before recreation; never convert them into native manifests or replay initial fields over human edits. |

### F44 endpoint compatibility, before retiring provider creation

1. Capture the exact serving versions and reachable request/response paths of the
   two F44 endpoints, their durable ledger and all provider/write tails. Existing
   source tests do not prove those installed owners. Retain the original envelope
   and exact legacy receipt identity durably before acknowledging receipt.
2. Resolve a preexisting key against its original ledger and authoritative native/
   provider acceptance. Atomically conserve mixed-team, pending, partial, failed,
   created and lost-response states. Unknown legacy ownership is retained for
   reconciliation; no new browser actor, source timestamp or replacement request
   can stand in for absent historical evidence.
3. For genuinely new legacy-shaped input, implement a reviewed server-owned
   adapter whose stable legacy key maps atomically to one native acceptance
   identity. The server must establish permitted provenance and complete original
   intent; do not manufacture staff identity for public intake. Its native work,
   manifest, recovery history and mapping must commit together, with no provider
   prerequisite or provider side effect. This adapter is required, not implemented
   here; the existing native endpoint alone is not that contract.
4. Old browsers accept `received` only with `ok:true`, `status:'received'`,
   `durable_capture:true`, `triage_required:true`, exact `team`/hash/key/idempotency,
   `ledger_status` in `pending|failed|partial`, and nonempty safe triage codes.
   That response acknowledges durable intake, not created work. Do not return it
   unless the retained record and operational follow-up actually exist. Do not
   fake `created`: that path requires real parent/child UUIDs and launches the old
   browser's provider discovery/card materializer. Native completion for old
   callers therefore needs compatible server-side materialization/continuation
   before ordinary intake can operate independently of Linear.
5. Before retiring either alias, prove zero remaining callers/debt/in-flight work,
   or keep its native adapter. A browser banner or local expiry cannot establish
   this. Exact old-payload tests must cover first send, same-key replay, acceptance
   followed by lost response, partial teams, storage failures and refusal without
   work loss; direct old callers must produce zero provider egress.

### Calendar and Samples n8n card bypasses

Reuse the existing [compatibility evidence](../audits/2026-09-06-native-card-compatibility.md)
and [native card owner](NATIVE_CARD_MATERIALIZATION_BOUNDARY.md). The published
graphs captured there erase source distinctions before direct card writes.
Those dated reads are not a current serving-version guarantee.

For `calendar-upsert-post` and `sample-review-upsert`, branch immediately after
Webhook, before Build Row, on the exact native creation markers
`submission-native`, `calendar-native`, `samples-native`. Forward the original
raw body, endpoint surface and marker into the reviewed native materialization
contract. A marker selects the protocol and confers no authorization. The branch
must terminate with its full current-card result or visible conserved refusal;
it must never continue to Sheets, scalar/card writes, comment helpers, events or
provider fallback. Unmarked ordinary writes retain their current authorization
and intended save semantics, including open client approvals and comments.

Prove both direct old aliases and cold/failed-flag current callers against the
actual adapters: accepted create, lost response, retry after human edits,
archived/deleted/replaced card, unknown/malformed/conflicting body, failed ingress
storage, and ordinary client/Kasper/SMM saves. Recovery must retain ingress,
original manifests, receipts, provenance and current rows. Only then remove
current provider fallbacks. No automatic n8n edits or installation are authorized
by this document.

## Release and rollback boundary

G6 remains held until these serving adapters and actual old-caller tests exist.
No unused historical export is required by this slice. Source withdrawal before
serving is reversible; after serving, retain this ownership routing and all
accepted records. Returning to the b60 selector can redirect saved native work
to F44 again. Adapter rollback must keep native-compatible receipt readers and
conserved debt; never restore a provider default after the provider cutoff.
