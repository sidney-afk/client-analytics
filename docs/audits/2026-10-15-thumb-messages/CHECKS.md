# Messages check receipts

## Final current-main replay

Refreshed against main `71f684554e95f6a9b5ddc2167685fcc2979477c4`, after #2083 had merged and after the two earlier phone PRs were open. Final phone screenshots were recaptured and all 24 required 390px states reviewed together, with full-size thread, keyboard and Tabs inspection. Nothing looks clipped, crowded or misplaced. The populated desktop comparison retains all failed rasterization attempts privately and records exact accepted pairs (1, 2, 3 and 1 attempts); no pixel tolerance or check exception was added. `provenance.json` pins this source and the published image hashes.

Actual final lines of the current-main runs:

```text
STAFF_PHONE_MESSAGES: 48 screen/theme/width captures; all assertions passed; fictional intercepted transports; no live writes
MESSAGES_DESKTOP_PARITY: 4/4 populated desktop pairs exact; native inbox and thread; fictional intercepted transports
messages-inbox-browser: all checks passed
messages-inbox-scope: all checks passed
popup-behaviour-browser: all 369 checks passed
dialog-backdrop-press-browser ok
STAFF_PHONE_TABS_GRID: 24 twice-opened states; 0 failures; native icons/order/current tab; fictional transports only
prod-write-gateway-browser: mirror operations plus Submit and Calendar native intake passed
check-modules: all checks passed
repo-map-sync: 1196 passed, 0 failed
truth-sync: 524 passed, 0 failed
dark-contrast: OK, 952 checks (named pairs + every token-coloured rule in the static stylesheet), all at AA or better in dark mode
```

Actual tails. Fully intercepted fictional fixtures, no live write.

## messages-reviewed-screens.log

```text
ok Messages 430 dark: list, thread, unread boundary, draft, Back, composer, sheets, refusal, empty/loading/error
STAFF_PHONE_MESSAGES: 48 screen/theme/width captures; all assertions passed; fictional intercepted transports; no live writes
```

## messages-scope-final.log

```text

messages-inbox-scope: all checks passed
```

## messages-tabs.log

```text
STAFF_PHONE_TABS_GRID: 24 twice-opened states; 0 failures; native icons/order/current tab; fictional transports only
```

## messages-backdrop.log

```text
  Staff sign-in (start-up gate)
dialog-backdrop-press-browser ok
```

## messages-popups.log

```text

popup-behaviour-browser: all 369 checks passed
```

## messages-desktop.log

```text

1/1 desktop shots identical to origin/main
```

## messages-desktop-exact-replay.log

```text
ok Messages desktop thread dark: full pixels, computed styles and bounds identical; attempts 1
MESSAGES_DESKTOP_PARITY: 4/4 populated desktop pairs exact; native inbox and thread; fictional intercepted transports
```

## messages-write-gateway.log

```text
--- phase: archive_park_sub_issues ---
prod-write-gateway-browser: mirror operations plus Submit and Calendar native intake passed
```

## messages-modules-final.log

```text

check-modules: all checks passed
```

## messages-source.log

```text
staff-phone-rules-source: artifact CSS/JS transplanted byte-identically; 129 rules phone-capped and staff-scoped
```

## messages-contrast.log

```text
dark-contrast: OK, 933 checks (named pairs + every token-coloured rule in the static stylesheet), all at AA or better in dark mode
```

Earlier attempts are retained privately: Back initially allowed the page router to remount the inbox and lose focus; its own history entries are now consumed before normal routing. The refused-send case follows the native 20-second missing-card wait, rather than timing out after eight seconds. Screenshot review caught an avatar fallback overriding the hidden thread thumbnail and squeezing the title; the fallback is list-only and title width is asserted. The transient refused-send toast is allowed to dismiss before independent empty/loading/error screenshots. Two first desktop captures had tiny rounded-edge rasterization differences; the existing exact replay requires exact pixels/styles/bounds on every accepted pair and records all attempt counts. Windows dynamic imports were corrected to file URLs without changing assertions.
