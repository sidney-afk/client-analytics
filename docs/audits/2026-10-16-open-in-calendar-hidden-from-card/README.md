# Open in Calendar hidden when SyncLinear was opened from a card, 2026-10-16 (Signpost Two)

Follow-up to #2116 and #2122. Screenshots from `docs/syncview-design/tests/open-in-calendar-browser.js`
(`OPENCAL_SHOTS=<dir>`), fixture data only, mocked network.

- `before-from-card-desktop.png`, `before-from-card-phone.png` (390px): opened from a card, both "Back to card" and
  "Open in Calendar" showed, and both led to the same card.
- `after-from-card-desktop.png`, `after-from-card-phone.png`, `after-from-card-phone-dark.png` (390px): on a work
  item from the card you came from, only "Back to card" shows.
- `after-from-card-other-card-desktop.png`, `after-from-card-other-card-phone.png` (390px): opened from one card,
  then on a work item from a different card, "Open in Calendar" shows (to that other card) beside "Back to card".
- `after-direct-desktop.png`, `after-direct-phone.png` (390px): opened directly, no "Back to card", and
  "Open in Calendar" is exactly as before.
