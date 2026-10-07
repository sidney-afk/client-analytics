# Actual check tails

This is an active batch checkpoint. Initial discovery captures are not a frozen-source clean round. A source update during broad discovery means later rounds must regenerate all captures from one frozen tree. No visual claim is inferred from a green machine result.

The initial staff-rule footer hardcodes 390/430; its invocation actually supplied 375,390,430. The runner footer now prints the supplied widths.

The first index check failed because assembled/working-tree bytes differed from pre-change committed HEAD. The committed rebuild subsequently passed; its exact final tail is recorded below.

The obsolete desktop-final invocation was stopped after the loading source changed. Its partial tail is retained and is not a pass.

## Staff rules initial discovery

```text
ok time-off-dark-375 screen, menus, layout and scroll lock
ok time-off-light-390 screen, menus, layout and scroll lock
ok time-off-dark-390 screen, menus, layout and scroll lock
ok time-off-light-430 screen, menus, layout and scroll lock
ok time-off-dark-430 screen, menus, layout and scroll lock
STAFF_PHONE_RULES: 240 states; 0 failures; 390/430 touch; synthetic transports; no live writes
```

## Staff design

```text
ok sample-reviews-390-dark-linked
ok sample-reviews-430-light-missing-media
ok sample-reviews-430-light-linked
ok sample-reviews-430-dark-missing-media
ok sample-reviews-430-dark-linked
STAFF_PHONE_DESIGN: 24 native card states; 0 failures; fictional intercepted transports
```

## Client actions light and dark

```text
ok   samples small Android 360x800 light
ok   samples small Android 360x800 dark
ok   samples iPhone SE landscape 667x375 light
ok   samples iPhone SE landscape 667x375 dark

client-phone-review: OK (calendar + samples, 5 phone sizes each, light + dark, approve + request change)
```

## Staff catalogue 375 initial discovery

```text
ok samples-more 375 dark
ok samples-tabs 375 light
ok samples-tabs 375 dark
ok today-cleared 375 light
ok today-cleared 375 dark
staff-phone-final-pass: 232 renders, 0 problems
```

## Admin initial discovery

```text
KASPER_ADMIN_EXPANDED: 378 native states; 7422 checks; 0 failures; fictional data; no live writes.
```

## Final focused admin states and actions

```text
KASPER_ADMIN_EXPANDED: 60 native states; 876 checks; 0 failures; fictional data; no live writes.
```

## Desktop default credential failure

```text
SYNCVIEW_STAFF_KEY is required to resolve the current TEST-client token
```

## Desktop first read-only full invocation FAILED

```text
ok   client-sample-reviews @1024: pixels identical, computed styles identical (7b698a748e34)
ok   client-sample-reviews @1280: pixels identical, computed styles identical (d869de825d13)
ok   client-sample-reviews @1440: pixels identical, computed styles identical (29e7eb2d8015)
ok   client-sample-reviews @1920: pixels identical, computed styles identical (f87764b62642)

70/72 desktop shots identical to 1c64ddee5250071af478db45f2332c275072259d
```

## Desktop superseded source invocation STOPPED

```text
ok   staff-navLinear @1024: pixels identical, computed styles identical (cf22bf546a1d)
ok   staff-navLinear @1440: pixels identical, computed styles identical (03875f804194)
ok   staff-navLinear @1280: pixels identical, computed styles identical (4235249bad93)
ok   staff-navLinear @1920: pixels identical, computed styles identical (53b291175396)
ok   staff-navKasper @1920: pixels identical, computed styles identical (0653aa66b0ff)
ok   staff-navKasper @1440: pixels identical, computed styles identical (e42ba9ef727f, attempts 2)
```

## Final frozen-source desktop invocation FAILED

```text
ok   client-sample-reviews @1024: pixels identical, computed styles identical (7b698a748e34)
ok   client-sample-reviews @1280: pixels identical, computed styles identical (d869de825d13)
ok   client-sample-reviews @1440: pixels identical, computed styles identical (29e7eb2d8015)
ok   client-sample-reviews @1920: pixels identical, computed styles identical (f87764b62642)

71/72 desktop shots identical to 1c64ddee5250071af478db45f2332c275072259d
```

The one surviving failure is Kasper/1280: ten differing pixels within x1260..1261/y19..39, with identical computed styles. The cause is UNPROVEN.

## Unchanged strict Kasper/1280 replay PASSED

```text
ok   staff-navKasper @1280: pixels identical, computed styles identical (930dda7c3d45, attempts 4)

1/1 desktop shots identical to 1c64ddee5250071af478db45f2332c275072259d
```

All 72 distinct page/width cells have exact PNG/style matches: 71 final-full matches plus this one strict replay. The full invocation is still FAILED. No threshold or exclusion was changed. Public hashes and all invocation statuses are in [desktop receipts](desktop.json); live raw images remain private.

## Repository map

```text
OK  REPO_MAP.md path `test/staff-calendar-phone-css-scope.js` exists
OK  REPO_MAP.md path `docs/syncview-design/tests/staff-calendar-expanded-browser.js` exists
OK  REPO_MAP.md path `docs/syncview-design/proofs/staff-calendar-expanded/README.md` exists
OK  REPO_MAP.md path `docs/syncview-design/tests/phone-thumbnail-comparison.js` exists

repo-map-sync: 1118 passed, 0 failed
```

## Truth sync

```text
OK  migrations/title-review-migration.sql is labelled as deployed historical schema
OK  migrations/title-review-migration.sql contains no current manual-rollout instruction
OK  migrations/sales-intake-migration.sql is labelled as deployed historical schema
OK  migrations/sales-intake-migration.sql contains no current manual-rollout instruction

truth-sync: 515 passed, 0 failed
```

## Updated full admin catalogue

```text
KASPER_ADMIN_EXPANDED: 396 native states; 7758 checks; 0 failures; fictional data; no live writes.
```

## Committed index rebuild

```text
check-index: assembled bytes — sha256=b8cd1929bdda90474bd1c6348364280e6b3b7edb87c78ddd5cd54cf533e85dbf bytes=1311526
check-index: working-tree index.html — sha256=b8cd1929bdda90474bd1c6348364280e6b3b7edb87c78ddd5cd54cf533e85dbf bytes=1311526
check-index: committed index.html (HEAD) — sha256=b8cd1929bdda90474bd1c6348364280e6b3b7edb87c78ddd5cd54cf533e85dbf bytes=1311526

check-index: OK — assembled == working tree == committed (HEAD)
```

## Phone source and scope guards

```text
KASPER_ADMIN_SCOPE: 270 rules; all capped at 767px and owned marker; widened/unscoped rules rejected.
staff-phone-rules-source: artifact CSS/JS transplanted byte-identically; 61 rules phone-capped and staff-scoped
client-phone-css-scope: OK (6 block(s), 458 braces, all under @media (max-width: <=767px) and html.boot-client)
staff-phone-css-scope: OK (1 block(s), 367 braces, all under @media (max-width: <=767px) and body:has(.pocket-staff-bar))
finch-phone-css-scope: OK (1 block(s), 367 braces, all under @media (max-width: <=767px) and html.fph-on)
kasper-phone-css-scope: OK (1 block(s), 24 braces, all under @media (max-width: <=767px) and the Kasper review scope)
staff-calendar-phone-css-scope: OK (1 block(s), 396 braces, all under @media (max-width: <=767px) and #calView[data-pocket-staff-phone])
staff-selection-phone-css-scope: OK (1 block(s), 30 braces, all under @media (max-width: <=767px) and #calView[data-pocket-staff-phone])
staff-samples-phone-css-scope: OK (1 block(s), 344 braces, all under @media (max-width: <=767px) and #sxrView[data-pocket-staff-samples])
```

## Final identity exposure check

```text
  roster terms checked             53   (client slugs + staff full names)
  terms this change adds           0   (0 client slugs, 0 staff names)
  files carrying at least one      0   (any is a failure)

  WHERE (counts only — this tool never prints what it matched):

This change adds no client slug and no colleague's name ✅
```

## Coverage and catalogue metadata

```text
PHONE_COVERAGE: 325 native states; 1950 width/theme cells; 280 discovery obligations; 36 clean cells
client-calendar-expanded: 30 unique native catalogue entries; browser not launched
client-links-expanded: 35 unique native catalogue entries; browser not launched
```

The client expanded entries are existing native journeys, currently OPEN. The legacy Brief entry is a phone redirect discovery check, not a separate reachable Brief screen. The staff 390/430 discovery job finished with 464 renders/zero problems; its captures used fallback fonts and are not accepted final visual evidence.

## Staff catalogue 390/430 initial discovery

```text
ok samples-tabs 430 dark
ok today-cleared 390 light
ok today-cleared 390 dark
ok today-cleared 430 light
ok today-cleared 430 dark
staff-phone-final-pass: 464 renders, 0 problems
```

## Artifact integrity and staged whitespace

```text
ARTIFACTS: 78 fixture PNG hashes, 36 source-bound personal reviews and 72 distinct desktop receipts verified.
```

`git diff --cached --check` exited 0 with no output after staging the final batch.
