# Real check tails

All browser runs use a private network-denial preload in addition to intercepted fictional transports. Live app/client reads and writes are refused. The authorized identity script alone reads roster names/slugs for its diff scan. Output-directory, font/dependency and private preload arguments are omitted from the displayed commands. The lines below come from actual logs.

## Generated build

`npm run build:index`

```text
build-index: wrote index.html (1362425 bytes) from 67 fragment(s)
build-index: wrote src/index/INDEX.md
```

## Committed index

`npm run -s check:index`

```text
check-index: working-tree index.html — sha256=cbea688b91f185218e99e98c3d89b7f1407ee7be0dccbfb179c492dd15fc90a1 bytes=1362425
check-index: committed index.html (HEAD) — sha256=cbea688b91f185218e99e98c3d89b7f1407ee7be0dccbfb179c492dd15fc90a1 bytes=1362425

check-index: OK — assembled == working tree == committed (HEAD)
```

## Module integrity

`node scripts/check-modules.js`

```text

check-modules: all checks passed
```

## Phone colours

`node test/no-hardcoded-colors.js`

```text
No hardcoded color literals outside allowed variable/validation blocks.
```

## Phone CSS scopes

`node test/*phone-css-scope.js (each matching file)`

```text
client-phone-css-scope: OK (6 block(s), 464 braces, all under @media (max-width: <=767px) and html.boot-client)
finch-phone-css-scope: OK (1 block(s), 446 braces, all under @media (max-width: <=767px) and html.fph-on)
kasper-phone-css-scope: OK (1 block(s), 24 braces, all under @media (max-width: <=767px) and the Kasper review scope)
staff-calendar-phone-css-scope: OK (1 block(s), 410 braces, all under @media (max-width: <=767px) and #calView[data-pocket-staff-phone])
staff-phone-css-scope: OK (1 block(s), 372 braces, all under @media (max-width: <=767px) and body:has(.pocket-staff-bar))
staff-samples-phone-css-scope: OK (1 block(s), 352 braces, all under @media (max-width: <=767px) and #sxrView[data-pocket-staff-samples])
staff-selection-phone-css-scope: OK (1 block(s), 30 braces, all under @media (max-width: <=767px) and #calView[data-pocket-staff-phone])
```

## Scoped artifact

`node test/staff-phone-rules-source.js`

```text
staff-phone-rules-source: artifact CSS/JS transplanted byte-identically; 86 rules phone-capped and staff-scoped
```

## PTO evidence coupling

`node --require ./test/helpers/single-file-index.js test/leave-evidence-fingerprint-coupling.js`

```text
leave-evidence fingerprint coupling checks passed
```

## Hosted read policy

`node test/phone-tabs-ci-read-boundary.js`

```text
phone-tabs-ci-read-boundary: protected PR cannot start live Production fast lane; other event policies preserved
```

## Every staff menu

`node qa/staff-phone-tabs-grid.js --widths=360,390,430`

```text
STAFF_PHONE_TABS_GRID: 300 twice-opened states; 0 failures; native icons/order/current tab; fictional transports only
```

## Unit suite

`node test/run-all.js`

```text
18 of 726 unit suite(s) failed ❌
failed suites: test/client-onboarding-handler.js, test/clean-urls-routes.js, test/b2-brief-link-rewrite.mjs, test/alert-digest.js, test/analytics-market-research-collect-function.js, test/analytics-metrics-collect-function.js, test/analytics-top-videos-collect-function.js, test/brain-parse.js, test/client-profile-edit.js, test/client-reconcile-after-posted.js, test/filming-plan-tabs-source.js, test/key-verify-behavior.js, test/overnight-runner-output-path.js, test/overnight-runner-singleton-lock.js, test/production-write-card-link.js, test/track-b-recovery-v7-preparation.js, test/urgent-ping-fresh-round.js, test/write-refusal-browser-codes.js
```

## Native mocked saves

`node docs/syncview-design/tests/prod-write-gateway-browser.js`

```text
prod-write-gateway-browser: mirror operations plus Submit and Calendar native intake passed
```

## Required identity diff (after commit)

`node scripts/repo-identity-exposure-check.js --diff="origin/main"`

```text
  WHERE (counts only — this tool never prints what it matched):

This change adds no client slug and no colleague's name ✅
```

## Unchanged-main desktop control

`PARITY_CONTROL=1 PARITY_ONLY=staff-navHome PARITY_W=1280 node qa/client-phone/desktop-parity.js --staff-only`

```text
FAIL staff-navHome @1280: pixels DIFFERENT, computed styles identical (b1a5091e4d25, attempts 4)

0/1 desktop shots identical to origin/main
```

## Exact Analytics desktop replay

`PARITY_ONLY=staff-navHome PARITY_W=1280 node qa/client-phone/desktop-parity.js --staff-only`

```text
ok   staff-navHome @1280: pixels identical, computed styles identical (ff11f590fec4)

1/1 desktop shots identical to origin/main
```

## Exact reviewer desktop replay

`PARITY_ONLY=staff-navKasper PARITY_W=1280 node qa/client-phone/desktop-parity.js --staff-only`

```text
ok   staff-navKasper @1280: pixels identical, computed styles identical (90cd86e44f09, attempts 3)

1/1 desktop shots identical to origin/main
```

## Preserved failures and limits

- The 18 named unit failures are the same previously reproduced on unchanged main in the #2047 comparison; no new unit failure was added. They are not called green. The new CI read-boundary unit test passes and is registered in the unit lane.
- One initial disabled-control probe waited for Playwright to consider an intentionally disabled fixture link enabled. The probe was corrected to force a physical tap so the application's own refusal is tested. That failed invocation is retained privately.
- The first shared CSS artifact check rejected the comma inside a `:is` selector because its existing parser splits selector lists simply. The rule was written as two explicit, fully scoped selectors; the guard was not loosened.
- The late-permission refresh initially used a suffix selector that stopped matching after the shared body class was added. The hidden/disabled-tab probe caught that product bug; explicit native body classes fix it. The corrected menu matrix passes 300 twice-opened states at 360/390/430.
- Full inventory runs passed 318 renders at each width but timed out on four Calendar/Samples Tabs probes: the old probe looked for a button with the legacy reviewer name, while the new grid preserves native links and uses the reviewer role label. The inventory now selects the native destination ID, asserts its role label, and includes grid links in its 44 px measurement. All Tabs cases are rerun below. The other 318 unchanged cases retain their successful full-run proof; no complete corrected rerun is claimed. These stale-locator failures are caused by this PR's markup change, not described as unchanged-main failures.
- Public-role normalization initially assigned unchanged text nodes and could wake layout observers in the captured reviewer view. It now changes only matching role text and retains the original role label across captures. Final screenshots were reviewed after that correction; no screenshot pixels were hand-edited.
- Desktop runs included 46/48 and 47/48 results with exact computed styles but small scattered text-raster differences. The same fast gate also fails when comparing unchanged main against itself. Focused actual-source replays matched Analytics and reviewer exactly. There is no tolerance or mask; earlier failures and the unchanged-main control remain recorded rather than called passing.
- A private text-rendering flag experiment still needed exact retries and was not adopted. Browser launch settings and the pixel comparator remain unchanged.
- A module command without the external parser dependency exited 2; the correctly configured invocation passes. No package dependency was changed to hide it.
- Production fast hosted CI is deliberately NOT RUN for this branch: its unchanged live-reading path violates this task's read boundary. The job condition and regression test prevent it starting before any PR browser operation. Other existing event policies are unchanged. This is explicit deferral, not a passing live proof.

No physical-device, deployed-build or real-client-save proof is claimed. No merge, deployment, database or n8n edit occurred.

## Final required phone and desktop lanes

### Phone rules

`node qa/staff-phone-rules-browser.js --widths=390,430`

```text
STAFF_PHONE_RULES: 160 states; 0 failures; 390/430 touch; synthetic transports; no live writes
```


### Full phone inventory at 390, before correcting the stale locator

`node qa/staff-phone-final-pass.js --all-states --widths=390`

```text
ok calendar-caption-prompt-empty 390 light
ok calendar-caption-prompt-empty 390 dark
staff-phone-final-pass: 318 renders, 4 problems
```


### Full phone inventory at 430, before correcting the stale locator

`node qa/staff-phone-final-pass.js --all-states --widths=430`

```text
ok calendar-caption-prompt-empty 430 light
ok calendar-caption-prompt-empty 430 dark
staff-phone-final-pass: 318 renders, 4 problems
```


### Corrected Tabs inventory at both widths

`node qa/staff-phone-final-pass.js --all-states --widths=390,430 --only=tabs`

```text
ok calendar-alt-caption-tabs 430 light
ok calendar-alt-caption-tabs 430 dark
staff-phone-final-pass: 20 renders, 0 problems
```


### Final full desktop gate

`node qa/client-phone/desktop-parity.js --staff-only`

```text
ok   staff-time-off @1920: pixels identical, computed styles identical (d4bf0f603e75)

47/48 desktop shots identical to origin/main
```


### Exact remaining desktop pair

`PARITY_ONLY=staff-navHome PARITY_W=1024 node qa/client-phone/desktop-parity.js --staff-only`

```text
ok   staff-navHome @1024: pixels identical, computed styles identical (96a624a3d0e2)

1/1 desktop shots identical to origin/main
```


### Repository map

`node --require ./test/helpers/single-file-index.js test/repo-map-sync.js`

```text
repo-map-sync: 1156 passed, 0 failed
```

[Desktop exact-pair hashes and zero-difference PNGs](desktop/parity.json): 48 exact pairs from the final source. The full run is 47/48; the remaining Analytics 1024 pair is 1/1 on the explicit focused replay. The full run matched all computed styles. The gate and screenshot comparator were not altered.
