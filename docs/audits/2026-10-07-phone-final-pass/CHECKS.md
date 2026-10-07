# Check output and limits

These are the real final output lines, including failures. Browser commands used
the retained visible Chrome session via a private launch adapter. Original runners
and assertions were kept. Credentials stayed in memory.

The complete Production polish gate ran all 21 suites: 18 passed, three failed.
Its phone clipping failures were fixed and the focused layout suite rerun. The
gateway editor-size and board-width failures also occur on unchanged main; pending
reads also fail the unchanged-main behavior check. The unit baseline comparison is
in [unit-baseline.json](unit-baseline.json). No failing gate is called green here.

## `npm run -s check:index`

PASS

```text
check-index: assembled bytes — sha256=302fc0282feb06f7a3e6b0ac9e2d131a74aaac995c350d2e5d63d2b60847e350 bytes=1278506
check-index: working-tree index.html — sha256=302fc0282feb06f7a3e6b0ac9e2d131a74aaac995c350d2e5d63d2b60847e350 bytes=1278506
check-index: committed index.html (HEAD) — sha256=302fc0282feb06f7a3e6b0ac9e2d131a74aaac995c350d2e5d63d2b60847e350 bytes=1278506

check-index: OK — assembled == working tree == committed (HEAD)
```

## `node scripts/check-modules.js`

PASS

```text
minified parts: 19 files, 2603 KB, 5115 top-level names, 0 lost, 0 changed kind

check-modules: all checks passed
```

## `node scripts/repo-identity-exposure-check.js --diff=origin/main`

PASS

```text
  WHERE (counts only — this tool never prints what it matched):

This change adds no client slug and no colleague's name ✅
```

## `node test/no-hardcoded-colors.js`

PASS

```text
No hardcoded color literals outside allowed variable/validation blocks.
```

## `node test/client-phone-css-scope.js`

PASS

```text
client-phone-css-scope: OK (6 block(s), 458 braces, all under @media (max-width: <=767px) and html.boot-client)
```

## `node test/finch-phone-css-scope.js`

PASS

```text
finch-phone-css-scope: OK (1 block(s), 367 braces, all under @media (max-width: <=767px) and html.fph-on)
```

## `node test/kasper-phone-css-scope.js`

PASS

```text
kasper-phone-css-scope: OK (1 block(s), 24 braces, all under @media (max-width: <=767px) and the Kasper review scope)
```

## `node test/staff-calendar-phone-css-scope.js`

PASS

```text
staff-calendar-phone-css-scope: OK (1 block(s), 396 braces, all under @media (max-width: <=767px) and #calView[data-pocket-staff-phone])
```

## `node test/staff-phone-css-scope.js`

PASS

```text
staff-phone-css-scope: OK (1 block(s), 360 braces, all under @media (max-width: <=767px) and body:has(.pocket-staff-bar))
```

## `node test/staff-samples-phone-css-scope.js`

PASS

```text
staff-samples-phone-css-scope: OK (1 block(s), 344 braces, all under @media (max-width: <=767px) and #sxrView[data-pocket-staff-samples])
```

## `node test/staff-selection-phone-css-scope.js`

PASS

```text
staff-selection-phone-css-scope: OK (1 block(s), 30 braces, all under @media (max-width: <=767px) and #calView[data-pocket-staff-phone])
```

## `node --require ./test/helpers/single-file-index.js test/leave-evidence-fingerprint-coupling.js`

PASS

```text
  ok  and over the same file set, so the copy above has not drifted from it

leave-evidence fingerprint coupling checks passed
```

## `node docs/syncview-design/tests/prod-write-gateway-browser.js`

FAIL; same editor-size assertion reproduced on pristine main

```text
--- phase: inplace_place ---
Error: PWG_PHASE_INPLACE_PLACE the editor does not sit exactly where the read view sat, at the same size and type: {"readBox":{"left":271,"top":301,"width":697,"height":68,"font":"15px/24px","clickEdit":true},"editBox":{"left":271,"top":301,"width":682,"height":92,"font":"15px/24px","focused":true,"overflow":"visible","maxHeight":"none","caret":{"block":0,"offset":9},"blocks":["prod-md-heading:22:block","prod-md-p prod-md-gap:0:none","prod-md-p:24:block","prod-md-p:24:block"]}}
    at expect (D:\Sidney\Codex\2026-10-05-pocket-phone-polish-1\docs\syncview-design\tests\prod-write-gateway-browser.js:81:53)
    at D:\Sidney\Codex\2026-10-05-pocket-phone-polish-1\docs\syncview-design\tests\prod-write-gateway-browser.js:1546:5
```

## `node test/run-all.js`

FAIL; same 17 failing suites reproduced on pristine main

```text

17 of 681 unit suite(s) failed ❌
failed suites: test/client-onboarding-handler.js, test/clean-urls-routes.js, test/b2-brief-link-rewrite.mjs, test/alert-digest.js, test/analytics-market-research-collect-function.js, test/analytics-metrics-collect-function.js, test/analytics-top-videos-collect-function.js, test/brain-parse.js, test/client-profile-edit.js, test/client-reconcile-after-posted.js, test/filming-plan-tabs-source.js, test/key-verify-behavior.js, test/overnight-runner-output-path.js, test/overnight-runner-singleton-lock.js, test/production-write-card-link.js, test/urgent-ping-fresh-round.js, test/write-refusal-browser-codes.js
```

## `node qa/client-phone/desktop-parity.js`

PASS

```text
ok   client-sample-reviews @1920: pixels identical, computed styles identical (8efa8351f7c9)

72/72 desktop shots identical to origin/main
```

## `node docs/syncview-design/tests/staff-calendar-expanded-browser.js`

PASS

```text
staff-calendar-expanded: OK (9540 checks; Review/Sheet/Month/Week, light/dark, menus/dialogs, loading/empty/error/saving, desktop restore; 360/390/430).
```

## `node docs/syncview-design/tests/staff-selection-samples-browser.js`

PASS

```text
staff-selection-samples: OK (5334 checks; Selection, Samples Review/Sheet, light/dark, dialogs, loading/empty/error/saving and desktop restore; 360/390/430).
```

## `node qa/staff-phone-final-pass.js --only=sheet-tabs --widths=390`

PASS; native action dispatches exactly once

```text
ok sheet-tabs 390 light
ok sheet-tabs 390 dark
staff-phone-final-pass: 2 renders, 0 problems
```

## `node qa/staff-phone-final-pass.js --only=^(linear-project|sheet-tabs)$`

PASS; native selection activates and clears at all three widths in both themes

```text
staff-phone-final-pass: 12 renders, 0 problems
```

## `node qa/staff-phone-final-pass.js --only=linear-detail`

PASS; native parent breadcrumb returns on desktop without rebuilding the issue

```text
staff-phone-final-pass: 6 renders, 0 problems
```

## `node qa/staff-phone-final-pass.js --only=^(tiktok|instagram)-client-ready$`

PASS; browse copy restores without replacing the file chooser

```text
staff-phone-final-pass: 12 renders, 0 problems
```

## `node --require ./test/helpers/single-file-index.js qa/pto-lifecycle/run.js`

PASS

```text
PTO lifecycle mocked lane passed: 101 action/result screenshots; 35 coverage gates.
Artifacts: .codex-tmp/pto-lifecycle/latest
```

## `node --require ./test/helpers/single-file-index.js qa/pto-lifecycle/run.js --update-public`

PASS

```text
PTO lifecycle public evidence updated atomically: 101 reviewed screenshots.
Artifacts: docs/audits/2026-07-17-pto-lifecycle-simulation
```

## `node --require ./test/helpers/single-file-index.js qa/pto-lifecycle/run.js --validate-public-evidence`

PASS

```text
PTO public evidence passed without a browser: 101 reviewed screenshots; current source fingerprint and hashes match.
```

## `node docs/syncview-design/tests/prod-layout-polish.js`

FAIL; no clipping or parent-trail assertions remain; board-width and pending reads retained

```text
Error: prod-layout-polish failures:
  - desktop project board should give empty and non-empty columns the same readable lane width
  - [plp_console_errors] desktop console/page errors: pending read requests: [{"host":"docs.google.com","path":"","queryKeys":["tqx","sheet"],"outcomes":["pending"]},{"host":"docs.google.com","path":"","queryKeys":["tqx","sheet"],"outcomes":["pending"]}]
  - [plp_console_errors] compact-desktop console/page errors: pending read requests: [{"host":"docs.google.com","path":"","queryKeys":["tqx","sheet"],"outcomes":["pending"]},{"host":"docs.google.com","path":"","queryKeys":["tqx","sheet"],"outcomes":["pending"]}]
  - [plp_console_errors] mobile console/page errors: pending read requests: [{"host":"docs.google.com","path":"","queryKeys":["tqx","sheet"],"outcomes":["pending"]},{"host":"docs.google.com","path":"","queryKeys":["tqx","sheet"],"outcomes":["pending"]}]
    at D:\Sidney\Codex\2026-10-05-pocket-phone-polish-1\docs\syncview-design\tests\prod-layout-polish.js:308:13
```

## Phone evidence

The merged native receipts contain 186 renders across 31 views at 360/390/430,
light and dark, with zero recorded phone measurement failures. Pictures and hashes
are in [screenshots.json](screenshots.json); measurements are in
[measurements.json](measurements.json). Before/after comparisons cover 360 and 390.

## Desktop privacy

All 72 native comparisons include both PNG byte equality and computed-style
equality. The optional four-worker mode retains all original checks, snapshots and retries.
Raw pictures remain private; [desktop-diffs/manifest.json](desktop-diffs/manifest.json)
binds the before/after hashes to actual RGBA pixel diffs. Every diff channel is
zero. Only these differences are published, so no live client image or identity
appears in the repository.

Physical phones, deployment and live save receipts were not tested. All phone
write journeys used intercepted fictional fixtures. The PTO packet keeps its two
existing fixture warnings and the original hash-review requirements.
