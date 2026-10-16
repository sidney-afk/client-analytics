# Calendar/Samples check receipts

## Entry-links refresh repair

The branch subsequently conflicted with new main commits. Main `71f684554e95f6a9b5ddc2167685fcc2979477c4` is now integrated, preserving the new card viewer, notification link and all CI checks. The complete dialog suite and required gateway pass on that integration. The refreshed full desktop comparison ends `1/1 desktop shots identical to origin/main`; its public pair is unchanged byte for byte. The new viewer test reproduced a stale phone journey locally (it waited for an editable card while Sheet displayed Grid). It now enters the retained List, and its full unchanged assertions end `frameio-viewer-browser: all checks passed`.

The committed build was replayed locally and reproduced the 210px phone Review jump and the Month fixture scrolling the window instead of the content region. The fix captures the actual phone content scroller and includes stable grid anchors/focus IDs. The existing refresh runner now scrolls that region and enters the retained List; its assertions and 2px rounding tolerance are unchanged. A new collection regression also verifies a row inserted above the grid keeps the visible tile and focus in Calendar and Samples at 390/430 in both themes.

Actual final lines of `calendar-refresh-final.log`, `calendar-grid-refresh.log`, `calendar-repair-gateway.log` and `calendar-repair-desktop.log`:

```text
calendar-refresh-scroll-browser: PASS (16 checks: 8 insertion views, 5 moved-card cases, 2 live-UI cases, 1 invisible-refresh case)
STAFF_PHONE_COLLECTIONS: 100 screen/theme/width captures; all assertions passed; fictional data; no live writes
prod-write-gateway-browser: mirror operations plus Submit and Calendar native intake passed
1/1 desktop shots identical to b98f90f9e903d873358388a446430d4bbc082a07
```

Fictional intercepted transports; no live writes. Earlier attempts remain in the private evidence directory. The post-recovery checks use refreshed main. Older broader guards below are labelled by their saved invocation.

## release-screens-v2.log

```text
ok Thumb collections 430 dark: native navigation, menu, selection, review, empty/loading/error, no overlap
STAFF_PHONE_COLLECTIONS: 100 screen/theme/width captures; all assertions passed; fictional data; no live writes
```

## recovery-popups.log

```text

popup-behaviour-browser: all 376 checks passed
```

## recovery-notify-final.log

```text
notify-client-browser: 266 checks passed
```

## recovery-write-gateway.log

```text
--- phase: archive_park_sub_issues ---
prod-write-gateway-browser: mirror operations plus Submit and Calendar native intake passed
```

## recovery-desktop.log

```text

1/1 desktop shots identical to origin/main
```

## responsiveness-final.log

```text
ok Samples-dark-430 useful=179ms tap=17ms
STAFF_PHONE_RESPONSIVENESS: 92 measurements; 0 failures; fictional transports only
```

## rules-current-main.log

```text
ok sample-reviews-dark-430 screen, menus, layout and scroll lock
STAFF_PHONE_RULES: 40 states; 0 failures; 390/430 touch; synthetic transports; no live writes
```

## round-two.log

```text
ok round-two 430 dark
STAFF_PHONE_ROUND_TWO: 4 width/theme journeys; 144 sheet dismissals; 0 failures; fictional data only
```

## calendar-expanded-replay.log

```text
staff-calendar-expanded: OK (6336 checks; Review/Sheet/Month/Week, light/dark, menus/dialogs, loading/empty/error/saving, desktop restore; 390/430).
```

## selection-samples-replay.log

```text
staff-selection-samples: OK (4811 checks; Selection, Samples Review/Sheet, light/dark, dialogs, loading/empty/error/saving and desktop restore; 360/390/430).
```

## recovery-truth-final.log

```text

truth-sync: 522 passed, 0 failed
```

## recovery-repo-map.log

```text

repo-map-sync: 1189 passed, 0 failed
```

## Earlier failures retained

The first full Windows unit run had 24 failures. Three candidate problems were repaired; all 21 remaining failures reproduced on pristine main (Windows module paths, permissions and other existing platform failures). Linux hosted CI remains required. The initial final-pass transcript timeout passed its focused replay; the complete refreshed inventory is running again. One early desktop reviewer PNG mismatch passed exact replay; earlier populated Samples warm PNG attempts failed and are retained. A post-recovery populated attempt compared a reference loader against an assembled candidate; the helper now uses the same source format on both sides and retains exact pixel/style assertions. A source-fidelity attempt caught CRLF conversion; fragments were restored to LF and byte fidelity passes. The Notify journey was updated for main’s added scenarios.

## Hosted findings repaired

The first phone CI matrix caught the native caption below the reduced keyboard viewport. Its phone max-height is now bounded; the unchanged keyboard assertion passes at both widths. The backdrop gate caught the new Calendar sheet missing its press-origin guard and inventory case. Both are added; the new browser case passes a real inside-to-outside drag and ordinary outside click. No exception was added. The client boot lane failed its streamed-first-paint assertion; a local replay timed out earlier in that existing suite. Neither is called green.

### native-font-screens.log

```text
ok Thumb collections 430 dark: native navigation, menu, selection, review, empty/loading/error, no overlap
STAFF_PHONE_COLLECTIONS: 100 screen/theme/width captures; all assertions passed; fictional data; no live writes
```

### keyboard-replay.log

```text
ok calendar-dark-430 screen, menus, layout and scroll lock
STAFF_PHONE_RULES: 28 states; 0 failures; 390/430 touch; synthetic transports; no live writes
```

### backdrop-new-sheet-final.log

```text
  Phone Calendar view
dialog-backdrop-press-browser ok
```

## Split-build replay

The hosted split lane caught a wrapped title losing its border-height pixels. The native phone autosizer now includes the border; its cache and desktop restoration are unchanged. The complete backdrop suite also required clearing the previous fictional client before entering the new phone fixture; it now keeps the unchanged zero-write assertion. A supplemental Samples phone-to-desktop fixture comparison still differs in 13 antialiased edge pixels, with exact computed styles and bounding rectangles. Cold populated Samples/Calendar pairs and the required desktop gate match exactly. No pixel tolerance, exception, or skip was introduced.

### expanded-split-replay.log

```text
staff-calendar-expanded: OK (6392 checks; Review/Sheet/Month/Week, light/dark, menus/dialogs, loading/empty/error/saving, desktop restore; 390/430).
```

### backdrop-full-final.log

```text
  Staff sign-in (start-up gate)
dialog-backdrop-press-browser ok
```

### calendar-final-reviewed.log

```text
ok Thumb collections 430 dark: native navigation, menu, selection, review, empty/loading/error, no overlap
STAFF_PHONE_COLLECTIONS: 100 screen/theme/width captures; all assertions passed; fictional data; no live writes
```

### gateway-final.log

```text
--- phase: archive_park_sub_issues ---
prod-write-gateway-browser: mirror operations plus Submit and Calendar native intake passed
```

## Status-filter and review follow-up

The original status-filter runner reproduced the phone failure (0 instead of 6).
Its source is unchanged. Grid now preserves the native strip/card entities, with
all six cards represented by visible thumbnail buttons. No hidden editor copies,
check skips, CI exceptions or assertion changes were added.

The additional collection guards cover Back/Forward/Reload, Drive-access failure
instructions and native Create sample completion. Their transports are fictional
and fully intercepted. Earlier failed attempts remain private; only final safe
command tails and screenshots are published here.

### calendar-status-unchanged-final.log

```text
calendar-card-status-filter: OK (77 checks; desktop and phone; Sheet, Month, Week, Review)
```

### calendar-status-layout-final-collections.log

```text
ok Thumb collections 430 light: native navigation, menu, selection, review, empty/loading/error, no overlap
ok Thumb collections 430 dark: native navigation, menu, selection, review, empty/loading/error, no overlap
STAFF_PHONE_COLLECTIONS: 112 screen/theme/width captures; all assertions passed; fictional data; no live writes
```

### calendar-status-layout-refresh.log

```text
ok  refresh held in flight: screenshots before, during, right after and 1.5 s after match
  ok  typing in a caption while a teammate edits another card: that card redrawn at once; the caption keeps its node, focus, caret 53:53, text and look
calendar-refresh-scroll-browser: PASS (16 checks: 8 insertion views, 5 moved-card cases, 2 live-UI cases, 1 invisible-refresh case)
```

### calendar-review-viewer-final.log

```text
ok  switch: Kasper: no page errors ()

frameio-viewer-browser: all checks passed
```

### calendar-status-layout-gateway.log

```text
--- phase: calendar_native_intake ---
--- phase: archive_park_sub_issues ---
prod-write-gateway-browser: mirror operations plus Submit and Calendar native intake passed
```

### calendar-status-final-desktop.log

```text
ok   staff-navCalendar @1440: pixels identical, computed styles identical (1b87d864520a)

1/1 desktop shots identical to origin/main
```

### calendar-status-modules.log

```text
minified parts: 20 files, 2855 KB, 5586 top-level names, 0 lost, 0 changed kind

check-modules: all checks passed
```

## Main integration and fresh evidence, 2026-10-16

Both merges preserve the publish-time build contract. The original merge target was 72062c1f; main advanced to ef8da61a while checks ran, so the final Cinema implementation was merged too and affected captures/checks were rerun. No build output is tracked and no CI condition was changed. No OPEN_REPAIRS number was allocated.

Screens were retaken and manually reviewed against #1950 direction A (Expanded), with #2082 retaining authority over the grid/agenda navigation. The initial new Tabs assertions needed the actual per-area shell and native anchor role; the corrected fixture asserts the visible native Post link and icon. The media-icon phone journey enters List; all 56 original assertions remain.

Retained earlier attempts: the first gateway replay on 72062c1f timed out waiting for the description link editor to return focus. The unchanged replay passed, and the final ef8da61a run passes. The broader 72062c1f Calendar inventory was interrupted when main advanced; it is not counted as a pass. Final acceptance uses the full Expanded Calendar and Selection/Samples suites, the collection capture suite and the focused integration guards below. No check was skipped or loosened.

### calendar-cinema-phone.log

```text
STAFF_PHONE_COLLECTIONS: 120 screen/theme/width captures; all assertions passed; fictional data; no live writes
```

### calendar-cinema-expanded.log

```text
staff-calendar-expanded: OK (6416 checks; Review/Sheet/Month/Week, light/dark, menus/dialogs, loading/empty/error/saving, desktop restore; 390/430).
```

### calendar-cinema-samples.log

```text
staff-selection-samples: OK (4802 checks; Selection, Samples Review/Sheet, light/dark, dialogs, loading/empty/error/saving and desktop restore; 360/390/430).
```

### calendar-cinema-status.log

```text
calendar-card-status-filter: OK (77 checks; desktop and phone; Sheet, Month, Week, Review)
```

### calendar-cinema-scroll.log

```text
calendar-refresh-scroll-browser: PASS (16 checks: 8 insertion views, 5 moved-card cases, 2 live-UI cases, 1 invisible-refresh case)
```

### calendar-cinema-icons.log

```text
calendar-prod-button-icons: OK (56 checks; desktop light and dark, phone, Samples twin)
```

### calendar-cinema.log

```text
frameio-viewer-browser: all checks passed
```

### calendar-cinema-post.log

```text
post-tab-browser: 58 checks passed ✅
```

### calendar-cinema-open-calendar.log

```text
open-in-calendar-browser: all checks passed
```

### calendar-cinema-backdrop.log

```text
dialog-backdrop-press-browser ok
```

### calendar-cinema-gateway.log

```text
prod-write-gateway-browser: mirror operations plus Submit and Calendar native intake passed
```

### calendar-cinema-desktop.log

```text
1/1 desktop shots identical to origin/main
```

### calendar-cinema-index.log

```text
check-index: OK - the build succeeds, two builds are byte-identical, and no output (index.html, js/sv-*.js, src/index/INDEX.md) is committed
```

### calendar-cinema-map.log

```text
repo-map-sync: 1223 passed, 0 failed
```

### calendar-cinema-truth.log

```text
truth-sync: 524 passed, 0 failed
```

### calendar-cinema-modules.log

```text
check-modules: all checks passed
```

## Canonical phone-rules transplant follow-up

Merged current main 6c962496 (including merged #2087) without rebasing. Resolved both phone areas' styles, test registrations, readiness selectors, dialog cases and documentation together, preserving every check. A full marked-block comparison found exactly one source/fragment difference: `cards()` must exclude `.thumb-grid-card` wrappers. The canonical `docs/syncview-design/staff-phone-rules.js` now matches the fragment; the fragment and `test/staff-phone-rules-source.js` were not changed for the correction. Earlier image capture provenance remains unchanged; this synchronization changes no rendered layout.

```text
staff-phone-rules-source: artifact CSS/JS transplanted byte-identically; 126 rules phone-capped and staff-scoped
check-index: OK - the build succeeds, two builds are byte-identical, and no output (index.html, js/sv-*.js, src/index/INDEX.md) is committed
```
