# Review stage on phones — Pocket, 2026-10-18

Fictional fixtures only. No live writes, client data, merge, deployment or switch changes.
The owner reported that every client received the new page on 2026-10-18.

Worst problems first:

1. **Staff could not finish after sending a part back.** The stage treated a part with content as waiting for approval even after its status changed. The status must still be `Kasper Approval`.
2. **A caption edit disappeared on reload and after a failed save.** Only conversation drafts were stored; the editor closed before its save completed. Caption edits now survive reload, stay editable after failure, and clear after confirmed save or Cancel. Restoring never sends or approves anything.
3. **The approval message could cover staff Finish in landscape.** Its fixed bottom position put Undo over the next action for several seconds. On this phone view it now sits at the safe top edge, with a 44 px Undo target. The test checks that the next action is uncovered.
4. **Small controls and text made phone use difficult.** Many targets were 16–42 px; the note box was 13.76 px and the caption editor 15.2 px. Phone controls now have 44 px targets and fields use 16 px text. The surrounding staff navigation used 30–36 px desktop controls in wide landscape because the old phone rules stopped at 767 px; this review view now enlarges those too, preserving the existing menu scrolling and handlers. The old field sizes risk Safari focus zoom; a physical iPhone was not used to prove that symptom.
5. **Playback speed disappeared and the vertical player became a sliver in landscape.** Narrow-player rules hid speed and tied width to viewport height. The phone player now uses the available width, contains the video, and keeps speed and Full screen; skip buttons give way on a narrow player so targets do not overlap. The same phone layout covers the Pixel landscape profile beyond 860 px, including the caption editor. The staff post title and date note wrap instead of being clipped.
6. **Delete note and staff Close card were missing from the new page.** Both now use the existing permission checks and save functions. Delete writes a tombstone and leaves status alone. Explicit Close also clears the stage's kept-card reference; background removal still keeps the card on screen.
7. **A connection failure showed developer diagnostics.** The client review notification now gives plain recovery instructions; the existing refusal report retains the diagnostic code.
8. **Loading moved the conversation on the smallest phone.** Skeleton controls were shorter and the loaded composer exceeded the reserved conversation height. Phone placeholders now match the controls and reserve the conversation height.
9. **Windows WebKit could stop a video that was drawing a picture.** Both frame counters stayed zero. A readable video frame now confirms a picture before the existing no-picture fallback runs. Cross-origin reads that are forbidden retain the previous fallback. This is a Windows WebKit reproduction, not proof of a physical Safari defect.
10. **Background recovery could throw before shared staff state loaded.** The asynchronous Samples recovery task read `_kasperState` between startup scripts. It now uses the calendar recovery task's early-state guard; queue loading calls it again. The race regression verifies both the early call and inspection of retained repair debt after state arrives. No repair or receipt check is removed.

## Repeat the coverage

From the repository root:

```sh
npm install --ignore-scripts --package-lock=false --no-audit --no-fund
npx playwright install webkit chromium
node scripts/build-index.js
node test/review-stage-phone-browser.js
```

On Linux, install system dependencies with `npx playwright install --with-deps webkit chromium`.
Set `PHONE_SHOTS` to an output directory to retain native viewport screenshots. CI sets this and uploads the complete set, including failure pictures. `PHONE_ONLY`, `PHONE_ROLE`, and `PHONE_THEME` select a focused reproduction; omit them for the complete run. `PHONE_MODE=layout` runs only the geometry/typing matrix and is not the full action proof.

| Engine | Device descriptor | Portrait viewport | Landscape viewport |
| --- | --- | --- | --- |
| WebKit | iPhone SE | 320 × 568 | 568 × 320 |
| WebKit | iPhone 15 | 393 × 659 | 734 × 343 |
| WebKit | iPhone 15 Pro Max | 430 × 739 | 814 × 380 |
| Chromium | Pixel 7 | 412 × 839 | 863 × 360 |

Every descriptor runs in light and dark, for the client and staff: 32 cases.
These are Playwright's actual device descriptors, including touch, mobile mode, scale and user agent; viewport sizes are not the devices' physical display resolutions.

Client actions: open the review route; see and switch cards; play/pause inline without autoplay; touch-seek; change speed; switch parts; send video and caption notes; delete an own note through the existing tombstone path; edit the caption; reload during editing and change-request typing; drop the connection after each save starts; see recovery messages; reconnect and verify the exact saved words; approve video, thumbnail/graphic, title and caption; Finish; visit again and read back the approvals.

Staff actions: open Review Session; play/pause/seek/change speed; approve video; send the caption back; Finish; Close the next card. The caption editor is intentionally absent in this staff view. No notification-sending action is exercised.

Geometry checks cover page overflow, all visible stage controls' target sizes, field fonts, skeleton-to-loaded positions, and field visibility/scale in a reduced viewport. Existing desktop, save, composer, no-picture and switch regressions remain active. The older phone-speed expectation was changed to require the newly requested speed control; its fit/overlap assertions remain.

## Evidence and limits

The shared fixture intercepts remote responses and keeps server state in memory. Its phone mode also answers native recovery reads. Windows WebKit loads a generated H.264 version of the existing fictional clip from loopback because its media loader bypasses Playwright routing; Chromium keeps the original WebM. Neither media URL reaches a provider.

Before/after pictures are native viewport captures, with fictional content. Earlier failed attempts remain in the local evidence receipts; they are not passing runs. The PR reports the final commands and completed results separately from hosted CI.

See the [before/after gallery](GALLERY.md). The complete device matrix is retained as the CI artifact. Source permission checks and the normal save paths stay in charge; no write gate changed.

Device emulation does **not** launch Safari's actual bottom toolbar, an iPhone notch/home indicator, or its software keyboard. Safe-area CSS and dynamic viewport behavior are covered in source and emulated geometry; the reduced viewport is a keyboard stand-in. A real iPhone check remains required for those OS surfaces, real mobile codecs, and production behavior. Playwright itself recommends macOS WebKit for the closest Safari video behavior: [browser platform differences](https://playwright.dev/docs/browsers#webkit).
