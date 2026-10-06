# Phone polish round 1: Time Off

Personal Time Off still used the wide desktop header and a horizontally
scrolling calendar on phones. This round gives it the existing Expanded
phone shell and comfortable full sections without changing requests,
permissions, balances or decisions.

## Changes

- The page title, Tabs and small More button replace the wide header on phones.
- Full-width cards give balances, requests and history room to breathe.
- Balance labels and pending-request status remain readable and explicit.
- Request, refresh, retry, cancellation and calendar controls have 44px targets.
- The team snapshot fits the viewport, with aligned available-day numbers.
- All seven calendar days fit; the agenda underneath preserves every event,
  including crowded dates with more than three events.
- Explanations, date menus and cancellation dialogs fit the phone and retain
  their original actions and focus behavior.
- Staff sign-in has 16px fields, usable name/password controls and a full-width
  Continue button when it is the only action.

## Screenshot proof

Open [the interactive before/after gallery](gallery.html). It contains
**204 actual product screenshots**: 17 states at 360, 390 and 430 pixels,
in light and dark, before and after. These are native app renders in visible
Chrome, using fictional people, requests and dates with intercepted transports.
No live identities, share links or media are included.

States: overview, Tabs, More, request type, date picker, explanation, pending
request, cancellation, validation, saved-copy refresh error, uncertain write
outcome, disabled profile, loading, error, sign-in required, sign-in dialog and
name picker. Before screenshots come from unchanged main at
`cb413805923f2006e5f039c3e2a15ec81f296e1b`. Some are wider than the requested
viewport because the old page overflowed. Before Tabs shows the old navigation
rail; before More shows the original account menu.

The component browser suite asserts requested viewport fit, 44px controls,
16px editable fields, active theme, retained events, permission and uncertainty
locks, appearance switching, focus return and preservation of an unsent
request across desktop/phone resizing. All **102 after states passed**.
The six existing shared-header states also passed **36 renders**.

The native PTO lifecycle suite passed **101 action/result screenshots and
35 coverage gates**. Its [refreshed evidence](../2026-07-17-pto-lifecycle-simulation/gallery.html)
is bound to the current source fingerprint and visually reviewed image hashes.
One frame records an unrelated Today background error caused by its unavailable
client-list fixture; the tested More menu and Time Off action are visible.
The other 100 frames were reviewed as correct. The integrity gate passed.

## Desktop and limits

Every product CSS change is inside an existing phone media block. The shared
bar only mounts at phone width, and the calendar returns the original desktop
markup above that width. No backend, policy, writer or database changes.

The full desktop parity run compares every existing staff and client journey
at 1024, 1280, 1440 and 1920 pixels. It now also includes the previously omitted
menu-only personal Time Off page with loaded fictional data. Its results and
the final mandatory check output are in [CHECKS.md](CHECKS.md). Public desktop
images contain only the fictional Time Off fixture; client-link raw images
remain private.

The broad unit suite has existing failures on unchanged main in this Windows
environment. The final comparison and exact failures are recorded in CHECKS.md.
Private-input profiles are not counted as passing.

No live PTO requests or decisions were made. Browser interactions used mocked
transports; desktop client journeys were read-only and limited to the designated
test workspace. Physical iPhone/Android behavior was not tested. Client review
writers were not changed in this round. Nothing was merged or deployed.

Rollback: revert this PR; rebuild from the source fragments.
