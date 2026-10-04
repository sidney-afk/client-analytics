# Expanded client Samples and Analytics — source preparation

This batch changes the actual `src/index/` app. It covers client Samples Review
with an open sample, the queue and Sheet, plus client Analytics. It starts from
main independently of the Calendar branch. It does not change staff, reviewer or
admin presentation. No merge or deployment has happened.

Samples keeps full Video and Thumbnail sections inside comfortable separate
cards. The existing decision buttons, comments, media, Notes and Sheet fields
keep their handlers and permissions. Card size moves into More. Tabs contains
the current Samples surface; its native Sheet/Review controls remain nearby.
Analytics keeps its existing numbers, formatting, charts, saved copies, retry
and About information. Its existing client tabs move into Tabs, and About moves
into More. The About menu closes before the native overlay opens.

Every new style is under a phone-width media query capped at 767px and scoped to
`html.boot-client`. Client links remain light. Moving to desktop restores the
existing controls, their contents and their original positions.

## Verification status

Source build, module checks and the client phone CSS scope guard pass. The
visible-browser pass is paused while the owner plays a game. The signed-in
browser closed during a browser-control restart; the owner has been asked once
to sign in when convenient. The new source is **not visually accepted** yet.

Before/after screenshots at 360, 390 and 430, the full desktop comparison and
real native Approve/Request change saves on a disposable test sample are still
required before this batch is PR-ready. Earlier working images are private and
are not presented as proof of the latest source. No PR is open for this batch.

The offline browser gate uses fictional data and intercepts backend requests.
It covers the three widths, full sections, native decision payloads, drafts,
sending and failure, confirmation, Tabs, More, Notes, lightbox, About, queue,
loading, empty, read failure, invalid/retry link states and desktop restoration.
An empty Analytics session is separate from a populated saved-copy session;
the test does not remove the product's saved-copy behavior to reach an empty
screen. The normal and both split-build CI lanes run this gate.

Run locally in visible Chrome:

```text
node docs/syncview-design/tests/client-links-expanded-browser.js --headed
```

Optional `--capture-before --before-root=<unchanged checkout>` records native
before screens without asserting Expanded acceptance. `POCKET_PHONE_SHOTS`
selects a local screenshot directory. No identity or credential is needed for
this intercepted gate. Live save proof uses only the designated test workspace
and stays separate from these offline assertions.
