# Thumb: Messages phone build

Implements the Messages direction approved in [mockup #2082](https://github.com/sidney-afk/client-analytics/pull/2082). This work began last, from freshly fetched main after [#2083](https://github.com/sidney-afk/client-analytics/pull/2083) merged. Calendar/Samples and Workload remain separate PRs. [390px light/dark gallery](gallery.html).

Final source and evidence are refreshed onto main `71f684554e95f6a9b5ddc2167685fcc2979477c4`; the new card viewer and notification-link changes are retained.

The phone starts with a searchable conversation list and clear unread counts. A conversation opens at full width with a back arrow. The composer stays at the bottom while messages scroll; Return inserts a newline on a phone, and Send is the primary action. Component and audience remain visible above the field. Mark as unread and Open card keep their native handlers in the conversation actions sheet. Messages in Tabs now has its native icon, a visible label and the supplemental count.

Back and browser Back preserve list position, focus, filters and per-conversation drafts. Background refresh preserves a focused composer and the reading position of older messages. The new-message divider uses the native unread count over the latest messages from others, matching the existing unread contract. Drafts stay in memory for navigation, clear on successful send and identity changes, and do not introduce a new storage or write lane.

Every new style is staff-phone scoped and capped at 767px. The original desktop templates are retained; phone elements decorate them only at phone width. Server inbox scope, access, read/mark/reply payloads, the Notes writer, component/audience inheritance, polling and backend fallback remain native. No database, endpoint, auth or notification changes. All evidence uses intercepted fictional data; no live mutation or message was sent.

## Evidence

The phone suite covers 12 states at 390 and 430 in both themes: inbox, search, unread, thread, composer, simulated keyboard, conversation actions, Tabs, refused send, empty, loading and error. All 24 required 390px images were reviewed. The 390x420 keyboard captures are browser viewport simulations; physical-keyboard and deployed behavior are not claimed.

[Populated desktop parity](screenshots/desktop-populated/parity.json) compares the native inbox and an open thread, in both themes at 1440px: exact full-frame pixels, every computed style and exact bounds. Public images omit the unchanged staff identity header. The helper reuses the repository's existing bounded exact replay, with zero pixel tolerance and recorded attempt counts. Earlier rasterization mismatches are retained privately, not described as all-attempt clean. [Check receipts](CHECKS.md).

## Intentional test updates

- `messages-inbox-browser.js`: the existing phone mark-unread journey opens the new visible More sheet; desktop retains its direct button. Browser and scope tests use file URLs for dynamic imports, so the same fixtures also run on Windows. All reply, scope, read-mark, ownership and fallback assertions remain.
- `qa/staff-phone-tabs-grid.js`: every common-grid journey asserts the visible Messages label alongside its unchanged native icon and badge.
- `popup-behaviour-browser.js`: the conversation actions sheet joins the five shared popup rules. `dialog-backdrop-press-browser.js` includes its real inside-to-outside drag and ordinary backdrop click in the source-driven inventory.
- New `qa/staff-phone-messages.js`: native read marks, unread boundary, search/filter, draft retention, Back/focus, composer/keyboard fit, title width, Return, sheets and refused-send retry. CI runs both widths.
- New `qa/messages-desktop-parity.js`: populated desktop fixture comparisons. The existing desktop helper also includes the Messages header destination and can publish a safe crop for any staff page.

No CI check was skipped, exempted or disabled. Keep the PR unmerged. Recovery is a revert and generated-asset rebuild; there is no migration or data rollback.
