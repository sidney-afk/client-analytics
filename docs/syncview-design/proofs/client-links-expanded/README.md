# Expanded client Samples and Analytics

This batch builds the actual client Samples Review with an open sample, its queue
and Sheet, plus client Analytics. It starts from main independently of the
Calendar branch. Staff, reviewer and admin layouts stay on their existing paths.

Samples keeps full Video and Thumbnail sections in comfortable separate cards.
Its existing Approve, Comment, Request change, media, Notes and read-only Sheet
fields keep their handlers and permissions. Card size moves into More. The
native Sheet/Review controls remain near the content; Tabs identifies the current
Samples surface without inventing cross-link routes.

Analytics keeps its native numbers, formatting, charts, saved copies, retry and
About information. Existing client tabs move into Tabs; About moves into More.
The gains summary uses aligned rows, and empty states keep their native meaning.
More closes before the native About overlay opens. When no additional action is
available, it explains that instead of opening an empty sheet. Saving decisions
keep an explicit label, and loading placeholders follow the phone card widths.

Every new style is under a phone media query capped at 767px and scoped to
html.boot-client. Client links stay light. Crossing to desktop restores the
original controls, their contents and their original positions.

## Before and after

Open [the screenshot viewer](gallery.html) locally to choose a width and screen,
scroll the phones and inspect menus, dialogs and recovery states. These are
screenshots of the generated product with fictional data and media, not a
separate prototype. No real client image, identity or credential is included.

| Screen | 360 before / after | 390 before / after | 430 before / after |
| --- | --- | --- | --- |
| Samples Review · post open | [Before](before/samples-review-360.png) / [After](after/samples-review-360.png) | [Before](before/samples-review-390.png) / [After](after/samples-review-390.png) | [Before](before/samples-review-430.png) / [After](after/samples-review-430.png) |
| Samples queue | [Before](before/samples-queue-360.png) / [After](after/samples-queue-360.png) | [Before](before/samples-queue-390.png) / [After](after/samples-queue-390.png) | [Before](before/samples-queue-430.png) / [After](after/samples-queue-430.png) |
| Samples Sheet | [Before](before/samples-sheet-360.png) / [After](after/samples-sheet-360.png) | [Before](before/samples-sheet-390.png) / [After](after/samples-sheet-390.png) | [Before](before/samples-sheet-430.png) / [After](after/samples-sheet-430.png) |
| Analytics | [Before](before/analytics-360.png) / [After](after/analytics-360.png) | [Before](before/analytics-390.png) / [After](after/analytics-390.png) | [Before](before/analytics-430.png) / [After](after/analytics-430.png) |

There are 72 after screenshots at all three widths. They include the list,
queue, Sheet, full review, Tabs, More, Notes, lightbox, sending (including a pending approval), failed save,
loading, failed reads, invalid links, verification retry, Analytics About and
first-use empty. The acceptance receipt is [after/measurements.json](after/measurements.json).
A populated Analytics session intentionally retains its saved copy on refresh;
the empty proof uses a separate first-use session.

## Visible browser and real saves

All local browser work used visible Chrome. The candidate was served from the
local branch against only the designated TEST client. This is candidate proof,
not deployment proof. No headless browser was used locally.

A sample created through the normal staff Create Post flow had both required
native work items. The real client Approve button saved its decision and approval
timestamp; Request change saved Tweaks Needed and the exact typed note. Native
work-item and source writes returned HTTP 200. The normal Samples reader
confirmed both saves. Archive was verified, and both work items were read back
in Backlog. The receipt contains no identities: [live-saves.json](live-saves.json).
An earlier unlinked disposable fixture was correctly refused by the existing
native-link rule; it was archived and read back too. No permission or business
rule was bypassed to make the proof pass.

Read-only real TEST checks of the review queue, Sheet and Analytics passed at
360/390/430: 44px controls, 16px fields, light mode and no sideways page scroll.
The live post-open decision check was at 390; its queue was cleared by the native
decision flow, so the later three-width live check measured the resulting queue.
Post-open visual and action checks at every width are covered separately by the
fictional browser gate. See [live-layout.json](live-layout.json).

## Desktop and checks

The full existing desktop gate checked all 68 pixel and computed-style pairs at
1024/1280/1440/1920 for every staff header tab and the TEST client's views. Both
sides assembled their own fragments and replayed the same in-memory read
responses, including failures; original assertions, timings and write refusal
remain. Full native screenshots stay private because they contain identities.
The first full run matched all screenshots and 66/68 computed-style pairs. The
two Month pairs were repeated in isolation with unchanged source, assertions
and timings; both matched. All 68 final pairs match. The initial failed run is
retained in [desktop-parity.json](desktop-parity.json), alongside the repeats.

Public desktop content-only Calendar pairs illustrate the unchanged page at
all four widths: [1024 before](desktop/calendar-1024-before.png) / [after](desktop/calendar-1024-after.png),
[1280 before](desktop/calendar-1280-before.png) / [after](desktop/calendar-1280-after.png),
[1440 before](desktop/calendar-1440-before.png) / [after](desktop/calendar-1440-after.png),
[1920 before](desktop/calendar-1920-before.png) / [after](desktop/calendar-1920-after.png).
Their exact PNG comparison is [desktop/public-pairs.json](desktop/public-pairs.json).
These cropped public examples supplement the 68 full-page comparisons.

The Expanded phone gate passes 897 assertions. The existing Calendar/Samples
phone gate passes five sizes per surface, including landscape, with native
Approve and Request change payload checks. Real check tails are in [checks.txt](checks.txt).
The Production gate still fails its desktop editor-placement assertion on
unchanged main too. That check is not green; no hosted CI result is claimed.

No merge, deployment, database/schema change or n8n edit was performed.
Lighthouse owns merging. Owner action: review the phone design; keep the signed-in
browser open. Revisions to the Calendar checkpoint take priority before another
PR opens. Cumulative goal tokens are reported in the handoff; per-PR usage is
unavailable.

Final design verification: the hosted-test harness was repaired, phone pictures
were refreshed at all three widths, and desktop was rechecked at all four sizes
(68/68 identical). Real Approve and Request change saves were repeated on the
owned TEST source and freshly read back, with cleanup confirmed. The anonymous
receipt is [final-design-saves.json](final-design-saves.json); exact final check
tails are in [checks.txt](checks.txt). This remains local candidate proof.
