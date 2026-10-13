# One staff phone Tabs menu

The staff phone Tabs sheets now share the reviewer two-column icon grid, native tab order, selected-tab highlight, spacing and labelled Close button. Overview and the client picker remain in the reviewer/admin context that previously provided them; they are not added to unrelated screens. Native destinations, hidden/disabled permissions and notification badges are preserved. Client links and desktop presentation are unchanged.

[Open the native before/after gallery](gallery.html). It contains Calendar, Samples, Workload and Today at 390 in light and dark; all data is fictional/intercepted. Images are original viewport captures, with the existing person-named feature represented by its role. The [hash receipt](screenshots.json) records each original PNG. No live client read or mutation was performed by these browser tests.

`qa/staff-phone-tabs-grid.js` covers 13 main entries and 12 reviewer/admin views at 360/390/430, both themes, opening each menu twice. It checks native icon markup/order, current tab, shared header/Close/backdrop, 44 px targets, no sideways page scroll, inside taps and focus return. It also exercises a real native tab switch once and verifies that hidden and disabled fixture tabs retain their restrictions. Requested admin views must be reached rather than silently testing the reviewer fallback. Calendar and Samples rebuild the grid on opening, so late native permission changes cannot leave stale links. The check runs in both CI phone lanes.

## Hosted read boundary

The existing Production fast workflow still includes unscoped live-reading tests. Its job condition explicitly prevents it from starting for this PR branch; it is NOT RUN, not called passing. Other PRs, main pushes and scheduled policy remain unchanged. The branch condition is guarded by `test/phone-tabs-ci-read-boundary.js`. Required offline phone and mocked-save lanes continue to run. No workflow was opened blind and no live Production probe was dispatched.

## Proof and practical limits

Source fragments were built with `npm run build:index`. Phone styling is confined to the existing shared phone-only block and uses existing variables. The desktop gate compares exact screenshots and computed styles at 1024, 1280, 1440 and 1920. Committed difference images contain only the pixel difference, with native screenshot hashes in the receipt. No tolerance or mask is used.

The [desktop receipt](desktop/parity.json) contains 48 exact native PNG pairs and 48 zero-difference images: the final full run matched 47/48; the remaining Analytics 1024 pair matched on an exact focused replay. Computed styles matched all 48 in the full run. Earlier raster failures and the unchanged-main control are preserved in the check tails, rather than called green.

[Real check tails and any failures](CHECKS.md). No merge, deploy, database or n8n change. Browser evidence is emulated touch Chromium with fictional transports, not physical-phone or deployed-service proof.
