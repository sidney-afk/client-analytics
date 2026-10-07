# Staff phone design check receipts

These are the actual final nonblank output lines, not rewritten summaries. Blank logs are recorded as such. Superseded runs and failed iterations remain visible. Only completed passing checks count as proof. `check:index` compares generated working bytes to HEAD and therefore ran red before the implementation commit; its post-commit result is listed separately. The archived non-Git main comparison is invalid for Git-dependent tests and is superseded by the detached main worktree.

## admin-390-complete.log

COMPLETED

```text
KASPER_ADMIN_EXPANDED: 126 native states; 2452 checks; 0 failures; fictional data; no live writes.
```

## admin-390-inline-overlay.log

FAILED / retained

```text
KASPER_ADMIN_EXPANDED: 126 native states; 2456 checks; 2 failures; fictional data; no live writes.
FAIL review-lightbox: controls overlap [{"a":"button.kasper-subtab.kasper-more-trigger","b":"button.kasper-lightbox-close","w":40,"h":42}]
FAIL review-lightbox: controls overlap [{"a":"button.kasper-subtab.kasper-more-trigger","b":"button.kasper-lightbox-close","w":40,"h":42}]
```

## admin-390-shipping.log

COMPLETED

```text
KASPER_ADMIN_EXPANDED: 126 native states; 2456 checks; 0 failures; fictional data; no live writes.
```

## admin-390.log

CANCELLED / superseded

No output was emitted.

## admin-430-complete.log

COMPLETED

```text
KASPER_ADMIN_EXPANDED: 126 native states; 2452 checks; 0 failures; fictional data; no live writes.
```

## admin-430-inline-overlay.log

FAILED / retained

```text
KASPER_ADMIN_EXPANDED: 126 native states; 2456 checks; 2 failures; fictional data; no live writes.
FAIL review-lightbox: controls overlap [{"a":"button.kasper-subtab.kasper-more-trigger","b":"button.kasper-lightbox-close","w":40,"h":42}]
FAIL review-lightbox: controls overlap [{"a":"button.kasper-subtab.kasper-more-trigger","b":"button.kasper-lightbox-close","w":40,"h":42}]
```

## admin-430-shipping.log

COMPLETED

```text
KASPER_ADMIN_EXPANDED: 126 native states; 2456 checks; 0 failures; fictional data; no live writes.
```

## admin-430.log

CANCELLED / superseded

No output was emitted.

## admin-fixed-final390.log

COMPLETED

```text
KASPER_ADMIN_EXPANDED: 126 native states; 2456 checks; 0 failures; fictional data; no live writes.
```

## admin-fixed-final430.log

COMPLETED

```text
KASPER_ADMIN_EXPANDED: 126 native states; 2456 checks; 0 failures; fictional data; no live writes.
```

## admin-latest390.log

COMPLETED

```text
KASPER_ADMIN_EXPANDED: 126 native states; 2474 checks; 0 failures; fictional data; no live writes.
```

## admin-latest430.log

COMPLETED

```text
KASPER_ADMIN_EXPANDED: 126 native states; 2474 checks; 0 failures; fictional data; no live writes.
```

## admin-merged390.log

COMPLETED

```text
KASPER_ADMIN_EXPANDED: 126 native states; 2456 checks; 0 failures; fictional data; no live writes.
```

## admin-merged430.log

COMPLETED

```text
KASPER_ADMIN_EXPANDED: 126 native states; 2456 checks; 0 failures; fictional data; no live writes.
```

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

## build-inline-overlay.log

COMPLETED

```text
build-index: js/sv-16-kasper-baedbf6dc851.js (298341 bytes)
build-index: wrote index.html (1287574 bytes) from 67 fragment(s)
build-index: wrote src/index/INDEX.md
```

## build-latest-main.log

COMPLETED

```text
build-index: js/sv-16-kasper-7f446f6f9a66.js (316991 bytes)
build-index: wrote index.html (1305214 bytes) from 67 fragment(s)
build-index: wrote src/index/INDEX.md
```

## build-lightbox.log

COMPLETED

```text
build-index: js/sv-16-kasper-baedbf6dc851.js (298341 bytes)
build-index: wrote index.html (1287664 bytes) from 67 fragment(s)
build-index: wrote src/index/INDEX.md
```

## build-merge.log

COMPLETED

```text
build-index: js/sv-16-kasper-baedbf6dc851.js (298341 bytes)
build-index: wrote index.html (1283896 bytes) from 67 fragment(s)
build-index: wrote src/index/INDEX.md
```

## build-merged-final.log

COMPLETED

```text
build-index: js/sv-16-kasper-baedbf6dc851.js (298341 bytes)
build-index: wrote index.html (1293692 bytes) from 67 fragment(s)
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

## build-stepper.log

COMPLETED

```text
build-index: js/sv-16-kasper-baedbf6dc851.js (298341 bytes)
build-index: wrote index.html (1287850 bytes) from 67 fragment(s)
build-index: wrote src/index/INDEX.md
```

## calendar-account-diagnostic.log

FAILED / retained

```text
    }
  ]
}
```

## calendar-diagnostic.log

FAILED / retained

```text
    }
  ]
}
```

## calendar-expanded-complete.log

COMPLETED

```text
staff-calendar-expanded: OK (9450 checks; Review/Sheet/Month/Week, light/dark, menus/dialogs, loading/empty/error/saving, desktop restore; 360/390/430).
```

## calendar-expanded-fixed.log

COMPLETED

```text
staff-calendar-expanded: OK (9450 checks; Review/Sheet/Month/Week, light/dark, menus/dialogs, loading/empty/error/saving, desktop restore; 360/390/430).
```

## calendar-expanded-painted.log

FAILED / retained

```text
    }
  ]
}
```

## calendar-expanded-shipping.log

FAILED / retained

```text
    }
  ]
}
```

## calendar-expanded-stepper.log

FAILED / retained

```text
    }
  ]
}
```

## calendar-expanded-visual.log

COMPLETED

```text
staff-calendar-expanded: OK (6300 checks; Review/Sheet/Month/Week, light/dark, menus/dialogs, loading/empty/error/saving, desktop restore; 360/390/430).
```

## calendar-final-visual.log

COMPLETED

```text
staff-calendar-expanded: OK (6300 checks; Review/Sheet/Month/Week, light/dark, menus/dialogs, loading/empty/error/saving, desktop restore; 360/390/430).
```

## calendar-fixed-painted-final.log

COMPLETED

```text
staff-calendar-expanded: OK (9450 checks; Review/Sheet/Month/Week, light/dark, menus/dialogs, loading/empty/error/saving, desktop restore; 360/390/430).
```

## calendar-latest-main.log

COMPLETED

```text
staff-calendar-expanded: OK (9450 checks; Review/Sheet/Month/Week, light/dark, menus/dialogs, loading/empty/error/saving, desktop restore; 360/390/430).
```

## calendar-merged-final.log

COMPLETED

```text
staff-calendar-expanded: OK (9450 checks; Review/Sheet/Month/Week, light/dark, menus/dialogs, loading/empty/error/saving, desktop restore; 360/390/430).
```

## calendar-painted-final.log

COMPLETED

```text
staff-calendar-expanded: OK (9450 checks; Review/Sheet/Month/Week, light/dark, menus/dialogs, loading/empty/error/saving, desktop restore; 360/390/430).
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

## cards-current-main.log

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

## cards-latest-main.log

COMPLETED

```text
ok sample-reviews-430-dark-missing-media
ok sample-reviews-430-dark-linked
STAFF_PHONE_DESIGN: 16 native card states; 0 failures; fictional intercepted transports
```

## cards-merged-captures.log

COMPLETED

```text
ok sample-reviews-430-dark-missing-media
ok sample-reviews-430-dark-linked
STAFF_PHONE_DESIGN: 16 native card states; 0 failures; fictional intercepted transports
```

## cards-merged-final.log

COMPLETED

```text
ok sample-reviews-430-dark-missing-media
ok sample-reviews-430-dark-linked
STAFF_PHONE_DESIGN: 16 native card states; 0 failures; fictional intercepted transports
```

## cards-merged-visual.log

COMPLETED

```text
ok sample-reviews-430-dark-missing-media
ok sample-reviews-430-dark-linked
STAFF_PHONE_DESIGN: 16 native card states; 0 failures; fictional intercepted transports
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

## cards-shipping.log

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

## catalogue-390-inline-overlay.log

CANCELLED / superseded

```text
ok tiktok-cancel-confirm 390 dark
ok instagram-empty 390 light
ok instagram-empty 390 dark
```

## catalogue-390-shipping.log

FAILED / retained

```text
ok today-cleared 390 light
ok today-cleared 390 dark
staff-phone-final-pass: 231 renders, 1 problems
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

## catalogue-430-inline-overlay.log

CANCELLED / superseded

```text
ok instagram-frame-cover 430 dark
ok instagram-queue 430 light
ok instagram-queue 430 dark
```

## catalogue-430-shipping.log

FAILED / retained

```text
ok today-cleared 430 light
ok today-cleared 430 dark
staff-phone-final-pass: 231 renders, 1 problems
```

## catalogue-430.log

CANCELLED / superseded

```text
ok analytics-detail 430 dark
ok workload-week 430 light
ok workload-week 430 dark
```

## catalogue-client-replay.log

COMPLETED

```text
ok templates-client-facts 430 light
ok templates-client-facts 430 dark
staff-phone-final-pass: 8 renders, 0 problems
```

## catalogue-merged-focused.log

COMPLETED

```text
ok today-cleared 430 light
ok today-cleared 430 dark
staff-phone-final-pass: 80 renders, 0 problems
```

## comment-census-before.log

FAILED / retained

```text
  ok  the recovered region is the size the ledger records: 88780 characters
FAIL  no gate strips block comments with the raw regex — found in: test/staff-phone-rules-source.js
1 check(s) failed.
```

## comment-census-fixed.log

COMPLETED

```text
  ok  the recovered region is the size the ledger records: 88780 characters
  ok  no gate strips block comments with the raw regex
comment strip honesty checks passed
```

## comment-honesty-before.log

COMPLETED

```text
  ok  the recovered region is the size the ledger records: 88780 characters
  ok  no gate strips block comments with the raw regex
comment strip honesty checks passed
```

## comment-honesty-fixed.log

COMPLETED

```text
  ok  the recovered region is the size the ledger records: 88780 characters
  ok  no gate strips block comments with the raw regex
comment strip honesty checks passed
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

## commit-review.log

COMPLETED

```text
[codex/pocket-staff-phone b579a1cc] Record phone design review and current main proof
 2 files changed, 138 insertions(+), 3 deletions(-)
```

## desktop-complete.log

FAILED / retained

```text
ok   client-sample-reviews @1440: pixels identical, computed styles identical (29e7eb2d8015)
ok   client-sample-reviews @1920: pixels identical, computed styles identical (f87764b62642)
71/72 desktop shots identical to origin/main
```

## desktop-current-main.log

FAILED / retained

```text
ok   client-sample-reviews @1440: pixels identical, computed styles identical (29e7eb2d8015)
ok   client-sample-reviews @1920: pixels identical, computed styles identical (f87764b62642)
69/72 desktop shots identical to origin/main
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

## desktop-latest1024.log

COMPLETED

```text
ok   client-brief @1024: pixels identical, computed styles identical (69fabd5010fe)
ok   client-sample-reviews @1024: pixels identical, computed styles identical (7b698a748e34)
18/18 desktop shots identical to 8f66c36b503ebb3a881cf20f27dca48607e750ab
```

## desktop-latest1280.log

COMPLETED

```text
ok   client-brief @1280: pixels identical, computed styles identical (fc7b056f7e75)
ok   client-sample-reviews @1280: pixels identical, computed styles identical (d869de825d13)
18/18 desktop shots identical to 8f66c36b503ebb3a881cf20f27dca48607e750ab
```

## desktop-latest1440.log

COMPLETED

```text
ok   client-brief @1440: pixels identical, computed styles identical (6f0161af69d3)
ok   client-sample-reviews @1440: pixels identical, computed styles identical (29e7eb2d8015)
18/18 desktop shots identical to 8f66c36b503ebb3a881cf20f27dca48607e750ab
```

## desktop-latest1920-replay.log

COMPLETED

```text
ok   staff-navKasper @1920: pixels identical, computed styles identical (1cb78a8b88a7, attempts 2)
1/1 desktop shots identical to 8f66c36b503ebb3a881cf20f27dca48607e750ab
```

## desktop-latest1920.log

FAILED / retained

```text
ok   client-brief @1920: pixels identical, computed styles identical (de140d5698bd)
ok   client-sample-reviews @1920: pixels identical, computed styles identical (f87764b62642)
17/18 desktop shots identical to 8f66c36b503ebb3a881cf20f27dca48607e750ab
```

## desktop-merged1024.log

COMPLETED

```text
ok   client-brief @1024: pixels identical, computed styles identical (69fabd5010fe)
ok   client-sample-reviews @1024: pixels identical, computed styles identical (7b698a748e34)
18/18 desktop shots identical to 6a692504c664b9c6781d89e82eca51b346d408e5
```

## desktop-merged1280.log

COMPLETED

```text
ok   client-brief @1280: pixels identical, computed styles identical (fc7b056f7e75)
ok   client-sample-reviews @1280: pixels identical, computed styles identical (d869de825d13)
18/18 desktop shots identical to 6a692504c664b9c6781d89e82eca51b346d408e5
```

## desktop-merged1440.log

COMPLETED

```text
ok   client-brief @1440: pixels identical, computed styles identical (6f0161af69d3)
ok   client-sample-reviews @1440: pixels identical, computed styles identical (29e7eb2d8015)
18/18 desktop shots identical to 6a692504c664b9c6781d89e82eca51b346d408e5
```

## desktop-merged1920.log

COMPLETED

```text
ok   client-brief @1920: pixels identical, computed styles identical (7688fece9a2e)
ok   client-sample-reviews @1920: pixels identical, computed styles identical (f87764b62642)
18/18 desktop shots identical to 6a692504c664b9c6781d89e82eca51b346d408e5
```

## desktop-software-focused.log

COMPLETED

```text
ok   staff-navFilmingPlans @1024: pixels identical, computed styles identical (ddcc0a67d0fc, attempts 2)
ok   staff-navFilmingPlans @1440: pixels identical, computed styles identical (5d63f4d43ad2, attempts 2)
2/2 desktop shots identical to origin/main
```

## desktop-width1024.log

COMPLETED

```text
ok   client-brief @1024: pixels identical, computed styles identical (69fabd5010fe)
ok   client-sample-reviews @1024: pixels identical, computed styles identical (7b698a748e34)
18/18 desktop shots identical to c8375c9207c1d3522bbdc1d95e8abed3ce27ccc4
```

## desktop-width1280.log

COMPLETED

```text
ok   client-brief @1280: pixels identical, computed styles identical (fc7b056f7e75)
ok   client-sample-reviews @1280: pixels identical, computed styles identical (d869de825d13)
18/18 desktop shots identical to c8375c9207c1d3522bbdc1d95e8abed3ce27ccc4
```

## desktop-width1440.log

COMPLETED

```text
ok   client-brief @1440: pixels identical, computed styles identical (6f0161af69d3)
ok   client-sample-reviews @1440: pixels identical, computed styles identical (29e7eb2d8015)
18/18 desktop shots identical to c8375c9207c1d3522bbdc1d95e8abed3ce27ccc4
```

## desktop-width1920.log

COMPLETED

```text
ok   client-brief @1920: pixels identical, computed styles identical (de140d5698bd)
ok   client-sample-reviews @1920: pixels identical, computed styles identical (f87764b62642)
18/18 desktop shots identical to c8375c9207c1d3522bbdc1d95e8abed3ce27ccc4
```

## diff-code-complete.log

COMPLETED

No output was emitted.

## diff-complete.log

COMPLETED

No output was emitted.

## diff-current-main.log

COMPLETED

No output was emitted.

## diff-final-docs.log

COMPLETED

No output was emitted.

## diff-fixed-detector.log

COMPLETED

No output was emitted.

## diff-handoff.log

COMPLETED

No output was emitted.

## diff-receipts-final.log

COMPLETED

No output was emitted.

## diff-renumber.log

COMPLETED

No output was emitted.

## diff-review.log

COMPLETED

No output was emitted.

## docs-only-complete.log

COMPLETED

```text
STAFF_PHONE_FILES: unchanged; skip phone matrix
```

## fetch-review.log

COMPLETED

```text
From https://github.com/sidney-afk/client-analytics
 * branch              main       -> FETCH_HEAD
   cbd443a3..c8375c92  main       -> origin/main
```

## fixed-popup-detector-before.log

FAILED / retained

```text
detector missed a fixed popup collision outside a clipped ancestor
```

## hosted-latest-split-complete.log

COMPLETED

```text
2026-10-07T20:20:20.9393675Z [command]/usr/bin/git submodule foreach --recursive git config --local --show-origin --name-only --get-regexp remote.origin.url
2026-10-07T20:20:20.9835482Z Cleaning up orphan processes
2026-10-07T20:20:21.0200856Z ##[warning]Node.js 20 is deprecated. The following actions target Node.js 20 but are being forced to run on Node.js 24: actions/checkout@v4, actions/setup-node@v4. For more information see: https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/
```

## hosted-latest-split.log

FAILED / retained

No output was emitted.

## hosted-latest-unit-complete.log

COMPLETED

```text
2026-10-07T20:22:07.3837432Z github_network_0fb0b5fcacc146fe8db16711db849432
2026-10-07T20:22:07.3912375Z Cleaning up orphan processes
2026-10-07T20:22:07.4317755Z ##[warning]Node.js 20 is deprecated. The following actions target Node.js 20 but are being forced to run on Node.js 24: actions/checkout@v4, actions/setup-node@v4. For more information see: https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/
```

## hosted-merged-entry.log

FAILED / retained

```text
﻿<?xml version="1.0" encoding="utf-8"?><Error><Code>BlobNotFound</Code><Message>The specified blob does not exist.
RequestId:6bc36e4c-c01e-00c0-6594-56ee35000000
Time:2026-10-07T19:45:42.9429249Z</Message></Error>
```

## hosted-merged-split.log

FAILED / retained

```text
2026-10-07T19:42:17.4134660Z [command]/usr/bin/git submodule foreach --recursive git config --local --show-origin --name-only --get-regexp remote.origin.url
2026-10-07T19:42:17.4467885Z Cleaning up orphan processes
2026-10-07T19:42:17.4715201Z ##[warning]Node.js 20 is deprecated. The following actions target Node.js 20 but are being forced to run on Node.js 24: actions/checkout@v4, actions/setup-node@v4. For more information see: https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/
```

## hosted-merged-unit.log

FAILED / retained

```text
﻿<?xml version="1.0" encoding="utf-8"?><Error><Code>BlobNotFound</Code><Message>The specified blob does not exist.
RequestId:33426076-c01e-0079-6494-56ea2f000000
Time:2026-10-07T19:45:42.0642798Z</Message></Error>
```

## hosted-painted-split-complete.log

COMPLETED

```text
2026-10-07T19:56:09.9289994Z [command]/usr/bin/git submodule foreach --recursive git config --local --show-origin --name-only --get-regexp remote.origin.url
2026-10-07T19:56:09.9578247Z Cleaning up orphan processes
2026-10-07T19:56:09.9772992Z ##[warning]Node.js 20 is deprecated. The following actions target Node.js 20 but are being forced to run on Node.js 24: actions/checkout@v4, actions/setup-node@v4. For more information see: https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/
```

## hosted-painted-split-unavailable.log

FAILED / retained

```text
﻿<?xml version="1.0" encoding="utf-8"?><Error><Code>BlobNotFound</Code><Message>The specified blob does not exist.
RequestId:9e0a0779-801e-007e-3295-56ad87000000
Time:2026-10-07T19:54:43.2536149Z</Message></Error>
```

## hosted-painted-unit-complete.log

FAILED / retained

```text
2026-10-07T19:56:51.9992986Z github_network_a0e6dfd2732b4b7abe9864fe4f5cb82d
2026-10-07T19:56:52.0069862Z Cleaning up orphan processes
2026-10-07T19:56:52.0378675Z ##[warning]Node.js 20 is deprecated. The following actions target Node.js 20 but are being forced to run on Node.js 24: actions/checkout@v4, actions/setup-node@v4. For more information see: https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/
```

## hosted-production-superseded.log

CANCELLED / superseded

```text
production-polish	Complete job	2026-10-07T19:07:54.9761773Z Terminate orphan process: pid (2681) (node)
production-polish	Complete job	2026-10-07T19:07:54.9789802Z Terminate orphan process: pid (2693) (headless_shell)
production-polish	Complete job	2026-10-07T19:07:54.9849098Z ##[warning]Node.js 20 is deprecated. The following actions target Node.js 20 but are being forced to run on Node.js 24: actions/cache@v4, actions/checkout@v4, actions/setup-node@v4. For more information see: https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/
```

## hosted-split-preview.log

FAILED / retained

```text
2026-10-07T19:09:32.8985621Z [command]/usr/bin/git submodule foreach --recursive git config --local --show-origin --name-only --get-regexp remote.origin.url
2026-10-07T19:09:32.9304935Z Cleaning up orphan processes
2026-10-07T19:09:32.9527990Z ##[warning]Node.js 20 is deprecated. The following actions target Node.js 20 but are being forced to run on Node.js 24: actions/checkout@v4, actions/setup-node@v4. For more information see: https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/
```

## identity-complete.log

COMPLETED

```text
  files carrying at least one      0   (any is a failure)
  WHERE (counts only — this tool never prints what it matched):
This change adds no client slug and no colleague's name ✅
```

## identity-current-main.log

COMPLETED

```text
  files carrying at least one      0   (any is a failure)
  WHERE (counts only — this tool never prints what it matched):
This change adds no client slug and no colleague's name ✅
```

## identity-final-docs.log

COMPLETED

```text
  files carrying at least one      0   (any is a failure)
  WHERE (counts only — this tool never prints what it matched):
This change adds no client slug and no colleague's name ✅
```

## identity-final-head.log

COMPLETED

```text
  files carrying at least one      0   (any is a failure)
  WHERE (counts only — this tool never prints what it matched):
This change adds no client slug and no colleague's name ✅
```

## identity-latest-main.log

COMPLETED

```text
  files carrying at least one      0   (any is a failure)
  WHERE (counts only — this tool never prints what it matched):
This change adds no client slug and no colleague's name ✅
```

## identity-merged-final.log

FAILED / retained

```text
identity exposure check failed: git diff failed (status null)
```

## identity-merged-pruned.log

FAILED / retained

```text
identity exposure check failed: git diff failed (status null)
```

## identity-push.log

COMPLETED

```text
  files carrying at least one      0   (any is a failure)
  WHERE (counts only — this tool never prints what it matched):
This change adds no client slug and no colleague's name ✅
```

## identity-shipping-head.log

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

## index-complete.log

COMPLETED

```text
check-index: working-tree index.html — sha256=3e488ff24df9b1d7d50e3136686cf6ac7c8e4369fefd79c2df459051b2da1845 bytes=1287850
check-index: committed index.html (HEAD) — sha256=3e488ff24df9b1d7d50e3136686cf6ac7c8e4369fefd79c2df459051b2da1845 bytes=1287850
check-index: OK — assembled == working tree == committed (HEAD)
```

## index-current-main.log

COMPLETED

```text
check-index: working-tree index.html — sha256=01276417888eb2b6bd3f79afdf8e2e2eb9de482d87c46b77b7fa0a6054bd7165 bytes=1287574
check-index: committed index.html (HEAD) — sha256=01276417888eb2b6bd3f79afdf8e2e2eb9de482d87c46b77b7fa0a6054bd7165 bytes=1287574
check-index: OK — assembled == working tree == committed (HEAD)
```

## index-final-review.log

COMPLETED

```text
check-index: working-tree index.html — sha256=669130ebc23921fb98f7d989273984651f0b56c9ebdc2f7aa6260aa221d5680a bytes=1293692
check-index: committed index.html (HEAD) — sha256=669130ebc23921fb98f7d989273984651f0b56c9ebdc2f7aa6260aa221d5680a bytes=1293692
check-index: OK — assembled == working tree == committed (HEAD)
```

## index-final.log

FAILED / retained

```text
check-index: FAIL — assembled bytes do not equal committed index.html (HEAD)
check-index: FAIL — working-tree index.html does not equal committed index.html (HEAD)
check-index: FAILED
```

## index-latest-main.log

COMPLETED

```text
check-index: working-tree index.html — sha256=34abdeeb12d094016ad6534933d7da3e95b83fd5dd9e1272277ac6e9aad3de09 bytes=1305214
check-index: committed index.html (HEAD) — sha256=34abdeeb12d094016ad6534933d7da3e95b83fd5dd9e1272277ac6e9aad3de09 bytes=1305214
check-index: OK — assembled == working tree == committed (HEAD)
```

## index-merged-final.log

COMPLETED

```text
check-index: working-tree index.html — sha256=669130ebc23921fb98f7d989273984651f0b56c9ebdc2f7aa6260aa221d5680a bytes=1293692
check-index: committed index.html (HEAD) — sha256=669130ebc23921fb98f7d989273984651f0b56c9ebdc2f7aa6260aa221d5680a bytes=1293692
check-index: OK — assembled == working tree == committed (HEAD)
```

## index-pruned-final.log

COMPLETED

```text
check-index: working-tree index.html — sha256=669130ebc23921fb98f7d989273984651f0b56c9ebdc2f7aa6260aa221d5680a bytes=1293692
check-index: committed index.html (HEAD) — sha256=669130ebc23921fb98f7d989273984651f0b56c9ebdc2f7aa6260aa221d5680a bytes=1293692
check-index: OK — assembled == working tree == committed (HEAD)
```

## index-settled.log

FAILED / retained

```text
check-index: FAIL — assembled bytes do not equal committed index.html (HEAD)
check-index: FAIL — working-tree index.html does not equal committed index.html (HEAD)
check-index: FAILED
```

## index-shipping-head.log

COMPLETED

```text
check-index: working-tree index.html — sha256=669130ebc23921fb98f7d989273984651f0b56c9ebdc2f7aa6260aa221d5680a bytes=1293692
check-index: committed index.html (HEAD) — sha256=669130ebc23921fb98f7d989273984651f0b56c9ebdc2f7aa6260aa221d5680a bytes=1293692
check-index: OK — assembled == working tree == committed (HEAD)
```

## lazy-complete.log

COMPLETED

```text
approve path reaching into on-demand areas: 2 hazards, 26 import ties
  synclinear: PROD_WRITE_EF_URL, _prodCanWrite, _prodCanonicalCommentGate, _prodCardCommentsPending, _prodClientCommentGatewayContext, _prodComments, _prodCommentsSkeletonHtml, _prodGatewayWrite, _prodIssue, _prodProjectCanonicalCardComments, _prodRestRows, _prodToast, _prodVerifiedClientCommentMutationContext, _prodWriteErrorText
check-lazy-safety: all checks passed (38 recorded hazards)
```

## lazy-current-main.log

COMPLETED

```text
approve path reaching into on-demand areas: 2 hazards, 26 import ties
  synclinear: PROD_WRITE_EF_URL, _prodCanWrite, _prodCanonicalCommentGate, _prodCardCommentsPending, _prodClientCommentGatewayContext, _prodComments, _prodCommentsSkeletonHtml, _prodGatewayWrite, _prodIssue, _prodProjectCanonicalCardComments, _prodRestRows, _prodToast, _prodVerifiedClientCommentMutationContext, _prodWriteErrorText
check-lazy-safety: all checks passed (38 recorded hazards)
```

## lazy-latest-main.log

COMPLETED

```text
approve path reaching into on-demand areas: 2 hazards, 26 import ties
  synclinear: PROD_WRITE_EF_URL, _prodCanWrite, _prodCanonicalCommentGate, _prodCardCommentsPending, _prodClientCommentGatewayContext, _prodComments, _prodCommentsSkeletonHtml, _prodGatewayWrite, _prodIssue, _prodProjectCanonicalCardComments, _prodRestRows, _prodToast, _prodVerifiedClientCommentMutationContext, _prodWriteErrorText
check-lazy-safety: all checks passed (38 recorded hazards)
```

## lazy-merged-final.log

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

## map-complete.log

FAILED / retained

```text
  requireStack: []
}
Node.js v22.12.0
```

## map-current-main.log

COMPLETED

```text
OK  REPO_MAP.md path `docs/syncview-design/proofs/staff-calendar-expanded/README.md` exists
OK  REPO_MAP.md path `docs/syncview-design/tests/phone-thumbnail-comparison.js` exists
repo-map-sync: 1116 passed, 0 failed
```

## map-latest-main.log

COMPLETED

```text
OK  REPO_MAP.md path `docs/syncview-design/proofs/staff-calendar-expanded/README.md` exists
OK  REPO_MAP.md path `docs/syncview-design/tests/phone-thumbnail-comparison.js` exists
repo-map-sync: 1116 passed, 0 failed
```

## map-merged-final.log

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

## map-source-complete.log

COMPLETED

```text
OK  REPO_MAP.md path `docs/syncview-design/proofs/staff-calendar-expanded/README.md` exists
OK  REPO_MAP.md path `docs/syncview-design/tests/phone-thumbnail-comparison.js` exists
repo-map-sync: 1116 passed, 0 failed
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

## merge-final-diff.log

COMPLETED

```text
docs/ops/OPEN_REPAIRS.md:30866: new blank line at EOF.
```

## merge-final-main.log

FAILED / retained

```text
Auto-merging src/index/INDEX.md
CONFLICT (content): Merge conflict in src/index/INDEX.md
Automatic merge failed; fix conflicts and then commit the result.
```

## merge-latest-diff.log

COMPLETED

```text
docs/ops/OPEN_REPAIRS.md:30884: new blank line at EOF.
```

## merge-shipping-main.log

FAILED / retained

```text
Auto-merging src/index/INDEX.md
CONFLICT (content): Merge conflict in src/index/INDEX.md
Automatic merge failed; fix conflicts and then commit the result.
```

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
typeof guards in modules: 514; unresolvable: 0
minified parts: 19 files, 2628 KB, 5162 top-level names, 0 lost, 0 changed kind
check-modules: all checks passed
```

## modules-current-main.log

COMPLETED

```text
typeof guards in modules: 514; unresolvable: 0
minified parts: 19 files, 2628 KB, 5162 top-level names, 0 lost, 0 changed kind
check-modules: all checks passed
```

## modules-latest-main.log

COMPLETED

```text
typeof guards in modules: 517; unresolvable: 0
minified parts: 19 files, 2651 KB, 5211 top-level names, 0 lost, 0 changed kind
check-modules: all checks passed
```

## modules-merged-final.log

COMPLETED

```text
typeof guards in modules: 514; unresolvable: 0
minified parts: 19 files, 2633 KB, 5180 top-level names, 0 lost, 0 changed kind
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

## push-review.log

COMPLETED

```text
To https://github.com/sidney-afk/client-analytics.git
   06d84e8c..b579a1cc  codex/pocket-staff-phone -> codex/pocket-staff-phone
```

## rules-complete.log

FAILED / retained

```text
detector missed a real collision in the visible part of a clipped row
```

## rules-final.log

CANCELLED / superseded

```text
ok sample-reviews-dark-390 screen, menus, layout and scroll lock
ok sample-reviews-light-430 screen, menus, layout and scroll lock
ok sample-reviews-dark-430 screen, menus, layout and scroll lock
```

## rules-fixed-painted-final.log

COMPLETED

```text
ok time-off-light-430 screen, menus, layout and scroll lock
ok time-off-dark-430 screen, menus, layout and scroll lock
STAFF_PHONE_RULES: 160 states; 0 failures; 390/430 touch; synthetic transports; no live writes
```

## rules-inline-overlay.log

COMPLETED

```text
ok time-off-light-430 screen, menus, layout and scroll lock
ok time-off-dark-430 screen, menus, layout and scroll lock
STAFF_PHONE_RULES: 160 states; 0 failures; 390/430 touch; synthetic transports; no live writes
```

## rules-latest-main.log

COMPLETED

```text
ok time-off-light-430 screen, menus, layout and scroll lock
ok time-off-dark-430 screen, menus, layout and scroll lock
STAFF_PHONE_RULES: 160 states; 0 failures; 390/430 touch; synthetic transports; no live writes
```

## rules-merged-final.log

COMPLETED

```text
ok time-off-light-430 screen, menus, layout and scroll lock
ok time-off-dark-430 screen, menus, layout and scroll lock
STAFF_PHONE_RULES: 160 states; 0 failures; 390/430 touch; synthetic transports; no live writes
```

## rules-painted-complete.log

COMPLETED

```text
ok time-off-light-430 screen, menus, layout and scroll lock
ok time-off-dark-430 screen, menus, layout and scroll lock
STAFF_PHONE_RULES: 160 states; 0 failures; 390/430 touch; synthetic transports; no live writes
```

## rules-shipping.log

COMPLETED

```text
ok time-off-light-430 screen, menus, layout and scroll lock
ok time-off-dark-430 screen, menus, layout and scroll lock
STAFF_PHONE_RULES: 160 states; 0 failures; 390/430 touch; synthetic transports; no live writes
```

## scope-complete.log

COMPLETED

```text
staff-calendar-phone-css-scope: OK (1 block(s), 396 braces, all under @media (max-width: <=767px) and #calView[data-pocket-staff-phone])
```

## scope-merged-final.log

COMPLETED

```text
staff-calendar-phone-css-scope: OK (1 block(s), 396 braces, all under @media (max-width: <=767px) and #calView[data-pocket-staff-phone])
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

## source-complete.log

COMPLETED

```text
staff-phone-rules-source: artifact CSS/JS transplanted byte-identically; 61 rules phone-capped and staff-scoped
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

## source-final-review.log

COMPLETED

```text
staff-phone-rules-source: artifact CSS/JS transplanted byte-identically; 61 rules phone-capped and staff-scoped
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

## source-latest-main.log

COMPLETED

```text
staff-phone-rules-source: artifact CSS/JS transplanted byte-identically; 61 rules phone-capped and staff-scoped
```

## source-lightbox.log

COMPLETED

```text
staff-phone-rules-source: artifact CSS/JS transplanted byte-identically; 59 rules phone-capped and staff-scoped
```

## source-merged-final.log

COMPLETED

```text
staff-phone-rules-source: artifact CSS/JS transplanted byte-identically; 61 rules phone-capped and staff-scoped
```

## source-review.log

COMPLETED

```text
staff-phone-rules-source: artifact CSS/JS transplanted byte-identically; 58 rules phone-capped and staff-scoped
```

## source-safe-parser-final.log

COMPLETED

```text
staff-phone-rules-source: artifact CSS/JS transplanted byte-identically; 61 rules phone-capped and staff-scoped
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

## tiktok-current-main.log

COMPLETED

```text
ok tiktok-posting 430 light
ok tiktok-posting 430 dark
staff-phone-final-pass: 64 renders, 0 problems
```

## truth-complete.log

FAILED / retained

```text
  requireStack: []
}
Node.js v22.12.0
```

## truth-current-main.log

COMPLETED

```text
OK  migrations/sales-intake-migration.sql is labelled as deployed historical schema
OK  migrations/sales-intake-migration.sql contains no current manual-rollout instruction
truth-sync: 515 passed, 0 failed
```

## truth-latest-main.log

COMPLETED

```text
OK  migrations/sales-intake-migration.sql is labelled as deployed historical schema
OK  migrations/sales-intake-migration.sql contains no current manual-rollout instruction
truth-sync: 515 passed, 0 failed
```

## truth-merged-final.log

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

## truth-source-complete.log

COMPLETED

```text
OK  migrations/sales-intake-migration.sql is labelled as deployed historical schema
OK  migrations/sales-intake-migration.sql contains no current manual-rollout instruction
truth-sync: 515 passed, 0 failed
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
