# Calendar/Samples check receipts

## Entry-links refresh repair

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
