# Calendar/Samples live refusal retention

Bounded G6 source preparation from `d1442f65c4da6dc4e5ef8f155e1465f564cafa5e` under the existing [execution checklist](../independence/GO_LIVE_CHECKLIST.md). Unmerged, unserved and not a release authorization. The [September6 retention evidence](2026-09-06-native-intake-retention.md) remains its own historical checkpoint.

## Correction

The actual `_calSubmitNativePost` previously deleted an unheld pending request after a 4xx when no accepted result had reached the browser. A modeled receiver accepts an initial request and loses its response; a later 409 then reproduces the original identity deletion on both Calendar and Samples at the unchanged base. This is browser-source/model-receiver evidence, not evidence of a production incident or server idempotency.

The same catch now reacquires the existing native-intake Web Lock and holds only the still-unacknowledged request with the same request ID, exact payload and exact initiating context. The existing actor guard runs again under the lock. A replacement, accepted result, changed actor/role, unavailable lock or failed storage leaves the current/prior record intact. No accepted result is invented and no request is deleted. The existing error area offers **Retry saved post** only through its unchanged owner/view/record checks. Automatic recovery pauses; deliberate recovery uses the original payload and request ID. Completion is displayed only after the existing runner finishes successfully.

All 4xx values remain refusals. This browser contract has no authoritative proof that an earlier attempt with that identity was never accepted, including when the latest response rejects validation or authentication. Therefore no status is treated as permission to recreate the work. A permanently refused request can continue to occupy the existing single slot until authoritative recovery is available. The original 5xx, malformed-success and network-failure behavior is unchanged.

If holding fails because storage or the Web Lock is unavailable, retaining the prior record proves neither a durable hold nor server backup. It remains in its previous state, including the previous automatic retry eligibility; the catch does not report that retries paused or display a saved-retry action unless a held record is actually read back.

Sign-out scrubbing/privacy, shared retry thresholds, receipt validation, native identity construction, writer/card transports, frozen anonymous writers, authentication, SQL, flags and legacy/n8n routes are unchanged.

## Finite checks

`node test/native-intake-retained-refusals.js` passes **59 groups** classified **OFFLINE_ACTUAL_SOURCE**, with five preserved baseline deletions (three older retry-limit controls and the two new exact-base live-click controls). The new cases exercise real pending selection, caller, runner, lock and catch functions. They cover 400/401/403/409/422 on both surfaces, exact retry payloads, background hold, lost-response/409 sequences, different-ID and same-ID replacements, changed context, accepted progress, actor/role changes, quota and missing locks. Gateway/card transport and lock scheduling are synthetic; no real backend is contacted.

The helper extraction now includes `_linearIntakeActorContext`. Its previous omission could make the older live-click cases exit before reaching the gateway. New live-click controls explicitly require the gateway attempt and its exact payload, so this early return cannot pass as a tested server refusal. Earlier published evidence is not relabeled as stronger proof.

Also passed: `node test/native-intake-ui-source.js`, `node test/extract-function-integrity.js`, `node test/repo-map-sync.js`, `node test/truth-sync.js`, and `git diff --check`. `node test/native-intake-editor-projection.js` explicitly **SKIPPED** its unbound disposable PostgreSQL lane; it is not counted as runtime proof. No full suite, Chromium fleet, hosted run, installed writer or real-client journey was run for this correction.

## Review and recovery instructions

Independently review the frozen source and these finite controls before integration into the combined candidate. Combined hosted validation, exact serving and controlled TEST journeys remain separate release gates; this source does not close G6 or authorize any deployment.

If this correction is later served, keep the affected browser record and use only the same-owner saved-request action. Refusal remains unconfirmed completion; do not recreate the post, regenerate its identity or clear storage as recovery. A stuck request needs authoritative acceptance/current-card evidence before any replacement action. Sign-out privacy still removes unacknowledged sensitive payloads; this correction does not provide durable server backup or restore that missing recovery contract.

Before serving, this isolated source can be withdrawn without changing clients. After use, retain compatible hold/retry behavior and the original records until reconciled; restoring the old deletion catch can erase retained work. Old bundles, browser eviction/corruption, v1 actorless debt, provider in-flight uncertainty and both n8n bypasses remain outside this correction.
