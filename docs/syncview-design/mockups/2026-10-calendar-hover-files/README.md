# Calendar: status filter clear, hover card, files menu (2026-10)

Fictional data only. Regenerate with `node make-mockups.js` (item 2 and 3) and
`CARD_STATUS_SHOTS=<dir> node docs/syncview-design/tests/calendar-card-status-filter-browser.js` (item 1).

## Item 1, built: status filter clear on the pill
- Before: `item1-before-desktop.png` (strip under the toolbar pushes cards down)
- After: `item1-after-desktop.png` (pill reads "Hide Posted" with an x; cards stay put)
- Phone keeps its strip: `item1-after-phone.png`

## Item 2, built: hover card on the SyncLinear link
- Mockup: `item2-hover-card-light.png`, `item2-hover-card-dark.png`
- Built (owner approved without priority and comment count): `item2-built-light.png`, `item2-built-dark.png`

## Item 3, built: per-card files menu
- Mockup: `item3-files-menu-light.png`, `item3-files-menu-dark.png`
- Built: `item3-built-light.png`, `item3-built-dark.png`

Built screenshots come from `HOVER_FILES_SHOTS=<dir> node docs/syncview-design/tests/calendar-hover-files-browser.js`.

Only the dashed outline marks the control being hovered or clicked; it is not part of the design.
