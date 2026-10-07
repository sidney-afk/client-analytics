# Staff phone design check receipts

These are the actual final nonblank output lines, not rewritten summaries. Blank logs are recorded as such. Superseded runs and failed iterations remain visible. Only completed passing checks count as proof. `check:index` compares generated working bytes to HEAD and therefore ran red before the implementation commit; its post-commit result is listed separately. The archived non-Git main comparison is invalid for Git-dependent tests and is superseded by the detached main worktree.

## admin-390-complete.log

COMPLETED

```text
KASPER_ADMIN_EXPANDED: 126 native states; 2452 checks; 0 failures; fictional data; no live writes.
```

## admin-390.log

CANCELLED / superseded

No output was emitted.

## admin-430-complete.log

COMPLETED

```text
KASPER_ADMIN_EXPANDED: 126 native states; 2452 checks; 0 failures; fictional data; no live writes.
```

## admin-430.log

CANCELLED / superseded

No output was emitted.

## baseline-checkout.log

COMPLETED

```text
Updating files: 100% (6095/6095)
Updating files: 100% (6095/6095), done.
HEAD is now at cbd443a3 Merge pull request #1985 from sidney-afk/claude/tiktok-cancel-post-for-me-s31lxr
```

## build-candidate.log

COMPLETED

```text
build-index: js/sv-16-kasper-baedbf6dc851.js (298341 bytes)
build-index: wrote index.html (1287574 bytes) from 67 fragment(s)
build-index: wrote src/index/INDEX.md
```

## build-current-main.log

COMPLETED

```text
build-index: js/sv-16-kasper-baedbf6dc851.js (298341 bytes)
build-index: wrote index.html (1287574 bytes) from 67 fragment(s)
build-index: wrote src/index/INDEX.md
```

## build-cycle1.log

COMPLETED

```text
build-index: js/sv-16-kasper-baedbf6dc851.js (298341 bytes)
build-index: wrote index.html (1286990 bytes) from 67 fragment(s)
build-index: wrote src/index/INDEX.md
```

## build-cycle2.log

COMPLETED

```text
build-index: js/sv-16-kasper-baedbf6dc851.js (298341 bytes)
build-index: wrote index.html (1287221 bytes) from 67 fragment(s)
build-index: wrote src/index/INDEX.md
```

## build-final.log

COMPLETED

```text
build-index: js/sv-16-kasper-baedbf6dc851.js (298341 bytes)
build-index: wrote index.html (1287400 bytes) from 67 fragment(s)
build-index: wrote src/index/INDEX.md
```

## build-focus.log

COMPLETED

```text
build-index: js/sv-16-kasper-baedbf6dc851.js (298341 bytes)
build-index: wrote index.html (1287574 bytes) from 67 fragment(s)
build-index: wrote src/index/INDEX.md
```

## build-merge.log

COMPLETED

```text
build-index: js/sv-16-kasper-baedbf6dc851.js (298341 bytes)
build-index: wrote index.html (1283896 bytes) from 67 fragment(s)
build-index: wrote src/index/INDEX.md
```

## build-review.log

COMPLETED

```text
build-index: js/sv-16-kasper-baedbf6dc851.js (298341 bytes)
build-index: wrote index.html (1287574 bytes) from 67 fragment(s)
build-index: wrote src/index/INDEX.md
```

## build-settled.log

COMPLETED

```text
build-index: js/sv-16-kasper-baedbf6dc851.js (298341 bytes)
build-index: wrote index.html (1287574 bytes) from 67 fragment(s)
build-index: wrote src/index/INDEX.md
```

## cards-before-complete.log

COMPLETED

```text
ok sample-reviews-430-dark-warning
ok sample-reviews-430-dark-linked
STAFF_PHONE_DESIGN: 16 native card states; 0 failures; fictional intercepted transports
```

## cards-before-matched.log

COMPLETED

```text
ok sample-reviews-430-dark-missing-media
ok sample-reviews-430-dark-linked
STAFF_PHONE_DESIGN: 16 native card states; 0 failures; fictional intercepted transports
```

## cards-before.log

FAILED / retained

```text
    at main (D:\Sidney\Documents\Synchro\atlas-client-analytics\qa\staff-phone-design-browser.js:31:72) {
  name: 'TimeoutError'
}
```

## cards-candidate.log

COMPLETED

```text
ok sample-reviews-430-dark-missing-media
ok sample-reviews-430-dark-linked
STAFF_PHONE_DESIGN: 16 native card states; 0 failures; fictional intercepted transports
```

## cards-cycle1.log

COMPLETED

```text
ok sample-reviews-430-dark-warning
ok sample-reviews-430-dark-linked
STAFF_PHONE_DESIGN: 16 native card states; 0 failures; fictional intercepted transports
```

## cards-cycle2.log

COMPLETED

```text
ok sample-reviews-430-dark-warning
ok sample-reviews-430-dark-linked
STAFF_PHONE_DESIGN: 16 native card states; 0 failures; fictional intercepted transports
```

## cards-final-complete.log

COMPLETED

```text
ok sample-reviews-430-dark-missing-media
ok sample-reviews-430-dark-linked
STAFF_PHONE_DESIGN: 16 native card states; 0 failures; fictional intercepted transports
```

## cards-final.log

FAILED / retained

```text
  expected: [],
  operator: 'deepStrictEqual'
}
```

## cards-safe-actions-complete.log

COMPLETED

```text
ok sample-reviews-430-dark-missing-media
ok sample-reviews-430-dark-linked
STAFF_PHONE_DESIGN: 16 native card states; 0 failures; fictional intercepted transports
```

## cards-safe-actions.log

FAILED / retained

```text
  expected: true,
  operator: '=='
}
```

## cards-settled.log

COMPLETED

```text
ok sample-reviews-430-dark-missing-media
ok sample-reviews-430-dark-linked
STAFF_PHONE_DESIGN: 16 native card states; 0 failures; fictional intercepted transports
```

## catalogue-390-complete.log

COMPLETED

```text
ok today-cleared 390 light
ok today-cleared 390 dark
staff-phone-final-pass: 232 renders, 0 problems
```

## catalogue-390.log

CANCELLED / superseded

```text
ok analytics-detail 390 light
ok analytics-detail 390 dark
ok workload-week 390 light
```

## catalogue-430-complete.log

COMPLETED

```text
ok today-cleared 430 light
ok today-cleared 430 dark
staff-phone-final-pass: 232 renders, 0 problems
```

## catalogue-430.log

CANCELLED / superseded

```text
ok analytics-detail 430 dark
ok workload-week 430 light
ok workload-week 430 dark
```

## commit-current-merge.log

COMPLETED

```text
[codex/pocket-staff-phone 5948ca2e] Merge current origin/main into Pocket staff phone branch
```

## commit-design.log

COMPLETED

```text
 create mode 100644 js/sv-full-56f72d9f515a.js
 create mode 100644 qa/staff-phone-design-browser.js
 create mode 100644 scripts/staff-phone-changed.js
```

## commit-merge.log

COMPLETED

```text
[codex/pocket-staff-phone 47ecd481] Merge origin/main into Pocket staff phone branch
```

## desktop-complete.log

FAILED / retained

```text
ok   client-sample-reviews @1440: pixels identical, computed styles identical (29e7eb2d8015)
ok   client-sample-reviews @1920: pixels identical, computed styles identical (f87764b62642)
71/72 desktop shots identical to origin/main
```

## desktop-current-main.log

RUNNING

```text
FAIL staff-navFilmingPlans @1440: pixels DIFFERENT, computed styles identical (5d63f4d43ad2, attempts 4)
ok   staff-navHome @1280: pixels identical, computed styles identical (ff11f590fec4)
ok   staff-navHome @1440: pixels identical, computed styles identical (439194562bc0)
```

## desktop-final.log

CANCELLED / superseded

```text
ok   staff-navToday @1024: pixels identical, computed styles identical (6798827bd769)
ok   staff-navToday @1280: pixels identical, computed styles identical (8567a9aff2f4)
```

## desktop-focus-complete.log

CANCELLED / superseded

```text
ok   client-analytics @1440: pixels identical, computed styles identical (d11ef7ceab99)
ok   client-analytics @1920: pixels identical, computed styles identical (aa6926766e3a)
ok   client-calendar @1024: pixels identical, computed styles identical (69fabd5010fe)
```

## diff-review.log

COMPLETED

No output was emitted.

## fetch-review.log

COMPLETED

```text
From https://github.com/sidney-afk/client-analytics
 * branch              main       -> FETCH_HEAD
   cbd443a3..c8375c92  main       -> origin/main
```

## identity-current-main.log

COMPLETED

```text
  files carrying at least one      0   (any is a failure)
  WHERE (counts only — this tool never prints what it matched):
This change adds no client slug and no colleague's name ✅
```

## index-candidate.log

FAILED / retained

```text
check-index: FAIL — assembled bytes do not equal committed index.html (HEAD)
check-index: FAIL — working-tree index.html does not equal committed index.html (HEAD)
check-index: FAILED
```

## index-current-main.log

COMPLETED

```text
check-index: working-tree index.html — sha256=01276417888eb2b6bd3f79afdf8e2e2eb9de482d87c46b77b7fa0a6054bd7165 bytes=1287574
check-index: committed index.html (HEAD) — sha256=01276417888eb2b6bd3f79afdf8e2e2eb9de482d87c46b77b7fa0a6054bd7165 bytes=1287574
check-index: OK — assembled == working tree == committed (HEAD)
```

## index-final.log

FAILED / retained

```text
check-index: FAIL — assembled bytes do not equal committed index.html (HEAD)
check-index: FAIL — working-tree index.html does not equal committed index.html (HEAD)
check-index: FAILED
```

## index-settled.log

FAILED / retained

```text
check-index: FAIL — assembled bytes do not equal committed index.html (HEAD)
check-index: FAIL — working-tree index.html does not equal committed index.html (HEAD)
check-index: FAILED
```

## lazy-current-main.log

COMPLETED

```text
approve path reaching into on-demand areas: 2 hazards, 26 import ties
  synclinear: PROD_WRITE_EF_URL, _prodCanWrite, _prodCanonicalCommentGate, _prodCardCommentsPending, _prodClientCommentGatewayContext, _prodComments, _prodCommentsSkeletonHtml, _prodGatewayWrite, _prodIssue, _prodProjectCanonicalCardComments, _prodRestRows, _prodToast, _prodVerifiedClientCommentMutationContext, _prodWriteErrorText
check-lazy-safety: all checks passed (38 recorded hazards)
```

## lazy-review.log

COMPLETED

```text
approve path reaching into on-demand areas: 2 hazards, 26 import ties
  synclinear: PROD_WRITE_EF_URL, _prodCanWrite, _prodCanonicalCommentGate, _prodCardCommentsPending, _prodClientCommentGatewayContext, _prodComments, _prodCommentsSkeletonHtml, _prodGatewayWrite, _prodIssue, _prodProjectCanonicalCardComments, _prodRestRows, _prodToast, _prodVerifiedClientCommentMutationContext, _prodWriteErrorText
check-lazy-safety: all checks passed (38 recorded hazards)
```

## lazy-safety-complete.log

COMPLETED

```text
approve path reaching into on-demand areas: 2 hazards, 26 import ties
  synclinear: PROD_WRITE_EF_URL, _prodCanWrite, _prodCanonicalCommentGate, _prodCardCommentsPending, _prodClientCommentGatewayContext, _prodComments, _prodCommentsSkeletonHtml, _prodGatewayWrite, _prodIssue, _prodProjectCanonicalCardComments, _prodRestRows, _prodToast, _prodVerifiedClientCommentMutationContext, _prodWriteErrorText
check-lazy-safety: all checks passed (38 recorded hazards)
```

## lazy-safety.log

FAILED / retained

```text
check-lazy-safety: the acorn parser is not installed. See the DEPENDENCY note in scripts/check-modules.js.
```

## map-current-main.log

COMPLETED

```text
OK  REPO_MAP.md path `docs/syncview-design/proofs/staff-calendar-expanded/README.md` exists
OK  REPO_MAP.md path `docs/syncview-design/tests/phone-thumbnail-comparison.js` exists
repo-map-sync: 1116 passed, 0 failed
```

## map-review.log

COMPLETED

```text
OK  REPO_MAP.md path `docs/syncview-design/proofs/staff-calendar-expanded/README.md` exists
OK  REPO_MAP.md path `docs/syncview-design/tests/phone-thumbnail-comparison.js` exists
repo-map-sync: 1103 passed, 0 failed
```

## merge-current.log

FAILED / retained

```text
Auto-merging src/index/INDEX.md
Auto-merging test/suite-classification.json
Automatic merge failed; fix conflicts and then commit the result.
```

## merge-diff-check.log

COMPLETED

No output was emitted.

## merge.log

FAILED / retained

```text
Auto-merging src/index/INDEX.md
Auto-merging test/suite-classification.json
Automatic merge failed; fix conflicts and then commit the result.
```

## modules-complete.log

COMPLETED

```text
typeof guards in modules: 512; unresolvable: 0
minified parts: 19 files, 2621 KB, 5153 top-level names, 0 lost, 0 changed kind
check-modules: all checks passed
```

## modules-current-main.log

COMPLETED

```text
typeof guards in modules: 514; unresolvable: 0
minified parts: 19 files, 2628 KB, 5162 top-level names, 0 lost, 0 changed kind
check-modules: all checks passed
```

## modules-review.log

COMPLETED

```text
typeof guards in modules: 512; unresolvable: 0
minified parts: 19 files, 2621 KB, 5153 top-level names, 0 lost, 0 changed kind
check-modules: all checks passed
```

## modules.log

FAILED / retained

```text
check-modules: the acorn parser is not installed. See the DEPENDENCY note at the top of this file.
```

## parser-install.log

COMPLETED

```text
added 6 packages in 2s
1 package is looking for funding
  run `npm fund` for details
```

## rules-complete.log

COMPLETED

```text
ok time-off-light-430 screen, menus, layout and scroll lock
ok time-off-dark-430 screen, menus, layout and scroll lock
STAFF_PHONE_RULES: 160 states; 0 failures; 390/430 touch; synthetic transports; no live writes
```

## rules-final.log

CANCELLED / superseded

```text
ok sample-reviews-dark-390 screen, menus, layout and scroll lock
ok sample-reviews-light-430 screen, menus, layout and scroll lock
ok sample-reviews-dark-430 screen, menus, layout and scroll lock
```

## scope-review.log

COMPLETED

```text
staff-calendar-phone-css-scope: OK (1 block(s), 396 braces, all under @media (max-width: <=767px) and #calView[data-pocket-staff-phone])
```

## source-candidate.log

COMPLETED

```text
staff-phone-rules-source: artifact CSS/JS transplanted byte-identically; 58 rules phone-capped and staff-scoped
```

## source-current-main.log

COMPLETED

```text
staff-phone-rules-source: artifact CSS/JS transplanted byte-identically; 58 rules phone-capped and staff-scoped
```

## source-cycle2.log

COMPLETED

```text
staff-phone-rules-source: artifact CSS/JS transplanted byte-identically; 55 rules phone-capped and staff-scoped
```

## source-final.log

COMPLETED

```text
staff-phone-rules-source: artifact CSS/JS transplanted byte-identically; 57 rules phone-capped and staff-scoped
```

## source-focus.log

COMPLETED

```text
staff-phone-rules-source: artifact CSS/JS transplanted byte-identically; 58 rules phone-capped and staff-scoped
```

## source-review.log

COMPLETED

```text
staff-phone-rules-source: artifact CSS/JS transplanted byte-identically; 58 rules phone-capped and staff-scoped
```

## source-settled.log

COMPLETED

```text
staff-phone-rules-source: artifact CSS/JS transplanted byte-identically; 58 rules phone-capped and staff-scoped
```

## staged-diff-review.log

FAILED / retained

```text
docs/audits/2026-10-07-staff-phone-design-checks.md:567: new blank line at EOF.
```

## truth-current-main.log

COMPLETED

```text
OK  migrations/sales-intake-migration.sql is labelled as deployed historical schema
OK  migrations/sales-intake-migration.sql contains no current manual-rollout instruction
truth-sync: 515 passed, 0 failed
```

## truth-review.log

COMPLETED

```text
OK  migrations/sales-intake-migration.sql is labelled as deployed historical schema
OK  migrations/sales-intake-migration.sql contains no current manual-rollout instruction
truth-sync: 513 passed, 0 failed
```

## unit-complete.log

FAILED / retained

```text
finch-phone-css-scope: OK (1 block(s), 367 braces, all under @media (max-width: <=767px) and html.fph-on)
17 of 685 unit suite(s) failed ❌
failed suites: test/client-onboarding-handler.js, test/clean-urls-routes.js, test/b2-brief-link-rewrite.mjs, test/alert-digest.js, test/analytics-market-research-collect-function.js, test/analytics-metrics-collect-function.js, test/analytics-top-videos-collect-function.js, test/brain-parse.js, test/client-profile-edit.js, test/client-reconcile-after-posted.js, test/filming-plan-tabs-source.js, test/key-verify-behavior.js, test/overnight-runner-output-path.js, test/overnight-runner-singleton-lock.js, test/production-write-card-link.js, test/urgent-ping-fresh-round.js, test/write-refusal-browser-codes.js
```

## unit-main-baseline.log

FAILED / retained

```text
finch-phone-css-scope: OK (1 block(s), 367 braces, all under @media (max-width: <=767px) and html.fph-on)
36 of 684 unit suite(s) failed ❌
failed suites: test/client-onboarding-handler.js, test/clean-urls-routes.js, test/b2-brief-link-rewrite.mjs, test/alert-digest.js, test/analytics-market-research-collect-function.js, test/analytics-metrics-collect-function.js, test/analytics-top-videos-collect-function.js, test/brain-parse.js, test/client-profile-edit.js, test/client-reconcile-after-posted.js, test/comment-strip-is-honest.js, test/ef-pin-drift-report.js, test/f200-attribution.js, test/f27-edge-source-rollback.js, test/f27-final-verification.js, test/f27-private-artifact-round-trip.js, test/f27-private-snapshot-fetch.js, test/f27-private-snapshot-store.js, test/f27-reconciler-closure.js, test/f27-section4-deploy-lane.js, test/filming-plan-tabs-source.js, test/key-verify-behavior.js, test/linear-media-rescue.js, test/native-brief-media-copy.js, test/native-intake-editor-browser.js, test/native-label-catalog-foundation.js, test/overnight-runner-output-path.js, test/overnight-runner-singleton-lock.js, test/production-write-card-link.js, test/production-write-drill.js, test/slice5-test-drills.js, test/track-b-recovery-deferred-defaults.js, test/truth-sync.js, test/urgent-ping-fresh-round.js, test/workload-native-membership.js, test/write-refusal-browser-codes.js
```

## unit-main-worktree.log

FAILED / retained

```text
finch-phone-css-scope: OK (1 block(s), 367 braces, all under @media (max-width: <=767px) and html.fph-on)
19 of 684 unit suite(s) failed ❌
failed suites: test/client-onboarding-handler.js, test/clean-urls-routes.js, test/b2-brief-link-rewrite.mjs, test/alert-digest.js, test/analytics-market-research-collect-function.js, test/analytics-metrics-collect-function.js, test/analytics-top-videos-collect-function.js, test/brain-parse.js, test/client-profile-edit.js, test/client-reconcile-after-posted.js, test/filming-plan-tabs-source.js, test/key-verify-behavior.js, test/overnight-runner-output-path.js, test/overnight-runner-singleton-lock.js, test/production-write-card-link.js, test/production-write-drill.js, test/slice5-test-drills.js, test/urgent-ping-fresh-round.js, test/write-refusal-browser-codes.js
```

## workflow-docs-only.log

COMPLETED

```text
STAFF_PHONE_FILES: unchanged; skip phone matrix
```

## workflow-phone-change.log

COMPLETED

```text
STAFF_PHONE_FILES: changed; run phone matrix
```
