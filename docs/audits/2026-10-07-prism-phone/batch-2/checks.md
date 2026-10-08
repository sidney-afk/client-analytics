# Actual check tails

Source hash: `7e94758fe7a6ba0f0b8dfe33ce152606f443c8b6461fc2855e0538cfa7273a96`.

These are local fixture/source checks. Hosted CI, deployment, live saves and physical-device behavior are separate evidence. All final browser checks use headless installed Chrome, with no foreground calls.

## Complete final admin matrix

```text
KASPER_ADMIN_CHART: pinned production 4.4.0 bytes; 6 phone chart action/theme/desktop-restore states checked.
KASPER_ADMIN_EXPANDED: 420 native states; 8892 checks; 0 failures; fictional data; no live writes.
```

## Staff phone rules

```text
ok time-off-light-430 screen, menus, layout and scroll lock
ok time-off-dark-430 screen, menus, layout and scroll lock
STAFF_PHONE_RULES: 240 states; 0 failures; 375/390/430 touch; synthetic transports; no live writes
```

## Staff card design

```text
ok sample-reviews-430-dark-missing-media
ok sample-reviews-430-dark-linked
STAFF_PHONE_DESIGN: 24 native card states; 0 failures; fictional intercepted transports
```

## Client approve and request change, both preferences

```text
ok   samples iPhone SE landscape 667x375 light
ok   samples iPhone SE landscape 667x375 dark

client-phone-review: OK (calendar + samples, 5 phone sizes each, light + dark, approve + request change)
```

## Range fixture replay

```text
KASPER_ADMIN_CHART: pinned production 4.4.0 bytes; 0 phone chart action/theme/desktop-restore states checked.
KASPER_ADMIN_EXPANDED: 6 native states; 168 checks; 0 failures; fictional data; no live writes.
```

## Supported-runtime module guard

```text
window exports: 555 handler-called names in 38 modules
typeof guards in modules: 517; unresolvable: 0
minified parts: 19 files, 2656 KB, 5215 top-level names, 0 lost, 0 changed kind

check-modules: all checks passed
```

## Repository map

```text

repo-map-sync: 1118 passed, 0 failed
```

## Truth register

```text

truth-sync: 515 passed, 0 failed
```

## Filled Ads desktop comparison

The filled Ads fixtures use actual Chart.js, intended fonts, all four desktop widths and both themes. Both PNG bytes and computed styles match in every final pair.

```text
FILLED_ADS_DESKTOP: 8/8 exact PNG and computed-style pairs
```

## Broad desktop comparison

The final frozen-source invocation passed all 72 exact PNG/computed-style pairs.
Its original gate and exact-match threshold are unchanged. The eight filled Ads
comparisons also match. Safe hashes and the retained superseded failures are in
`desktop.json`; raw live TEST images remain private.

```text
ok   client-sample-reviews @1920: pixels identical, computed styles identical (8efa8351f7c9)

72/72 desktop shots identical to 1770cc7104ac4fc7de5eeef7decc75e8c287550a
```

## Committed index

```text
check-index: working-tree index.html — sha256=ebd981a6347f9783d3086c4a4bd083b3c9d2818dbbe6e95556679de083505ddd bytes=1313427
check-index: committed index.html (HEAD) — sha256=ebd981a6347f9783d3086c4a4bd083b3c9d2818dbbe6e95556679de083505ddd bytes=1313427

check-index: OK — assembled == working tree == committed (HEAD)
```

## Phone CSS and source ownership

All eight existing CSS ownership suites and the staff artifact transplant guard
passed. The last lines were:

```text
staff-calendar-phone-css-scope: OK (1 block(s), 396 braces, all under @media (max-width: <=767px) and #calView[data-pocket-staff-phone])
staff-phone-rules-source: artifact CSS/JS transplanted byte-identically; 61 rules phone-capped and staff-scoped
```

The expanded admin guard also reports:

```text
KASPER_ADMIN_SCOPE: 283 rules; all capped at 767px and owned marker; widened/unscoped rules rejected.
```

## Identity exposure after staging all assets

```text
  roster terms checked             53   (client slugs + staff full names)
  terms this change adds           0   (0 client slugs, 0 staff names)
  files carrying at least one      0   (any is a failure)

  WHERE (counts only — this tool never prints what it matched):

This change adds no client slug and no colleague's name ✅
```

## Retained failures and superseded invocations

- The original layout probes failed on utility loaders over 5,000 pixels, cramped labels and faint captions. These reproduce the repairs; they are not passing gates.
- The first chart smoke raised a guard error when an optional desktop font field was absent. The guard now uses Chart.js defaults and always restores the viewport in `finally`; its corrected smoke passed.
- Browser launch attempts failed to locate an adapter/dependency; one adapter invocation loaded the runner without calling its entrypoint. None executed a valid gate. The current headless preload runs the real entrypoint and checks.
- An attempted CSS command named a nonexistent test; the actual scope suites subsequently passed. A later passing shell command does not turn the earlier attempt into a pass.
- A later scope invocation ran all suites successfully but its PowerShell redirection failed. The corrected script-block invocation also passed and saved the complete scope log.
- The initial module guard lacked its parser dependencies; a temporary dependency install also warned that Node 22.12 was below one parser package engine range. The final guard uses checksum-verified Node 22.13 and temporary dependencies, with no repository or global runtime installation.
- The initial desktop process was stopped when product source changed. Its partial output is not a pass.
- The superseded broad desktop invocation finished 71/72: staff Analytics at 1024 had different PNGs and identical styles. It predates the final date/copy changes and is retained separately.
- The first filled Ads comparison matched eight PNGs but only six style hashes. A 1280 replay reproduced a 12-pixel header-pill width timing difference; 1920 replay matched. Waiting two animation frames after idempotent public-label substitution produces eight exact style/PNG pairs. No comparison tolerance was added.
- The before-capture range probe initially asserted the new phone legend against the old source. That assertion is now correctly limited to after-source phone acceptance; the corrected parent range probe passed six states/30 checks.
- Full-page mobile captures of short pages clipped their headers despite intact viewport images. The corrected method retains the viewport for short pages and has an explicit PNG-dimension guard.
- A focused range replay reused its directory and overwrote the earlier full measurement JSON. The original full check log is retained; the final complete 420-state run writes to a separate `admin-verified` directory. Its 156 Ads/Quiz PNGs exactly match the reviewed after-gallery images.

CLEAN cells are recorded by exact image hash in `reviews.json`. The remaining coverage and a separate complete fresh-review round are OPEN.
