# Thumb: Workload phone build

Implements the Workload direction approved in [mockup #2082](https://github.com/sidney-afk/client-analytics/pull/2082), independently from current main. [390px light/dark gallery](gallery.html).

The phone opens an agenda with a seven-day strip, scope and attention counts. Creative rows lead into complete active queues, with overdue items first and work days distinct from deadlines. Back and browser Back restore agenda scroll/focus. An item opens the exact native planning/feedback editor in a bottom sheet. The single next action is the selected item; there is no ambiguous global plan button.

Agenda, Week and Month are always in the local bottom bar. Week/Month keep the native planners, availability/capacity, manual/automatic placements, workload weights, exceptions, drag rules and authority checks. The calendar comes before the team matrix on a phone. All native filters move together into a bottom sheet; its controls keep their original listeners. Plan + Due Date keeps the existing Week-only guard. Headers and navigation stay in place around independently scrolling content.

Every style is staff-phone scoped and capped at 767px. Desktop mount/render semantics are preserved; crossing to desktop restores native parents and removes the phone nodes. There are no endpoint, writer, authority, authentication, notification or database changes. Fictional intercepted fixtures only; no live write or message. [Exact desktop pair](screenshots/desktop/workload-1440-pair.json) and [check receipts](CHECKS.md).

## Changed journeys

- `qa/finch-phone/scenarios.js`: legacy planning cases choose Week/Month or Filters through the new visible navigation; their native item and planning assertions remain.
- `qa/staff-phone-responsiveness.js`: useful paint follows actual agenda rows; Workload checks its three local destinations and 44px targets instead of treating the bottom bar as a reviewer-style segmented control. The overloaded native day badge journey enters Week and retains its strict assertions.
- `popup-behaviour-areas-browser.js`: the shared five-rule suite includes the new Filters sheet at 390px, with kept search text and background refresh.
- `dialog-backdrop-press-browser.js`: the new phone sheet is in the source-driven inventory and real drag/outside-click journey. It loads the Workload area without requesting board data.
- New `qa/staff-phone-workload.js`: agenda, every creative item, native item identity, Back/browser Back, filters, nested Escape, kept search, local navigation, Month guard and empty/loading/error. CI runs it at both widths. No skip or gate exception was added.

The screenshot fixtures include a native metadata warning; it remains explicit rather than implying those items have verified weights or deadlines. All 24 required 390px images were reviewed, including the corrected menu spacing, viewport clipping and planner ordering. Native viewport screenshots are fixture proof, not deployed or physical-device proof.

Keep this PR unmerged. Revert the implementation PR and rebuild generated assets for recovery; no migration or data rollback is required. Messages starts last from fresh main after #2083.
