# Real check output

Browser runs use intercepted fictional transports. A private network-denial preload prevents accidental live reads/writes. The unit runner also supplies its normal single-file-index preload. Identity alone uses the authorised roster names/slugs comparison. Native capture provenance and latest-main application-byte equivalence are recorded alongside the desktop diffs.

## npm run check:index

```text
check-index: working-tree index.html — sha256=bb71e2577c6905cff383bec6032c073e0e672bff93867cdca4904803efe34f5b bytes=1374724
check-index: committed index.html (HEAD) — sha256=bb71e2577c6905cff383bec6032c073e0e672bff93867cdca4904803efe34f5b bytes=1374724

check-index: OK — assembled == working tree == committed (HEAD)
```

## node test/run-all.js

```text
18 of 729 unit suite(s) failed ❌
failed suites: test/client-onboarding-handler.js, test/clean-urls-routes.js, test/b2-brief-link-rewrite.mjs, test/alert-digest.js, test/analytics-market-research-collect-function.js, test/analytics-metrics-collect-function.js, test/analytics-top-videos-collect-function.js, test/brain-parse.js, test/client-profile-edit.js, test/client-reconcile-after-posted.js, test/filming-plan-tabs-source.js, test/key-verify-behavior.js, test/overnight-runner-output-path.js, test/overnight-runner-singleton-lock.js, test/production-write-card-link.js, test/track-b-recovery-v7-preparation.js, test/urgent-ping-fresh-round.js, test/write-refusal-browser-codes.js
```

## node docs/syncview-design/tests/prod-write-gateway-browser.js

```text
prod-write-gateway-browser: mirror operations plus Submit and Calendar native intake passed
```

## node qa/staff-phone-tabs-grid.js

```text
STAFF_PHONE_TABS_GRID: 200 twice-opened states; 0 failures; native icons/order/current tab; fictional transports only
```

## node scripts/check-modules.js

```text
check-modules: all checks passed
```

## node test/no-hardcoded-colors.js

```text
No hardcoded color literals outside allowed variable/validation blocks.
```

## node test/*phone-css-scope.js (each of the seven files individually)

```text
client-phone-css-scope: OK (6 block(s), 464 braces, all under @media (max-width: <=767px) and html.boot-client)
finch-phone-css-scope: OK (1 block(s), 446 braces, all under @media (max-width: <=767px) and html.fph-on)
kasper-phone-css-scope: OK (1 block(s), 24 braces, all under @media (max-width: <=767px) and the Kasper review scope)
staff-calendar-phone-css-scope: OK (1 block(s), 410 braces, all under @media (max-width: <=767px) and #calView[data-pocket-staff-phone])
staff-phone-css-scope: OK (1 block(s), 372 braces, all under @media (max-width: <=767px) and body:has(.pocket-staff-bar))
staff-samples-phone-css-scope: OK (1 block(s), 352 braces, all under @media (max-width: <=767px) and #sxrView[data-pocket-staff-samples])
staff-selection-phone-css-scope: OK (1 block(s), 30 braces, all under @media (max-width: <=767px) and #calView[data-pocket-staff-phone])
```

## node test/staff-phone-rules-source.js

```text
staff-phone-rules-source: artifact CSS/JS transplanted byte-identically; 128 rules phone-capped and staff-scoped
```

## node qa/staff-phone-round-two.js --matrix --widths=360,390,430

```text
STAFF_PHONE_ROUND_TWO: 6 width/theme journeys; 216 sheet dismissals; 0 failures; fictional data only
```

## node qa/staff-phone-rules-browser.js

```text
STAFF_PHONE_RULES: 160 states; 0 failures; 390/430 touch; synthetic transports; no live writes
```

## node qa/staff-phone-final-pass.js --all-states --widths=390,430 --only=<Calendar/Samples/Today/Linear/menu states>

```text
staff-phone-final-pass: 156 renders, 0 problems
```

## node docs/syncview-design/tests/shared-client-browser.js

```text
shared-client: PASS
```

## node --require ./test/helpers/single-file-index.js qa/pto-lifecycle/run.js

```text
PTO lifecycle mocked lane passed: 101 action/result screenshots; 35 coverage gates.
Artifacts: <private PTO capture directory>
```

## node --require ./test/helpers/single-file-index.js qa/pto-lifecycle/run.js --update-public

```text
PTO lifecycle public evidence updated atomically: 101 reviewed screenshots.
Artifacts: docs/audits/2026-07-17-pto-lifecycle-simulation
```

## node --require ./test/helpers/single-file-index.js test/leave-evidence-fingerprint-coupling.js

```text
leave-evidence fingerprint coupling checks passed
```

## node test/phone-round-two-ci-safety.js

```text
phone-round-two-ci-safety: this PR cannot start the live Production lane; existing other event policies preserved
```

## node test/repo-map-sync.js

```text
repo-map-sync: 1168 passed, 0 failed
```

## Desktop parity: full staff run at 1024/1280/1440/1920

```text
47/48 desktop shots identical to origin/main
```

## Desktop parity: focused unchanged-source replay

```text
1/1 desktop shots identical to origin/main
```

## Desktop parity: unchanged-main control

```text
1/1 desktop shots identical to origin/main
```

## Limits and retained failures

The full unit lane remains red on the same eighteen Windows/setup suites individually reproduced on unchanged main; this is not called a green unit run. The earlier nineteenth failure was stale PTO evidence and is now fixed under the CI preload.

The first desktop run was 47/48; the remaining Filming Plans capture matched exactly in a focused replay without source changes. An unchanged-main control also needed a retry before matching. No pixel tolerance or masks were introduced. All 48 final pairs have identical native PNG bytes and computed styles; their public difference images contain zero changed pixels. Main advanced during the run; the rebased baseline application paths and index bytes are identical to the captured baseline (see desktop/latest-main-equivalence.json).

The PTO refresh contains 101 reviewed screenshots, with two retained warnings: the PTO-only fixture does not supply Today behind its open menu, and its synthetic banner partly overlaps the calendar heading. No live defect is inferred from either.

An additional review-image assertion first required filter:none and failed on the existing brightness(0.75) readability treatment. It now checks the actual rule: no blur, containment and natural proportions. Product source did not change during that correction. The final expanded-review matrix is reported above. Earlier failing receipts remain private.

The hosted Production live lane is explicitly NOT_RUN for this PR because it lacks a test-client-only boundary. Physical devices, Safari and deployed behaviour are not tested.

Focused latest unchanged-main reproduction, at 75fcedab3576fd5c36767457b2cc1ea5e95709b3:

```text
UNCHANGED_MAIN: 18/18 named Windows failures reproduced
```

The identity check is run after the final commit. Its real output is recorded in the PR and handoff.
