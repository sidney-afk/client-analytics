# Native card HTTP adapter — held source preparation

Base: `8514a83ed1a65145a3a51ffe52e5fcbb2976be31` (PR1324). This is the next bounded G3 slice under the [canonical plan](../independence/GO_LIVE_CHECKLIST.md), not an activation or alternate execution plan. No browser, SQL, corpus, workflow, credential, flag or n8n changes.

## Actual source boundary

`nativeCardSource` selects only the delivered `x-syncview-source` values `submission-native`, `calendar-native`, and `samples-native`. The marker is neither authentication nor accepted-intent authority. Each endpoint fixes its own surface, regardless of the marker's spelling. The unchanged repository `authorizeBrowserWrite` runs before `materializeNativeCard`; the raw client's exact spelling must match that authorized normalized scope and the raw card ID must match the handler ID. A generated fallback ID cannot become native authority.

Both handlers return from this branch before old reads, twin checks, comment merges, scalar writes, thumbnail work or event insertion. `production_card_materialize` is called once; no refusal or uncertain result reaches another transport. Ordinary source markers, including component fill, continue through their original code. The shared browser authorization file and both complete legacy handler bodies, after removing only this addition, match the pinned base bytes with line endings normalized for the offline comparison.

`readNativeCardRequest` counts streamed bytes up to 1,048,576 and bounds reading to ten seconds. It decodes UTF-8 fatally with BOM preservation; BOM-bearing JSON is explicitly refused rather than silently stripped. Valid whitespace, split multi-byte characters and duplicate JSON keys remain in the original text passed to SQL; scope validation uses the parsed final key values. Compressed, malformed, oversized and incomplete input is refused before dispatch. This describes the bytes delivered to the handler, not a proxy's unseen earlier wire representation.

| Outcome | HTTP and response | What is actually proved |
|---|---|---|
| Pre-dispatch body/scope refusal | 400, 408 or 413; `ok:false`, `conserved:false` | This adapter did not send the materialization RPC. Existing authorization refusals retain their original response and make no new conservation claim. |
| Confirmed retained hold | 409; `ok:false`, `outcome:held`, `conserved:true` | A recognized SQL hold includes its retained-ingress receipt. The card is not acknowledged. |
| Created or exact replay | 200; `ok:true`, `conserved:true`, complete current `post` or `sample` | SQL supplied its receipt and complete known card schema, exact client/card and both original native child slots. Empty-string/null absence is equivalent, but an empty slot cannot acquire an unexpected child. Nullable columns remain nullable; later human content is returned unchanged. |
| RPC error, lost/invalid response, incomplete or contradictory success | 503; `ok:false`, `outcome:unknown`, `conserved:null` | Acceptance and ingress retention are unknown. Retain the original request and inspect receipts before any repair. No retry inside the handler or legacy fallback occurs. |

The SQL ingress ID, arbitrary SQL metadata and raw errors are not exposed by the adapter. Native-path logs contain only function/action, bounded outcome and duration, with no card/client/actor fields. The returned current card is the intended surface response, not a public audit artifact. The response checker requires the existing schema's known fields and accepts legitimate nulls; future schema changes require updating this contract and its tests.

## Evidence and limits

`node test/native-card-materialization-adapter.js`: **70 OFFLINE_TEST groups PASS** after the bounded empty-slot correction below (original `e4b56f582aa5c03e74b3bc93a35c0d362670c9d4`: 66 PASS). This uses real Web Request/stream primitives and the actual shared module with synthetic RPC responses. It covers raw-byte boundaries, fatal/BOM handling, duplicate keys, stalled streams, one-call unknown outcomes, zero-call local refusals, scoped complete nullable responses, and exact ordinary-source/auth conservation. Its table-shaped responses derive from the existing schema declaration, not the adapter's field list.

**Preserved independent negative:** at exact `e4b56f582`, an actual loopback HTTP replay accepted a response-only mutation that added a graphics child to a video-only card (8 earlier groups passed; this new assertion failed). The underlying real SQL replay and card state were unchanged. The original checker compared only occupied slots. The correction compares both slots with empty-string/null normalization; four new offline groups cover the opposite-slot refusals on both surfaces and healthy thumbnail-only null absence. This is malformed-response defense, not evidence that the actual SQL returns wrong linkage. Independent corrected HTTP proof remains a separate result; neither this change nor the original SQL evidence is serving proof.

Four existing affected suites pass: `browser-writer-auth.js`, `calendar-upsert-edge-source.js`, `calendar-upsert-routing.js`, and `sample-review-upsert-twins-guard.js`. These are source/offline checks, not serving or live-client proof. Independent actual HTTP/disposable SQL proof is owned separately; this document does not anticipate its result. No full-suite or Deno deployment/typecheck claim is made here.

**Serving remains UNPROVEN.** The repository auth blocks differ from the historically captured anonymous Calendar v48/Samples v49 bodies. Preserving repository authorization is not permission to deploy those blocks onto the frozen anonymous writers. The independent derived-serving fixture, if it passes, will establish isolated compatibility only; it cannot establish a deployed revision or authorize a re-gate.

**Automatic creation remains held.** Both verified n8n bypasses still normalize away native markers/IDs and write directly. Their owner-approved compatible amendment, unknown-job conservation and rollback proof remain required. This adapter makes no n8n change and cannot prevent an old browser's fallback request from reaching those routes. The browser's bounded retry/expiry behavior also remains unchanged; a known held raw card request is not a complete original intake/media backup.

## Order and rollback

Before any future installation, review a compatible serving-source composition preserving anonymous authorization, install and verify the existing SQL/receipt/provenance/journal and selected37 recovery dependencies, prove both legacy transports, and repeat the designated client/staff tests with exact serving hashes. This source slice supplies no deployment command or approval.

While preparing this branch, clients see the existing deployed site because no public runtime changes are made. After a future approved installation, native creation may return a visible hold or uncertain result while ordinary client approvals/comments/tweaks retain their existing transport. These future statements require the deployment and fallback gates above; they are not present client-journey measurements.

Before any real native acceptance, an uninstalled source patch can be abandoned. After acceptance, hold new admission and preserve the compatible receipt-returning adapter and all retained owners. Reverting to an old full-row materializer could overwrite later edits, so it is not a safe operational rollback. No data is deleted by this slice.
