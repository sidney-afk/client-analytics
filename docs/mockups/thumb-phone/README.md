# Thumb phone proposal — owner approval pending

Open [the single interactive mockup](index.html). Its four comparisons pair the
current app with one proposed direction; the buttons below each phone expose
the supporting screens. Light/dark switch at the top. Every decision has a
one-line reason. [All light screens](screenshots/all-flows-light.png) and
[all dark screens](screenshots/all-flows-dark.png) link to the complete inventory.

Calendar and Samples get a three-column Sheet grid, the **existing editable
card list** behind List, focused card details, and grouped More sheets.
**Review posts / Review samples** is the single primary action: an SMM scans
and reviews content before publishing; bulk selection and caption generation
are supporting tools in More. This is a workflow inference, not usage telemetry.
Open profile joins sort/filter, card size and archive in More. Sharing stays
near the top; appearance and account tools follow content actions.

Workload starts with today's agenda and deadlines, then pushes into a creative's
queue. Week and Month remain available; filters live in a bottom sheet and
planning actions belong to individual items. Availability, capacity, existing
planning semantics and authority must be preserved during implementation.

Messages gets list → thread navigation, unread markers, a bottom composer with
visible audience/component context, and a labelled/icon Messages tile in Tabs.
Implementation must start from fresh main **after the concurrent Messages
rebuild has merged**, and retain its read/mark/reply contracts.

## Evidence and limits

- Baseline: `df67f8c75e423451a92b033c8d139d53f54e1a9b` (freshly fetched main).
- Before: current generated app, existing offline staff/Finch/lost-work fixture
  libraries, invented content, native 390 × 844 viewport captures. Empty media
  tubs are the existing fixture's missing images, not real client media.
- After: 14 proposal screens at 390 × 844, light and dark, with 430px overflow
  checks. Mockup artwork is an abstract stand-in for thumbnails.
- Existing List cards are image captures of the actual current card, preserving
  its layout in this prototype. The implementation retains the real controls.
- Proposed navigation, filtering, composer placement and a retained draft are
  exercised by the renderer. Other controls show a prototype notice.
- All 28 proposed phone screenshots and both contact sheets were visually
  inspected. Native full-size captures were also reviewed for grid text, card
  detail, menu ordering, Workload actions and the Messages composer. Long
  menus/queues scroll inside their viewport; lower menu rows are reachable by
  scrolling. The phone layouts are coherent and contain no unintended overlap.
- [Desktop baseline screenshot](screenshots/desktop-current-main-1440.png):
  1440 × 900, fictional Calendar. **No product source or generated index changes**
  are present in this documentation PR. This is a baseline picture, not an
  implementation desktop-parity claim.
- No deployed, live-save, physical-device or real-keyboard proof is claimed.
  Keyboard-aware composer positioning, full modal focus/scroll behavior,
  persistence, and empty/loading/error states remain implementation gates.
- No existing phone tests were changed; no CI exceptions or skips were added.

## Reproduce

From the repository root, with the repo's Playwright dependencies installed:

```powershell
node --require ./test/helpers/single-file-index.js docs/mockups/thumb-phone/capture.cjs --before --messages-before
```

The renderer refuses external traffic for the proposed HTML and reuses the
existing fully intercepted libraries for current-app captures. It writes the
screenshots beside the page. [Check receipts](CHECKS.md) preserve actual tails.

## Approval boundary

This is the **one mockup**, opened as a draft PR for one owner OK. Do not merge
it or begin product implementation before that OK. Afterwards: fresh-main
Calendar/Samples PR, fresh-main Workload PR, then fresh-main Messages PR after
the concurrent rebuild lands. Each remains unmerged, keeps existing phone tests
green, includes every changed screen at 390px in both themes, and records a
desktop screenshot plus exact desktop parity. Update any intentionally changed
layout test in its owning implementation PR and explain why.
