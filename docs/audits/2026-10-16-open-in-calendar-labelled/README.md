# Open in Calendar as a labelled button, 2026-10-16 (Signpost)

Follow-up to #2116. Screenshots from `docs/syncview-design/tests/open-in-calendar-browser.js`
(`OPENCAL_SHOTS=<dir>`), fixture data only, mocked network.

- `before-*.png`: the old tiny grey calendar icon beside the title (from main before this change).
- `after-desktop-light.png`, `after-desktop-dark.png`: the button with the words "Open in Calendar", drawn as the
  Calendar's Notify client button (tooltip shown in the light one).
- `after-phone-light.png`, `after-phone-dark.png` (390px), `after-phone-430.png` (430px): the header row has no room,
  so the button sits on its own line under it.
