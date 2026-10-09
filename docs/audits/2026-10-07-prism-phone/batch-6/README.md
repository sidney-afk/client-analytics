# Analytics readability and Clients empty guidance

Analytics had tiny, faint supporting text and chart labels, with cramped detail
columns. Clients sent a person with no clients back to a search that could not
help, and reduced New client to an unnamed icon on a phone.

- Analytics uses readable supporting labels, neutral panels and balanced detail
  columns. Native chart axes use 13 px phone labels with measured contrast;
  series, modes, themes and resizing preserve the data and desktop labels.
- Clients shows the New client label beside All clients, with a full-width
  search. Empty guidance points to creating a client, or to Show archived when
  archived clients exist. Desktop restores its original guidance and layout.
- Regression guards reject the old Analytics labels and axes. Clients checks
  open and dismiss New client, follow archived guidance, and exercise search
  and list menus. Capture guards require a fully visible native heading.

[Expanded draft mockup](mockup.html) was reviewed before implementation on the
native main shell. Its draft chart Y labels remained faint; this was caught
during review and corrected in the native product, not claimed as accepted
draft evidence. [Gallery](gallery.md) contains 40 matched native before/after
phone pairs at 393 × 852 and 412 × 915 in light and dark. Every complete page
was personally viewed in unscaled chunks; different before viewports were
separately inspected. [Reviews](reviews.json) bind the judgment to source and
PNG hashes: 32 CLEAN cells and eight OPEN cells.

Four Clients loading cells remain OPEN because the native loading view loses
its heading and controls. This existing loading-shell problem needs a separate
repair: the initial-loading lifecycle replaces the shell, so retaining navigation
needs a focused lifecycle check beyond this batch's readability and guidance
changes. It is not accepted as clean. The four New client form cells remain OPEN: the existing manager control is a
native select and needs a branded-picker review. Open, Cancel and Escape work
in the intercepted fixture, but this batch does not accept that form as clean.
Repeated Workload chips remain an unconfirmed candidate, not a reproduced
defect. The full [coverage round](../COVERAGE.md), missing native setups and
separate fresh-eyes round remain OPEN. This batch does not reach the finish line.

[Desktop proof](desktop.json) records 44 exact 1440 px pairs against integrated
main: 12 broad staff screenshots, 12 Analytics pixel/computed-style pairs and
20 Clients pairs, including cold and phone-to-desktop transitions. Existing
staff-phone, client-phone and CSS scope checks pass. [Check receipts](checks.json)
preserve actual terminal endings, including rejected captures, failed attempts,
and the corrected runs. Hosted CI and deployed behavior are separate gates.

The final CI runner also loads the pinned production Chart.js bytes through the
existing hash-checked admin helper; it does not need a private vendor directory.
An intercepted no-vendor baseline reproduced the missing native chart, and the
same strict native axis/action checks pass after repairing the fixture transport.
Product fragments and the reviewed screenshots are unchanged by this harness fix.
The streamed boot fixture's drawing stub also now exposes Chart.js 4 plugin
registration and its instance collection. Its missing API caused the hosted
boot error; uncaught-error and navigation assertions stay unchanged. Axis and
chart-action acceptance uses the actual pinned library, never this boot stub.

[Source](source.json), [capture/action receipts](capture-receipts.json),
[PNG hashes](screenshots.json), [viewport comparison](viewport-review.json) and
[ledger census](ledger.json) make the evidence reviewable. Earlier transitional
menu captures were rejected; accepted captures wait for the wrapper to become
visible and reset ordinary scrolling instantly. Fixture fonts are served locally.

PR 2008 was confirmed merged before this fresh branch was created. Chrome stayed
headless. All captures and actions use fictional data and intercepted transports.
There were no live writes, database changes, n8n edits or GitHub merge by Prism.
