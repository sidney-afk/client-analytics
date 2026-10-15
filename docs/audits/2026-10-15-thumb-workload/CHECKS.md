# Workload check receipts

## Follow-up review regressions

Two further findings reproduced: after using the Agenda tab between creatives, stale queue metadata reopened the previous creative on Back; and a failed refresh replaced a zero-work filtered creative with a fatal error despite cached board data. Parent entries now clear queue metadata, and the phone uses the native whole-board data check for fatal errors. The fixture uses a valid editor/client pair with no matching work and retained cached buckets. Replaying the old error guard against that same valid fixture failed; the fixed full matrix passes:

```text
STAFF_PHONE_WORKLOAD: 52 screen/theme/width captures; all assertions passed; fictional transports; no live writes
```

All 26 required 390px images were recaptured and reviewed, including the retained zero-work creative after a failed refresh. The new state is in the gallery; existing failed attempts remain private. No assertion, threshold or CI condition was relaxed.

## Review navigation regressions

Both review findings reproduced locally. Browser Forward failed to reopen the creative queue; after that repair the Month-to-Plan + Due Date journey exposed the stale Month header/current-tab marker. Queue history now stores the creative ID (including the unassigned empty ID), Forward restores that complete queue, and the phone mode follows the native forced Week guard. The regression no longer taps Week to mask that transition: it asserts the immediate native grid, header and current-tab state. The complete 390/430 light/dark replay ends:

```text
STAFF_PHONE_WORKLOAD: 48 screen/theme/width captures; all assertions passed; fictional transports; no live writes
```

Existing screenshots remain representative: the earlier capture explicitly selected Week, and the repaired transition now arrives at that same Week screen automatically. No pictured geometry or desktop path changed.

## Browser guards and Production layout follow-up

The complete dialog suite reproduced the hosted failure locally: a previous Calendar fixture remained mounted, and resizing for the new Workload case started an unrelated folder request. The new case now clears the previous fictional Calendar/Samples clients before resizing. Every dialog, inside-to-outside drag, outside dismissal and the strict zero-request assertion remains enabled and unchanged. The complete fixed replay ends:

```text
  Phone Workload filters
  Staff sign-in
  Staff sign-in (start-up gate)
dialog-backdrop-press-browser ok
```

The separately reported `plp_console_errors` failure has not reproduced in three consecutive local runs of the unchanged Production layout suite. Each exits zero with this actual final line; no Production code, console assertion, allowlist or CI condition was changed:

```text
prod-layout-polish: desktop, compact desktop, and mobile list/filter/project/card/menu clipping checks plus 0 recovered read retries and 0 navigation-aborted reads passed
```

The full unchanged fast lane also completed locally:

```text
prod-polish-gate (fast): all 19 selected suite(s) passed in 324.1s
```

These local passes do not establish the cause of the earlier hosted console error or make that failed run green. The branches subsequently conflicted with new main commits. Main `71f684554e95f6a9b5ddc2167685fcc2979477c4` is now integrated, preserving the new viewer, notifications and every CI check. The complete dialog suite, required gateway and Production layout pass again on that integration. The refreshed full desktop comparison ends `1/1 desktop shots identical to origin/main`; its public pair is unchanged byte for byte.

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
