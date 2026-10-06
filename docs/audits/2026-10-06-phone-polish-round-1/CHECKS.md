# Real check output

All browser runs reused visible Chrome; original assertions remained enabled.
No headless browser or live write was used. Private adapters and dependency
paths stay outside the public repository.

The final broad unit run has exactly the same 17 failing suites as unchanged
main in this Windows environment. It is **not green**. The new PTO fingerprint
failure found during the first run was repaired and is absent from the final
run. Required private-input profiles remain NOT_RUN.

Desktop: **72/72** screenshot pairs and computed styles match
origin/main. The [full result inventory](desktop-parity.json) includes every
staff and client journey at all four desktop widths. [Time Off desktop pairs](desktop/pairs.json)
bind before/after hashes and zero-pixel difference PNGs at each width.
The empty transparent diff images are intentional: there are no changed pixels.
All raw desktop screenshots remain private.

Initial setup attempts also exposed the expected old-HEAD assembly mismatch
before committing, and a missing parser search path; both mandatory checks
passed after the commit and dependency-path correction. No check was loosened.

## npm run -s check:index

```text
check-index: assembled bytes — sha256=9bcad6d36fa7cbfb7257ca29156b68ef8a8700e36acafc3e5213e5220c7d1ace bytes=1246319
check-index: working-tree index.html — sha256=9bcad6d36fa7cbfb7257ca29156b68ef8a8700e36acafc3e5213e5220c7d1ace bytes=1246319
check-index: committed index.html (HEAD) — sha256=9bcad6d36fa7cbfb7257ca29156b68ef8a8700e36acafc3e5213e5220c7d1ace bytes=1246319

check-index: OK — assembled == working tree == committed (HEAD)
```

## node scripts/check-modules.js

```text
typeof guards in modules: 507; unresolvable: 0
minified parts: 19 files, 2602 KB, 5112 top-level names, 0 lost, 0 changed kind

check-modules: all checks passed
```

## node scripts/repo-identity-exposure-check.js --diff=origin/main

```text
Repository identity exposure — what this change ADDS, against origin/main

  roster terms checked             53   (client slugs + staff full names)
  terms this change adds           0   (0 client slugs, 0 staff names)
  files carrying at least one      0   (any is a failure)

  WHERE (counts only — this tool never prints what it matched):

This change adds no client slug and no colleague's name ✅
```

## node test/run-all.js — final branch

```text

17 of 681 unit suite(s) failed ❌
failed suites: test/client-onboarding-handler.js, test/clean-urls-routes.js, test/b2-brief-link-rewrite.mjs, test/alert-digest.js, test/analytics-market-research-collect-function.js, test/analytics-metrics-collect-function.js, test/analytics-top-videos-collect-function.js, test/brain-parse.js, test/client-profile-edit.js, test/client-reconcile-after-posted.js, test/filming-plan-tabs-source.js, test/key-verify-behavior.js, test/overnight-runner-output-path.js, test/overnight-runner-singleton-lock.js, test/production-write-card-link.js, test/urgent-ping-fresh-round.js, test/write-refusal-browser-codes.js
```

## node test/run-all.js — unchanged main baseline

```text

17 of 681 unit suite(s) failed ❌
failed suites: test/client-onboarding-handler.js, test/clean-urls-routes.js, test/b2-brief-link-rewrite.mjs, test/alert-digest.js, test/analytics-market-research-collect-function.js, test/analytics-metrics-collect-function.js, test/analytics-top-videos-collect-function.js, test/brain-parse.js, test/client-profile-edit.js, test/client-reconcile-after-posted.js, test/filming-plan-tabs-source.js, test/key-verify-behavior.js, test/overnight-runner-output-path.js, test/overnight-runner-singleton-lock.js, test/production-write-card-link.js, test/urgent-ping-fresh-round.js, test/write-refusal-browser-codes.js
```

## node qa/client-phone/desktop-parity.js — full staff and test-client run

```text
ok   client-sample-reviews @1024: pixels identical, computed styles identical (e05ce30d75e1)
ok   client-sample-reviews @1280: pixels identical, computed styles identical (192ebb3a4b3c)
ok   client-sample-reviews @1440: pixels identical, computed styles identical (7946014bb0e8)
ok   client-sample-reviews @1920: pixels identical, computed styles identical (8efa8351f7c9)

72/72 desktop shots identical to origin/main
```

## node test/staff-phone-css-scope.js

```text
staff-phone-css-scope: OK (1 block(s), 311 braces, all under @media (max-width: <=767px) and body:has(.pocket-staff-bar))
```

## node docs/syncview-design/tests/pto-ui-polish.js — original suite and phone states

```text
PASS Time Off sign-in-name-picker, dark, 430: requested viewport fits, 44px targets, 16px fields ({"viewport":430,"page":430,"theme":"dark","small":[],"text":true})
PASS Phone fixtures have no unexpected writes or page errors
PTO_EXPANDED_PHONE: 102 states passed at 360/390/430, light and dark; no live writes.
PASS test triggered no unrelated external writes
PASS browser produced no page errors:
PTO UI polish browser checks passed (31 mocked PTO calls)
```

## Native phone states — settled screenshot recheck

```text
PASS Time Off sign-in-name-picker, dark, 430: requested viewport fits, 44px targets, 16px fields ({"viewport":430,"page":430,"theme":"dark","small":[],"text":true})
PASS Phone fixtures have no unexpected writes or page errors
PTO_EXPANDED_PHONE: 102 states passed at 360/390/430, light and dark; no live writes.
```

## Shared-header browser regression check

```text
ok   today-editor-deck 430 dark
ok   sheet-tabs 430 dark
ok   sheet-more 430 dark
staff-phone-browser: 36 state renders, 0 problems
```

## node qa/pto-lifecycle/run.js

```text
VISIBLE_BROWSER_PRELOAD: original runner, original assertions, retained visible Chrome; credentials memory-only.
PTO lifecycle mocked lane passed: 101 action/result screenshots; 35 coverage gates.
Artifacts: .codex-tmp/pto-lifecycle/latest
```

## node qa/pto-lifecycle/run.js --update-public

```text
PTO lifecycle public evidence updated atomically: 101 reviewed screenshots.
Artifacts: docs/audits/2026-07-17-pto-lifecycle-simulation
```

## node qa/pto-lifecycle/run.js --validate-public-evidence

```text
PTO public evidence passed without a browser: 101 reviewed screenshots; current source fingerprint and hashes match.
```

## node test/leave-evidence-fingerprint-coupling.js

```text
  ok  and over the same file set, so the copy above has not drifted from it

leave-evidence fingerprint coupling checks passed
```

## Before screenshot capture — not an acceptance pass

```text
VISIBLE_BROWSER_PRELOAD: original runner, original assertions, retained visible Chrome; credentials memory-only.
PTO_BEFORE_CAPTURE: 102 fictional visible states from unchanged main; capture only; no live writes.
```

## Screenshot file inventory

```text
PHONE_PROOF_INVENTORY: 204 readable PNGs; every after image matches its requested width; 17 states x 3 widths x 2 themes x before/after.
```

## Interactive gallery in visible Chrome

```text
PHONE_GALLERY_BROWSER: 102 before/after pairs decoded; width/theme/state controls and Previous/Next passed in visible Chrome; 0 script errors.
```

`git diff --check` and the staged equivalent exited 0 with no output.

Token usage is not exposed by this session. Hosted CI and physical phones
are separate from this local proof; nothing was merged or deployed.
