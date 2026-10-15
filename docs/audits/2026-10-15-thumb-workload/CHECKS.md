# Workload check receipts

Actual final lines; intercepted fictional fixtures. No live write.

## workload-reviewed-screens.log

```text
ok Workload 430 dark: agenda, queue, exact native item, filters, planning, empty/loading/error
STAFF_PHONE_WORKLOAD: 48 screen/theme/width captures; all assertions passed; fictional transports; no live writes
```

## workload-existing.log

```text
ok workload-plan-due-expanded 430 dark
staff-phone-final-pass: 44 renders, 8 problems
```

## workload-filter-replay.log

```text
ok workload-clients-search 430 dark
staff-phone-final-pass: 8 renders, 0 problems
```

## workload-responsiveness-replay.log

```text
ok Workload-dark-430 useful=322ms tap=29ms
STAFF_PHONE_RESPONSIVENESS: 12 measurements; 0 failures; fictional transports only
```

## workload-popups.log

```text

popup-behaviour-areas-browser: all 186 checks passed
```

## workload-backdrop-replay2.log

```text
  Phone Workload filters
dialog-backdrop-press-browser ok
```

## workload-rules.log

```text
ok workload-dark-430 screen, menus, layout and scroll lock
STAFF_PHONE_RULES: 12 states; 0 failures; 390/430 touch; synthetic transports; no live writes
```

## workload-unit-replay.log

```text

OVERALL: PASS
```

## workload-desktop-final.log

```text

1/1 desktop shots identical to origin/main
```

## workload-write-gateway.log

```text
--- phase: archive_park_sub_issues ---
prod-write-gateway-browser: mirror operations plus Submit and Calendar native intake passed
```

The existing Workload inventory initially reported eight small-search-field failures; all eight cases pass after the 44px field correction. Thirty of 31 focused Workload unit files passed initially; the remaining branded-tooltip source assertion passes after replacing a native title with data-tip. Responsiveness initially expected the old segmented view control; its Workload assertion now checks the approved local navigation while other surfaces retain their original assertions. Earlier evidence is retained privately, including fallback-font and overlap attempts; those are not acceptance captures. The new backdrop case first used a full mount which legitimately requested a board read; it now loads only the area and shell, leaving the unchanged zero-request assertion intact.

### workload-publish-screens.log

```text
ok Workload 430 dark: agenda, queue, exact native item, filters, planning, empty/loading/error
STAFF_PHONE_WORKLOAD: 48 screen/theme/width captures; all assertions passed; fictional transports; no live writes
```

### workload-rules.log

```text
ok workload-dark-430 screen, menus, layout and scroll lock
STAFF_PHONE_RULES: 12 states; 0 failures; 390/430 touch; synthetic transports; no live writes
```

### workload-desktop-public.log

```text

1/1 desktop shots identical to origin/main
```

### workload-modules.log

```text

check-modules: all checks passed
```

### workload-repo-map.log

```text

repo-map-sync: 1189 passed, 0 failed
```

### workload-truth.log

```text

truth-sync: 522 passed, 0 failed
```

## Header viewport correction

Switching planning views could let a native focus scroll move the document header offscreen. Phone height now uses the document position, and page scrolling is normalized while the inner work region owns scrolling. The complete 48-state run passes with a new explicit zero-document-scroll assertion.

```text
ok Workload 430 dark: agenda, queue, exact native item, filters, planning, empty/loading/error
STAFF_PHONE_WORKLOAD: 48 screen/theme/width captures; all assertions passed; fictional transports; no live writes
```

The Filters backdrop now uses the same existing overlay token as the other native phone sheets. Its final 390px light/dark replay also asserts that the backdrop is painted.

```text
ok Workload 390 dark: agenda, queue, exact native item, filters, planning, empty/loading/error
STAFF_PHONE_WORKLOAD: 24 screen/theme/width captures; all assertions passed; fictional transports; no live writes
```
