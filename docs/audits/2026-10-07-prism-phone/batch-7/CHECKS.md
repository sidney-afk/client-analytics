# Actual final check lines

All lines below are copied from completed passing local checks. [Every preserved historical log tail](check-receipts.json) includes rejected and interrupted work, which carries no acceptance. [Package checks](package-checks.json) include the committed-index equality check. Hosted CI and Lighthouse review remain separate gates.

Full and fresh native action lanes use intercepted fictional data. Targeted empty-thumbnail replays belong to their respective rounds; original incorrectly filled captures were rejected.

## Full native round

### staff-393-light

Exit: 0.

```text
ok calendar-transcript-filled 393 light
ok calendar-transcript-discard 393 light
ok calendar-caption-prompt-normal 393 light
ok calendar-caption-prompt-empty 393 light
staff-phone-final-pass: 96 renders, 0 problems
```

### staff-393-dark

Exit: 0.

```text
ok calendar-transcript-filled 393 dark
ok calendar-transcript-discard 393 dark
ok calendar-caption-prompt-normal 393 dark
ok calendar-caption-prompt-empty 393 dark
staff-phone-final-pass: 96 renders, 0 problems
```

### staff-412-light

Exit: 0.

```text
ok calendar-transcript-filled 412 light
ok calendar-transcript-discard 412 light
ok calendar-caption-prompt-normal 412 light
ok calendar-caption-prompt-empty 412 light
staff-phone-final-pass: 96 renders, 0 problems
```

### staff-412-dark

Exit: 0.

```text
ok calendar-transcript-filled 412 dark
ok calendar-transcript-discard 412 dark
ok calendar-caption-prompt-normal 412 dark
ok calendar-caption-prompt-empty 412 dark
staff-phone-final-pass: 96 renders, 0 problems
```

### staff-calendar

Exit: 0.

```text
staff-calendar-expanded: OK (6316 checks; Review/Sheet/Month/Week, light/dark, menus/dialogs, loading/empty/error/saving, desktop restore; 393/412).
```

### rules

Exit: 0.

```text
ok workload-light-393 screen, menus, layout and scroll lock
ok workload-dark-393 screen, menus, layout and scroll lock
ok workload-light-412 screen, menus, layout and scroll lock
ok workload-dark-412 screen, menus, layout and scroll lock
STAFF_PHONE_RULES: 88 states; 0 failures; 393/412 touch; synthetic transports; no live writes
```

### design

Exit: 0.

```text
ok sample-reviews-412-light-missing-media
ok sample-reviews-412-light-linked
ok sample-reviews-412-dark-missing-media
ok sample-reviews-412-dark-linked
STAFF_PHONE_DESIGN: 16 native card states; 0 failures; fictional intercepted transports
```

### admin

Exit: 0.

```text
KASPER_ADMIN_CHART: pinned production 4.4.0 bytes; 4 phone chart action/theme/desktop-restore states checked.
KASPER_ADMIN_EXPANDED: 100 native states; 4348 checks; 0 failures; fictional data; no live writes.
```

### client-calendar

Exit: 0.

```text
client-calendar-expanded: OK (1768 assertions; Review, Sheet, Month, Week, menus, drafts, loading, failure, empty, breakpoint; 393/412; requested light, effective client light).
```

### client-links

Exit: 0.

```text
client-links-expanded: OK (1122 assertions; Samples Review/queue/Sheet, Analytics, menus, Notes, lightbox, draft, sending, failure, loading, empty, desktop restore; 393/412; requested light, effective client light).
```

### staff-393-light

Exit: 0.

```text
ok calendar-thumbnail-prompt-empty 393 light
staff-phone-final-pass: 1 renders, 0 problems
```

### staff-393-dark

Exit: 0.

```text
ok calendar-thumbnail-prompt-empty 393 dark
staff-phone-final-pass: 1 renders, 0 problems
```

### staff-412-light

Exit: 0.

```text
ok calendar-thumbnail-prompt-empty 412 light
staff-phone-final-pass: 1 renders, 0 problems
```

### staff-412-dark

Exit: 0.

```text
ok calendar-thumbnail-prompt-empty 412 dark
staff-phone-final-pass: 1 renders, 0 problems
```


## Fresh-eyes native round

### staff-393-light

Exit: 0.

```text
ok calendar-transcript-filled 393 light
ok calendar-transcript-discard 393 light
ok calendar-caption-prompt-normal 393 light
ok calendar-caption-prompt-empty 393 light
staff-phone-final-pass: 96 renders, 0 problems
```

### staff-393-dark

Exit: 0.

```text
ok calendar-transcript-filled 393 dark
ok calendar-transcript-discard 393 dark
ok calendar-caption-prompt-normal 393 dark
ok calendar-caption-prompt-empty 393 dark
staff-phone-final-pass: 96 renders, 0 problems
```

### staff-412-light

Exit: 0.

```text
ok calendar-transcript-filled 412 light
ok calendar-transcript-discard 412 light
ok calendar-caption-prompt-normal 412 light
ok calendar-caption-prompt-empty 412 light
staff-phone-final-pass: 96 renders, 0 problems
```

### staff-412-dark

Exit: 0.

```text
ok calendar-transcript-filled 412 dark
ok calendar-transcript-discard 412 dark
ok calendar-caption-prompt-normal 412 dark
ok calendar-caption-prompt-empty 412 dark
staff-phone-final-pass: 96 renders, 0 problems
```

### staff-calendar

Exit: 0.

```text
staff-calendar-expanded: OK (6316 checks; Review/Sheet/Month/Week, light/dark, menus/dialogs, loading/empty/error/saving, desktop restore; 393/412).
```

### admin

Exit: 0.

```text
KASPER_ADMIN_CHART: pinned production 4.4.0 bytes; 4 phone chart action/theme/desktop-restore states checked.
KASPER_ADMIN_EXPANDED: 100 native states; 4348 checks; 0 failures; fictional data; no live writes.
```

### rules

Exit: 0.

```text
ok workload-light-393 screen, menus, layout and scroll lock
ok workload-dark-393 screen, menus, layout and scroll lock
ok workload-light-412 screen, menus, layout and scroll lock
ok workload-dark-412 screen, menus, layout and scroll lock
STAFF_PHONE_RULES: 88 states; 0 failures; 393/412 touch; synthetic transports; no live writes
```

### design

Exit: 0.

```text
ok sample-reviews-412-light-missing-media
ok sample-reviews-412-light-linked
ok sample-reviews-412-dark-missing-media
ok sample-reviews-412-dark-linked
STAFF_PHONE_DESIGN: 16 native card states; 0 failures; fictional intercepted transports
```

### client-calendar

Exit: 0.

```text
client-calendar-expanded: OK (1768 assertions; Review, Sheet, Month, Week, menus, drafts, loading, failure, empty, breakpoint; 393/412; requested light, effective client light).
```

### client-links

Exit: 0.

```text
client-links-expanded: OK (1122 assertions; Samples Review/queue/Sheet, Analytics, menus, Notes, lightbox, draft, sending, failure, loading, empty, desktop restore; 393/412; requested light, effective client light).
```

### staff-393-light

Exit: 0.

```text
ok calendar-thumbnail-prompt-empty 393 light
staff-phone-final-pass: 1 renders, 0 problems
```

### staff-393-dark

Exit: 0.

```text
ok calendar-thumbnail-prompt-empty 393 dark
staff-phone-final-pass: 1 renders, 0 problems
```

### staff-412-light

Exit: 0.

```text
ok calendar-thumbnail-prompt-empty 412 light
staff-phone-final-pass: 1 renders, 0 problems
```

### staff-412-dark

Exit: 0.

```text
ok calendar-thumbnail-prompt-empty 412 dark
staff-phone-final-pass: 1 renders, 0 problems
```


## Scope, Clients, Calendar and boot checks

### staff-phone-css-scope

Exit: 0.

```text
staff-phone-css-scope: OK (1 block(s), 370 braces, all under @media (max-width: <=767px) and body:has(.pocket-staff-bar))
```

### staff-phone-rules-source

Exit: 0.

```text
staff-phone-rules-source: artifact CSS/JS transplanted byte-identically; 63 rules phone-capped and staff-scoped
```

### staff-calendar-phone-css-scope

Exit: 0.

```text
staff-calendar-phone-css-scope: OK (1 block(s), 406 braces, all under @media (max-width: <=767px) and #calView[data-pocket-staff-phone])
```

### staff-samples-phone-css-scope

Exit: 0.

```text
staff-samples-phone-css-scope: OK (1 block(s), 352 braces, all under @media (max-width: <=767px) and #sxrView[data-pocket-staff-samples])
```

### staff-selection-phone-css-scope

Exit: 0.

```text
staff-selection-phone-css-scope: OK (1 block(s), 30 braces, all under @media (max-width: <=767px) and #calView[data-pocket-staff-phone])
```

### client-phone-css-scope

Exit: 0.

```text
client-phone-css-scope: OK (6 block(s), 464 braces, all under @media (max-width: <=767px) and html.boot-client)
```

### kasper-phone-css-scope

Exit: 0.

```text
kasper-phone-css-scope: OK (1 block(s), 24 braces, all under @media (max-width: <=767px) and the Kasper review scope)
```

### finch-phone-css-scope

Exit: 0.

```text
finch-phone-css-scope: OK (1 block(s), 446 braces, all under @media (max-width: <=767px) and html.fph-on)
```

### clients-actions-final

Exit: 0.

```text
ok   admin 390x844 dark
ok   admin 375x667 light
ok   admin 375x667 dark

clients-create-browser: OK (New client: preview, create, refusals, admin only, phones)
```

### staff-calendar-final

Exit: 0.

```text
staff-calendar-expanded: OK (9474 checks; Review/Sheet/Month/Week, light/dark, menus/dialogs, loading/empty/error/saving, desktop restore; 360/393/412).
```

### client-review-final

Exit: 0.

```text
ok   samples small Android 360x800 dark
ok   samples iPhone SE landscape 667x375 light
ok   samples iPhone SE landscape 667x375 dark

client-phone-review: OK (calendar + samples, 5 phone sizes each, light + dark, approve + request change)
```

### entry-boot-final

Exit: 0.

```text
PASS intake
PASS onboarding
PASS onboarding-ai
PASS smm-weekly
entry-links-boot-browser: all 4 links reached their screen
```

### check-modules-final

Exit: 0.

```text
window exports: 569 handler-called names in 38 modules
typeof guards in modules: 526; unresolvable: 0
minified parts: 19 files, 2709 KB, 5303 top-level names, 0 lost, 0 changed kind

check-modules: all checks passed
```

### repo-map-sync

Exit: 0.

```text
OK  REPO_MAP.md path `docs/syncview-design/tests/calendar-refresh-scroll-browser.js` exists
OK  REPO_MAP.md path `docs/syncview-design/proofs/staff-calendar-expanded/README.md` exists
OK  REPO_MAP.md path `docs/syncview-design/tests/phone-thumbnail-comparison.js` exists

repo-map-sync: 1148 passed, 0 failed
```

### truth-sync

Exit: 0.

```text
OK  migrations/title-review-migration.sql contains no current manual-rollout instruction
OK  migrations/sales-intake-migration.sql is labelled as deployed historical schema
OK  migrations/sales-intake-migration.sql contains no current manual-rollout instruction

truth-sync: 519 passed, 0 failed
```

### byte-pins

Exit: 0.

```text
  test/linear-exit-provider-issue-observation.js: 0 CRLF, 30 LF, 0 lone CR, 13845 bytes
  test/linear-exit-provider-recorded-create-recovery.js: 1 CRLF, 18 LF, 0 lone CR, 16294 bytes
  test/linear-exit-provider-terminal-history.js: 0 CRLF, 44 LF, 0 lone CR, 14021 bytes
  test/linear-exit-retirement-switch-postgres.js: 62 CRLF, 6 LF, 0 lone CR, 19647 bytes
  test/linear-exit-source-phases-postgres.js: 1 CRLF, 28 LF, 0 lone CR, 7595 bytes
```

### identity-final

Exit: 0.

```text
  files carrying at least one      0   (any is a failure)

  WHERE (counts only — this tool never prints what it matched):

This change adds no client slug and no colleague's name ✅
```


## Final package checks

### build-index

Exit: 0.

```text
build-index: js/sv-04-workload-cac24a0637b7.js (190549 bytes)
build-index: js/sv-14-tiktok-48de5e91de41.js (130503 bytes)
build-index: js/sv-16-kasper-fd558b17e192.js (337306 bytes)
build-index: wrote index.html (1350018 bytes) from 67 fragment(s)
build-index: wrote src/index/INDEX.md
```

### repo-map-sync

Exit: 0.

```text
OK  REPO_MAP.md path `docs/syncview-design/tests/calendar-refresh-scroll-browser.js` exists
OK  REPO_MAP.md path `docs/syncview-design/proofs/staff-calendar-expanded/README.md` exists
OK  REPO_MAP.md path `docs/syncview-design/tests/phone-thumbnail-comparison.js` exists

repo-map-sync: 1148 passed, 0 failed
```

### truth-sync

Exit: 0.

```text
OK  migrations/title-review-migration.sql contains no current manual-rollout instruction
OK  migrations/sales-intake-migration.sql is labelled as deployed historical schema
OK  migrations/sales-intake-migration.sql contains no current manual-rollout instruction

truth-sync: 519 passed, 0 failed
```

### byte-pins

Exit: 0.

```text
  test/linear-exit-provider-issue-observation.js: 0 CRLF, 30 LF, 0 lone CR, 13845 bytes
  test/linear-exit-provider-recorded-create-recovery.js: 1 CRLF, 18 LF, 0 lone CR, 16294 bytes
  test/linear-exit-provider-terminal-history.js: 0 CRLF, 44 LF, 0 lone CR, 14021 bytes
  test/linear-exit-retirement-switch-postgres.js: 62 CRLF, 6 LF, 0 lone CR, 19647 bytes
  test/linear-exit-source-phases-postgres.js: 1 CRLF, 28 LF, 0 lone CR, 7595 bytes
```

### identity-final

Exit: 0.

```text
  files carrying at least one      0   (any is a failure)

  WHERE (counts only — this tool never prints what it matched):

This change adds no client slug and no colleague's name ✅
```

### check-index

Exit: 0.

```text
check-index: assembled bytes — sha256=ed02056afe2079c2c436140e4a86f5e53e8b7e3bd1396bef580f985d9b2ce09b bytes=1350018
check-index: working-tree index.html — sha256=ed02056afe2079c2c436140e4a86f5e53e8b7e3bd1396bef580f985d9b2ce09b bytes=1350018
check-index: committed index.html (HEAD) — sha256=ed02056afe2079c2c436140e4a86f5e53e8b7e3bd1396bef580f985d9b2ce09b bytes=1350018

check-index: OK — assembled == working tree == committed (HEAD)
```

### client-calendar-360

Exit: 0.

```text
client-calendar-expanded: OK (884 assertions; Review, Sheet, Month, Week, menus, drafts, loading, failure, empty, breakpoint; 360; requested light, effective client light).
```


## Desktop identity and artifact integrity

```text
FIXTURE_DESKTOP_PARITY: 134/134 exact 1440 desktop pairs; native Today/Notes/Analytics/Workload/TikTok/Card detail fixtures; cold and phone-to-desktop; no live writes.
```

The additional admin matrix contains 48 exact PNG/style pairs; [desktop.json](desktop.json) binds all 182 accepted pairs. [integrity.json](integrity.json) binds source, native PNG hashes, coverage and the single append-only ledger entry.
