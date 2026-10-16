# Thumb: Workload phone build

Implements the Workload direction approved in [mockup #2082](https://github.com/sidney-afk/client-analytics/pull/2082), independently from current main. [390px light/dark gallery](gallery.html).

The phone opens an agenda with a seven-day strip, scope and attention counts. Creative rows lead into complete active queues, with overdue items first and work days distinct from deadlines. Back and browser Back restore agenda scroll/focus. An item opens the exact native planning/feedback editor in a bottom sheet. The single next action is the selected item; there is no ambiguous global plan button.

Agenda, Week and Month are always in the local bottom bar. Week/Month keep the native planners, availability/capacity, manual/automatic placements, workload weights, exceptions, drag rules and authority checks. The calendar comes before the team matrix on a phone. All native filters move together into a bottom sheet; its controls keep their original listeners. Plan + Due Date keeps the existing Week-only guard. Headers and navigation stay in place around independently scrolling content.

Every style is staff-phone scoped and capped at 767px. Desktop mount/render semantics are preserved; crossing to desktop restores native parents and removes the phone nodes. There are no endpoint, writer, authority, authentication, notification or database changes. Fictional intercepted fixtures only; no live write or message. [Exact desktop pair](screenshots/desktop/workload-1440-pair.json) and [check receipts](CHECKS.md).

## Changed journeys

- `qa/finch-phone/scenarios.js`: legacy planning cases choose Week/Month or Filters through the new visible navigation; their native item and planning assertions remain.
- `qa/staff-phone-responsiveness.js`: useful paint follows actual agenda rows; Workload checks its three local destinations and 44px targets instead of treating the bottom bar as a reviewer-style segmented control. The overloaded native day badge journey enters Week and retains its strict assertions.
- `popup-behaviour-areas-browser.js`: the shared five-rule suite includes the new Filters sheet at 390px, with kept search text and background refresh.
- `dialog-backdrop-press-browser.js`: the new phone sheet is in the source-driven inventory and real drag/outside-click journey. It clears prior Calendar/Samples fixture clients before resizing, then loads the Workload area without requesting board data. The strict zero-request ledger is unchanged.
- New `qa/staff-phone-workload.js`: agenda, every creative item, native item identity, Back/browser Back, filters, nested Escape, kept search, local navigation, Month guard and empty/loading/error. CI runs it at both widths. No skip or gate exception was added.

The screenshot fixtures include a native metadata warning; it remains explicit rather than implying those items have verified weights or deadlines. All 30 required 390px images (28 primary-flow and two Open in Calendar integration images) were reviewed, including the corrected menu spacing, viewport clipping and planner ordering. Native viewport screenshots are fixture proof, not deployed or physical-device proof.

Keep this PR unmerged. Revert the implementation PR and rebuild generated assets for recovery; no migration or data rollback is required. Messages is now inherited from main (#2090).

Phone breakpoint cleanup removes its delegated click handler before restoring desktop. The regression suite crosses phone → desktop → phone twice, verifies no phone nodes remain on desktop, then requires exactly one history entry from one queue tap and a working Back journey. This reproduced as three entries before the fix.

## Current-main integration, 2026-10-16

Main `ef8da61ae4bc76bd481e40b13b9d7b37ca61f144` is merged with merge commits, without rebasing. Both existing PRs remain unmerged. `index.html`, `js/sv-*.js` and `src/index/INDEX.md` are no longer tracked: they are ignored local build output, built from source at publish under #2101. CI test registrations and all main checks are retained. No skip or exception was added.

The merge keeps Cinema's final shared Notes/video view, including no autoplay; Glyph's distinct video and thumbnail icons; Postbox's Post tab artwork, label and native behavior; and Signpost's labelled Open in Calendar action. The phone menu uses the native Post link. Existing Messages navigation, return handling and its dialog coverage remain alongside this area's phone journeys. No `OPEN_REPAIRS` entry was added or number reused.

Fresh phone screenshots were reviewed against direction A (Expanded) in [#1950](https://github.com/sidney-afk/client-analytics/pull/1950), reference commit `e2ab30ab3f34a2afb2a2c781ebe9855acf38b625`: title/Tabs/More hierarchy, readable fields, retained component decisions, full-width native editors and scrollable sheets. Navigation still follows approved #2082's grid and agenda contract. Both 390px themes and 430px captures were reviewed; the fresh desktop pair is pixel/style identical to this main baseline. This is fictional fixture evidence, with all browser transports intercepted. No live writer or message was used.

The new Tabs captures assert the native Post label and icon. The Workload suite keeps the breakpoint, history, cached-empty, native planning and filter assertions; all 56 phone state captures pass. Tests, earlier failed or superseded attempts and exact final tails are recorded in [CHECKS.md](CHECKS.md); screenshot hashes and source pins are in [provenance.json](provenance.json).
