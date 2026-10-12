# Check receipts and remaining limits

Final app source: `213fb3568357cb4544a8f9df8bd727775d061661`. Before: `02ae95dd8cddd163dc4d8b640e55eedca7525734`. Main at desktop proof: `f611eb1c0c219c191d7e85fcc602fe63b4e356da` (same app source as the baseline; backup tooling only changed). Later commits update QA and public evidence.

All browser commands use a private network-denial preload: loopback app assets and intercepted fictional replies only; external app requests and WebSockets abort. No real client save or aggregate client-data read was performed. Only the owner-authorized identity gate may read roster names/slugs. Commands below identify the executed gate; environment, output-directory and before-checkout arguments are omitted where machine-specific. These are actual log tails, not paraphrases.

## Phone inventory at 390

`node qa/staff-phone-final-pass.js --all-states --widths=390`

```text
staff-phone-final-pass: 322 renders, 0 problems
```

## Phone inventory at 430

`node qa/staff-phone-final-pass.js --all-states --widths=430`

```text
staff-phone-final-pass: 322 renders, 0 problems
```

## Staff phone rules

`node qa/staff-phone-rules-browser.js`

```text
STAFF_PHONE_RULES: 160 states; 0 failures; 390/430 touch; synthetic transports; no live writes
```

## Native save gateway

`node docs/syncview-design/tests/prod-write-gateway-browser.js`

```text
prod-write-gateway-browser: mirror operations plus Submit and Calendar native intake passed
```

## Responsiveness CI lane

`node qa/staff-phone-responsiveness.js`

```text
STAFF_PHONE_RESPONSIVENESS: 180 measurements; 0 failures; fictional transports only
```

## Expanded Calendar

`node docs/syncview-design/tests/staff-calendar-expanded-browser.js`

```text
staff-calendar-expanded: OK (9486 checks; Review/Sheet/Month/Week, light/dark, menus/dialogs, loading/empty/error/saving, desktop restore; 360/390/430).
```

## Expanded Samples and Selection

`node docs/syncview-design/tests/staff-selection-samples-browser.js`

```text
staff-selection-samples: OK (5244 checks; Selection, Samples Review/Sheet, light/dark, dialogs, loading/empty/error/saving and desktop restore; 360/390/430).
```

## Reviewer and admin native states

`node docs/syncview-design/tests/kasper-admin-expanded-browser.js`

```text
KASPER_ADMIN_EXPANDED: 12 native states; 352 checks; 0 failures; fictional data; no live writes.
```

## Standard exact desktop parity

`node qa/client-phone/desktop-parity.js --before=origin/main --staff-only`

```text
48/48 desktop shots identical to origin/main
```

## Populated Linear exact desktop parity

`node qa/client-phone/fixture-desktop-parity.js --before-root=<unchanged-main-checkout> --only=linear`

```text
FIXTURE_DESKTOP_PARITY: 4/4 exact 1440 desktop pairs; native Today/Notes/Analytics/Workload/TikTok/Card detail fixtures; cold and phone-to-desktop; no live writes.
```

## Unit lane (baseline failures remain)

`node test/run-all.js`

```text
18 of 724 unit suite(s) failed ❌
failed suites: test/client-onboarding-handler.js, test/clean-urls-routes.js, test/b2-brief-link-rewrite.mjs, test/alert-digest.js, test/analytics-market-research-collect-function.js, test/analytics-metrics-collect-function.js, test/analytics-top-videos-collect-function.js, test/brain-parse.js, test/client-profile-edit.js, test/client-reconcile-after-posted.js, test/filming-plan-tabs-source.js, test/key-verify-behavior.js, test/overnight-runner-output-path.js, test/overnight-runner-singleton-lock.js, test/production-write-card-link.js, test/track-b-recovery-v7-preparation.js, test/urgent-ping-fresh-round.js, test/write-refusal-browser-codes.js
```

## Unchanged-main unit comparison

`node test/run-all.js (unchanged baseline checkout)`

```text
18 of 722 unit suite(s) failed ❌
failed suites: test/client-onboarding-handler.js, test/clean-urls-routes.js, test/b2-brief-link-rewrite.mjs, test/alert-digest.js, test/analytics-market-research-collect-function.js, test/analytics-metrics-collect-function.js, test/analytics-top-videos-collect-function.js, test/brain-parse.js, test/client-profile-edit.js, test/client-reconcile-after-posted.js, test/filming-plan-tabs-source.js, test/key-verify-behavior.js, test/overnight-runner-output-path.js, test/overnight-runner-singleton-lock.js, test/production-write-card-link.js, test/track-b-recovery-v7-preparation.js, test/urgent-ping-fresh-round.js, test/write-refusal-browser-codes.js
```

## PTO fingerprint

`node --require ./test/helpers/single-file-index.js test/leave-evidence-fingerprint-coupling.js`

```text
leave-evidence fingerprint coupling checks passed
```

## Throttled 4G measurements (one stress miss)

`node qa/staff-phone-responsiveness.js --speed`

```text
STAFF_PHONE_RESPONSIVENESS: 171 measurements; 1 failures; fictional transports only
```

## Guarded Production gate (live observation blocked)

`node docs/syncview-design/tests/prod-polish-gate.js --all`

```text
prod-polish-gate (all) failed after 424.6s
  - Production boot budget failed with exit 1
  - Production structure subset failed with exit 1
  - Production read-only smoke failed with exit 1
  - Production comment thread failed with exit 1
  - Production interaction inventory failed with exit 1
  - Production accessibility/focus failed with exit 1
  - Production layout polish failed with exit 1
  - Production wired behavior failed with exit 2
  - Production pixel parity failed with exit 1
```

## Earlier identity attempt (refused by read guard)

`node scripts/repo-identity-exposure-check.js --diff=origin/main (network-denied)`

```text
identity exposure check failed: PRISM_LIVE_READ_REFUSED: no aggregate or unscoped live test traffic
```

## Failures and corrected evidence

- The same 18 named unit suites above fail on the unchanged baseline. The branch runs 724 unit suites; that baseline had 722. The additional suites are the backup-corpus guard already on latest main and this PR's exact desktop replay regression. A stale caption source assertion initially added a nineteenth failure; it was updated to check both the preserved desktop/client observer and the phone width-only observer, and its 28 focused assertions pass.
- The final 4G run records 171 measurements and one failure: dark Calendar at 390 expands a long caption in a 20-card feed in 287 ms, above the new 250 ms stress budget. Unchanged main took 411 ms in that cell and 405 ms at dark 430. The branch's final dark 430 cell took 115 ms. Earlier slower branch trials (including 318/338, 284/322, 306/292 and 254/276 ms) were retained privately rather than replaced with the fastest trial. The public table uses the final complete run, not a cherry-picked focused result.
- The original desktop run was 47/48: a tiny text raster mismatch. A fresh complete run is 48/48 exact pixels and computed styles. In the populated fixture gate, an eight-pixel header-avatar mismatch also reproduced on unchanged main compared against itself. The fixture gate now allows at most four fresh exact pairs; no tolerance, mask or differing pixel is accepted. Unit tests prove persistent pixel/style differences still fail. The final 16 populated comparisons are exact, including all four Linear pairs on their first attempt. Original failed receipts remain private; public hashes and zero-difference PNGs describe the successful comparisons.
- The original full Production polish gate's nine live-observation lanes were blocked by the network guard. They were not retried against other clients and are not called green or unchanged-main failures. The native mocked write gateway, phone inventory, feedback, focus, geometry and scoped rules run separately and pass.
- Early speed runs used uncompressed assets or a Playwright clock that also wrapped performance/animation frames. Those runs are rejected. Accepted timings use gzip and native clocks; only Date is fixed. A baseline Analytics-detail fixture targeted an obsolete table link; it was corrected to the visible fictional grid/table link. A synthetic textarea stretch was initially left in a Samples image; it is now restored before native screenshots. Final visual captures wait for transient native touch highlights to settle and clear test-created text selections; screen captures return to the top, while action captures retain the native scrolled position. This visual wait is outside accepted response telemetry.
- An initial exact-replay unit launch failed because the new test had not been registered in the unit lane. The registration is fixed; the final unit lane includes it. A bare port-fidelity command failed under modular loading; the CI single-file-preloaded invocation passes. Neither is presented as a product regression.
- The first guarded identity invocation refused the roster read. The owner then explicitly allowed roster-only names/slugs for this required check. Its final authorized receipt is appended below; all browser/save tests keep the broader read ban.

## Not proved or not changed

Cold shared bootstrap still takes several seconds under the constrained profile; this PR removes redundant phone interaction work rather than replacing the shared loading architecture. Every primary entry is cold-timed, but not every admin subpage or individual button. Raw layout-shift entries include scripted fixture mounting and selection; they are not isolated live CLS scores. Refresh continuity has direct card/draft assertions. No physical iPhone, deployed build or real save is claimed. No merge, deployment, database or workflow change occurred.

## Final static and identity checks

Executed on the committed evidence branch. All checks below exit 0; the earlier unit and 4G limitations above remain.

## Final visual-pass correction

A parallel visual rerun initially counted one unrelated popup scan while Playwright scrolled a below-fold caption into view. The probe now explicitly settles that setup scroll before counting the caption tap. The final Calendar rerun passes all 56 measurements; Samples passes its four visual cells. Application source did not change. Accepted 4G before/after numbers retain the same earlier harness on both sides; the visual-only reruns are not substituted into the speed table.

`node qa/staff-phone-responsiveness.js --only=Calendar`

```text
STAFF_PHONE_RESPONSIVENESS: 56 measurements; 0 failures; fictional transports only
```

`node qa/staff-phone-responsiveness.js --only=SyncLinear`

```text
STAFF_PHONE_RESPONSIVENESS: 8 measurements; 0 failures; fictional transports only
```

`npm run -s check:index`

```text
check-index: working-tree index.html — sha256=e08b0bb9e135cb586cb10465859a9a017b9e56b554b21ce6c399953f3582dfdf bytes=1359641
check-index: committed index.html (HEAD) — sha256=e08b0bb9e135cb586cb10465859a9a017b9e56b554b21ce6c399953f3582dfdf bytes=1359641

check-index: OK — assembled == working tree == committed (HEAD)
```

`node scripts/check-modules.js`

```text
minified parts: 19 files, 2724 KB, 5332 top-level names, 0 lost, 0 changed kind

check-modules: all checks passed
```

`node scripts/repo-identity-exposure-check.js --diff="origin/main"`

```text
  files carrying at least one      0   (any is a failure)

  WHERE (counts only — this tool never prints what it matched):

This change adds no client slug and no colleague's name ✅
```

`node test/no-hardcoded-colors.js`

```text
No hardcoded color literals outside allowed variable/validation blocks.
```

`node test/*phone-css-scope.js (each of the seven matching files)`

```text
client-phone-css-scope: OK (6 block(s), 464 braces, all under @media (max-width: <=767px) and html.boot-client)
finch-phone-css-scope: OK (1 block(s), 446 braces, all under @media (max-width: <=767px) and html.fph-on)
kasper-phone-css-scope: OK (1 block(s), 24 braces, all under @media (max-width: <=767px) and the Kasper review scope)
staff-calendar-phone-css-scope: OK (1 block(s), 410 braces, all under @media (max-width: <=767px) and #calView[data-pocket-staff-phone])
staff-phone-css-scope: OK (1 block(s), 372 braces, all under @media (max-width: <=767px) and body:has(.pocket-staff-bar))
staff-samples-phone-css-scope: OK (1 block(s), 352 braces, all under @media (max-width: <=767px) and #sxrView[data-pocket-staff-samples])
staff-selection-phone-css-scope: OK (1 block(s), 30 braces, all under @media (max-width: <=767px) and #calView[data-pocket-staff-phone])
```

`node test/staff-phone-rules-source.js`

```text
staff-phone-rules-source: artifact CSS/JS transplanted byte-identically; 75 rules phone-capped and staff-scoped
```

`node --require ./test/helpers/single-file-index.js test/leave-evidence-fingerprint-coupling.js`

```text
leave-evidence fingerprint coupling checks passed
```

`node --require ./test/helpers/single-file-index.js test/port-fidelity-check.js`

```text
  exact/allowed: _prodDescLinkPopWire -> descLinkPopWire
  exact object: PROD_ICON -> I
```

`node --require ./test/helpers/single-file-index.js test/repo-map-sync.js`

```text
repo-map-sync: 1153 passed, 0 failed
```

`node test/fixture-desktop-exact-replay.js`

```text
fixture-desktop-exact-replay: exact pairs stop immediately; raster noise retries; persistent pixel/style changes fail after four attempts
```

`node --require ./test/helpers/single-file-index.js test/calendar-client-reorder-caption.js`

```text
  PASS ✅  (28 passed, 0 failed)
```
