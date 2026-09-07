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

### September 7 offline CARD graph preparation

`scripts/n8n-native-card-adapter.js` now implements this CARD-only transformation.
It reads two exact published captures through an explicit private binding and
emits new private `calendar.draft.json`, `samples.draft.json` and hash receipt.
There is no network client, workflow execution, apply command or activation.
F44 intake is unchanged and remains separately held.

The transformer pins compatibility source
`cfb042aca6394edc0f6f9c4ebab928b1e223f806`, n8n `2.37.7` and the existing native
helper SHA-256 `7f3185bba428d18d4f773a9014dffd3bdff49873354b55391f8d72f27a98de74`.
It requires matching capture hashes, current/top-level and published active
versions, identical active nodes/connections, the known POST Webhook v2.1 and
original 17-node graph. Inverse validation preserves every original node value except the added `rawBody:true` option, all other original
connections, credentials and settings. Unknown markers keep the original path.
The six added nodes terminate native requests before all old tails.

The private binding JSON has `sourceBase`, `helperSha256`, `verifiedN8nVersion`,
one reviewed HTTPS `destinationOrigin`, and `workflows.calendar` /
`workflows.samples`, each containing absolute `capturePath`, `captureSha256`
and `expectedActiveVersion`. No client, actor, token or replacement request ID
is part of this binding. Set `N8N_CARD_ADAPTER_BINDING` to its absolute private
file path and `N8N_CARD_ADAPTER_OUTPUT` to a new private directory whose parent
already exists, then run `node scripts/n8n-native-card-adapter.js`. Both captures
are validated before creating output. Paths must be outside every enclosing
Git repository, including junction-resolved paths. Existing output refuses.
Capture definitions, private URLs, bindings and generated graphs never belong
in Git. Output is review material only, with `activationAllowed:false`.

The two published graphs were refreshed with bounded fixed-origin GET-only
reads on September 7. Each matched its activeVersion. The same instance's
HTML metadata identified `n8n@2.37.7`. The exact official tag's
[Webhook implementation](https://github.com/n8n-io/n8n/blob/n8n%402.37.7/packages/nodes-base/nodes/Webhook/Webhook.node.ts),
[body parser](https://github.com/n8n-io/n8n/blob/n8n%402.37.7/packages/cli/src/middlewares/body-parser.ts),
[HTTP implementation](https://github.com/n8n-io/n8n/blob/n8n%402.37.7/packages/nodes-base/nodes/HttpRequest/V3/HttpRequestV3.node.ts)
and request conversion were captured privately and hash-pinned. At this version,
rawBody adds a binary buffer while preserving parsed JSON. HTTP v4.4's binary
mode forwards that Buffer/storage stream; the explicit text output property
`body` avoids its default `data` field. Redirects and retries are disabled.
Only the exact native source header is added; the destination remains tokenless.

n8n decompresses gzip/deflate before exposing rawBody. Marked compressed input
therefore refuses visibly before forwarding, as do missing binary and over-1-MiB
bodies. Native input requires application/json, case-insensitively, with absent
or one UTF-8 charset parameter; unknown, empty and duplicate parameters, other
media and other charsets refuse before forwarding. There is no reconstruction or stringify of native bytes. Full current
rows must retain client/card/both child-slot identity; later human edits are
returned. Refused/held/unknown statuses preserve their conservation meaning;
malformed, conflicting, redirect and lost responses become visible unknowns.
No failure joins an old writer. Original JSON approval/comment/edit paths remain
offered. Unsupported media types and malformed root values are not certified;
invalid JSON already fails in n8n's parser, while multipart follows its separate
existing handler. Native creation's contract is JSON.

Validation: **19 local synthetic groups**, suitable for hosted CI, run with
`node test/n8n-native-card-adapter.js`; no private input is acquired and no hosted CI run is claimed here. Separately,
**32 private offline groups** execute extracted exact-tag parser/Webhook/binary
request/text-response routines and the actual two captured ordinary builders
with synthetic contexts. They prove raw-byte preservation, ordinary JSON builder
equivalence, terminal topology, and visible errors. Running that private suite
against the promoted module passed again. Its emitted bytes exactly match the
two current private v4 drafts: Calendar SHA-256
`7b17bf8293b62464b971590fb2002293e05606f10957741e2076a7bc7f93e2f4`, Samples
`d10c1c7c11d22a07bf3d06f149d659e89df59a3a2516a5ca547b9dc159b0a183`.
The prior v2/v3 receipts remain superseded proof. Exact upstream form-urlencoded,
multipart and adversarial multipart-parameter conversion tests demonstrate the
Buffer-rewriting counterexamples; v4 changes only native JSON/UTF-8 preflight
from v2. Text MIME and unknown/empty/duplicate parameters refuse; ordinary
requests remain unchanged. The pinned official dependency catalog supplies the
private qs/form-data versions used in those conversion tests.
These are extracted-source/model checks, not an installed n8n-engine execution,
complete wire certificate, browser-retention proof or live acceptance evidence.

Before any authorized release, verify the exact
[frozen tokenless EF composition](../audits/2026-09-07-frozen-native-composition.md)
and existing SQL/admission/lifecycle prerequisites at the destination, then
re-read both graph versions and the instance version. Routing native work to an
older EF before that composition is deployed is unsafe. Drift requires fresh
review. Isolated n8n-engine controls and authorized old-caller/ordinary save
proof still precede applying and publishing these graph drafts. Restoring the
old graph after native admission reopens unsafe tails; recovery must keep native
paths terminal and debt visible while ordinary writes remain offered.

### September 7 offline F44 Submit forwarding

`scripts/n8n-f44-native-adapter.js` prepares exactly the `video-form` and
`graphic-form` POST entry paths from a fresh private published 142-node graph.
The capture is hash-checked against its explicit private binding, active version
and published nodes/connections. Only those two Webhook v2.1 nodes gain rawBody;
only their two original edges change. Ten added nodes form two terminal branches.
Inverse validation preserves all original node values, credentials, settings and
unrelated routes. No n8n API, execution, import, publish or activation is included.

Each entry requires its actual original body team, canonical payload hash,
receipt key, equal idempotency key and all five original payload fields. Route
and body team must agree. Nothing fills a missing identity from the route,
current client authority or a generated request. Canonical payload correctness
remains the endpoint/SQL owner's check. Nonqualifying input visibly refuses
before forwarding and makes no durable-capture claim. The caller must retain
its original request; this source cannot restore a missing old-browser draft.

The original JSON/UTF-8 bytes go to
`production-write?action=legacy_intake_receive` without adding action to the
body. The existing public intake transport binding supplies only apikey and
Bearer headers; no staff/actor headers or new credentials are created. Binding
permits an existing public publishable key or legacy JWT with role `anon`, and
rejects service/secret keys. Existing public-intake flag, unique active-client
resolution and rate capability remain the gateway's authority. JSON MIME,
single optional UTF-8 charset, no compression, raw byte availability and size
checks reuse the pinned CARD transport guard. No redirect, retry or old-tail
fallback occurs on failure.

The generated response checker contains the pinned actual browser
`_linearUuid`, `_linearResponseParentId`, `_linearConfirmedCreate` and
`_linearConfirmedReceived` functions. Only an exact received receipt with real
durable capture, required triage, pending/failed/partial ledger and safe reason
codes returns 202. Historical created returns 200 only with matching original
identity, valid parent and exact expected unique child set. Error JSON/status
remains terminal; timeout, redirect or malformed success becomes an unconfirmed
503 with no false capture claim. No branch reaches the old receipt/provider/
notification/discovery tails.

This binds the separate gateway/native-triage source lane (through
`9a33d95c3171b99419cd6b2f4c5d3a54a0b3f749`), not a deployed endpoint:

| Required source | SHA-256 |
|---|---|
| `production-write/index.ts`, `handleLegacyIntake` and query-action dispatch | `c82489a8710a08d0df7a0fd79d904d31e8b3b803876b409241ca8219686a59ad` |
| `2026-09-07-legacy-intake-native-triage.sql`, including the provider-INSERT advisory fence | `1faf9a28114124ac5631db4d7561c514e19615ad60806afdd902ba335d484831` |
| Actual browser receipt validators | `ccb973dfe1e8f4f30a39c3eda323e9a347ed97f92185b9ea96281e316119ffb4` |

Use `N8N_F44_ADAPTER_BINDING` for an absolute private JSON file and
`N8N_F44_ADAPTER_OUTPUT` for a new private output directory, then run
`node scripts/n8n-f44-native-adapter.js`. Binding fields are `sourceBase`
(`2fdf2b8a188411d0fbfba776bba7156b496d102b`), `browserValidatorsSha256`,
`verifiedN8nVersion` (`2.37.7`), absolute `capturePath`, `captureSha256`,
`expectedActiveVersion`, `endpointContract` (`legacy_intake_receive-v1`), the
two endpoint source hashes above, `destinationOrigin` and existing `anonKey`.
The source hash field names are `endpointSourceSha256` and
`endpointMigrationSha256`. All private paths and generated graphs stay outside
every enclosing Git repository. Output is `f44.draft.json` plus a hash receipt,
with `activationAllowed:false`. No public workflow IDs, endpoint values, keys,
raw captures or execution data are published by this preparation.

Validation: **19 local synthetic controls**, suitable for CI, pass via
`node test/n8n-f44-native-adapter.js`. **17 separate private extracted-source
controls** pass against the exact published graph and pinned n8n parser/Webhook/
binary request/text-response code with synthetic contexts. Both captured F44
normalizers accept the original nine-key envelope with exact canonical video
fields (`number`, `main_cam`, `side_cam`, `audio`, nullable `dueDate`) and refuse
missing receipt identity. Whitespace/multibyte bytes, MIME rewriting negatives,
strict browser responses and terminal errors are covered. The final SQL binding
changed metadata only; exact graph equality preserves that 17-control proof.
Final private draft SHA-256:
`c94407d70e63e4ae37c76ca810ab4818e3fcd20665c020a35186011d56b10467`.
No hosted CI, installed n8n engine, gateway/SQL or live acceptance proof is
claimed by these graph tests; the separate endpoint lane owns its SQL evidence.

Installation remains held until the exact gateway/SQL/native-triage source is
reviewed, deployed and verified, both published route/version bindings are
refreshed, and authorized old-caller/inbox/ordinary-flow tests pass. Existing
historical `created` receipts retain the old browser's provider-discovery
continuation; this adapter neither invents a native replacement identity nor
closes that remaining compatibility limit. Reverting these two entries to old
provider tails is not a safe post-cutoff recovery.

## Release and rollback boundary

G6 remains held until these serving adapters and actual old-caller tests exist.
No unused historical export is required by this slice. Source withdrawal before
serving is reversible; after serving, retain this ownership routing and all
accepted records. Returning to the b60 selector can redirect saved native work
to F44 again. Adapter rollback must keep native-compatible receipt readers and
conserved debt; never restore a provider default after the provider cutoff.
