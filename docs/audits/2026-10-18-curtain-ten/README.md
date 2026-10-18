# Review page, session Curtain Ten (2026-10-18)

Fixes for the client card gauntlet's open findings (`docs/audits/2026-10-17-card-gauntlet-client.md`, Curtain 1 and 2,
Other 1, 3 and 4) and the owner's play button report. All images are from the offline fixture (fictional client).

| Image | What it shows |
|---|---|
| `item1-words-sent-as-note.png` | The client typed a change while the post was approved in another window. Send: the words went to the team as a note on the video, and the stage says so. |
| `item2-kept-on-stage-marked.png` | The whole post was approved in another window. The same post stays on stage, marked, with Finish reviewing to move on. |
| `item2-smm-kept-on-stage.png` | The same on the SMM's Review tab. |
| `item3-before-*.png` | First load before the fix, about every 100 ms: a huge black play icon on a dark veil ("This video opens in a new tab") until the player's switch is read, then the player. |
| `item3-after-*.png` | After: the poster alone until the switch is read, then the player with its 44 px play button. |

Tests: `test/review-stage-elsewhere-browser.js`, `test/review-stage-first-frame-browser.js`,
`test/review-stage-curtain-ten-browser.js` (each fails on the base branch).
