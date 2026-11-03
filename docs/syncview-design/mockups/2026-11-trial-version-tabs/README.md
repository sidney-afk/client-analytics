# Trial version tabs: three options (plan row 688, design step only)

One trial card with A/B/C version tabs. The same trial is drawn three ways on every surface it touches, at 1440 and 390: 3 live versions (A Approved, B waiting for the client, C changes asked) and 1 dropped (D). Placeholder data and pictures only. Nothing here is wired into the app.

- `mockup.html`: the page. `?w=390` shows the three options side by side at phone width; `?w=1440` stacks them at desktop width; `&opt=A|B|C` shows one.
- `side-by-side-390.png` and `option-{A,B,C}-{1440,390}.png`: rendered by `node make-shots.js`.

| Option | Tabs | Collapsed card, Month, Week |
|---|---|---|
| A, letter pills | A pill row under the title, with a status dot on each pill | Three status dots, lettered on the Sheet |
| B, segmented control | Sits on the card's picture and swaps the picture, link and caption in place. Each segment's colour is its version's status | A three-part status bar |
| C, filmstrip | Small thumbnails labelled A, B, C, between the picture and the title (a column beside the player on the review page) | A stack of the three thumbnails with a count |

Every option keeps today's card below the tabs. The Trial switch moves into the card header. The selected version's Video field carries its status pill, where the status is set today.
