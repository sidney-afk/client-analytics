# Staff phones · Today, Templates, Filming Plans and Submit (Expanded)

This slice builds four staff screens for phones from layout A (Expanded) of the
approved mock-up gallery: Today, Templates, Filming Plans and Submit. It is
built on top of the client Calendar branch (it needs nothing from it except the
phone-only scoping pattern) and touches no other screen.

The screen name, Tabs and More share one title row. The wide header gives way to
it on these four screens. Tabs lists every tab the header shows today (same
visible set, same routes: Linear is still SyncLinear, Submit is still Submit).
More holds what the header's menus held. Every row presses the existing header
control, so permissions, handlers and business rules are exactly the old ones.
Nothing was added, removed or renamed in what a person can do.

Every new style sits in one `STAFF-PHONE` block inside
`@media (max-width: 767px)`, and every selector starts with
`body:has(.pocket-staff-bar)`. That bar is created by script only on a
phone-width screen showing one of the four tabs and is removed everywhere else
(`src/index/099-staff-phone-bar.js.part`), so no desktop width and no other
screen can match. `test/staff-phone-css-scope.js` enforces this.

## Pictures

All pictures come from the real generated app with made-up data (fictional
clients and a made-up staff member, no live backend). Fonts are the mock-up
gallery's local Plus Jakarta Sans, because the build sandbox has no web fonts.
No picture shows a real client or person: the harness swaps the app's built-in
client roster for made-up names before anything is drawn and fails if a built-in
name is on screen.

* [compare/](compare/) mock-up A beside the real screen at 390 (the mock-up
  column also shows its B layout lower down; ignore that).
* [before/](before/) the unchanged screens, light, 360 / 390 / 430.
* [after/](after/) every state, light, 360 / 390 / 430 (`<state>-light-<width>.png`).
* [after-dark/](after-dark/) the main states in dark, 360 / 390 / 430.
* [measurements.json](measurements.json) counts and smallest sizes for all 270
  renders (45 states x 3 widths x light and dark).
* [checks.txt](checks.txt) the real last line of every check that was run, including the
  ones that are red here and red on the base branch too.

| Screen | States covered (each at 360, 390, 430, light and dark) |
| --- | --- |
| Today (SMM / admin) | Rings, a ring opened, Walk-through, all clear, could not load, loading |
| Today (editor) | List, Deck, all clear |
| Templates | Index, index with pins, pin editing, pin picker, search results, index load error; client page loading, ready (Quick look, Links, folders, Editor brief), no brain folder, brain unreachable, facts view without a brief, brief line menu (Source / Change), many links, editing links, spec form, Send a change box |
| Filming Plans | List, search with no match, Add / update form, row editing, empty, could not load, loading, status note |
| Submit | Form, client search results, no match, client chosen, filled in, saved copy box, status message, success banner |
| Shared | Tabs sheet, More sheet (on Today and on Templates), client picker sheet |

## What the checks do

`docs/syncview-design/tests/staff-phone-browser.js` serves the real built app,
seeds a stub staff identity (admin, and an editor for the editor Today), answers
every backend call with made-up data and refuses anything that is not a plain
read (the run fails if a write is attempted). For every state, width and theme it
checks: no sideways page scroll, every visible control at least 44 px high and
wide, every editable text field at least 16 px, no text character standing in
for an icon (arrows, check marks, crosses, warning signs, emoji), and no built-in
client name on screen. Result: 270 renders, 0 problems.

## Still different from the mock-up, and why

* **More has more rows than the mock-up's two.** The mock-up shows "Change
  client" and the appearance switch. The old header also carried Quick jump,
  Original status colours, Time Off, Onboarding, Client Credentials and Staff
  sign in or out (each only when the person may use it). They are all still
  reachable, so all are in More.
* **The client picker is a bottom sheet opened from More.** The old header had a
  client chip on all four screens; the mock-up has none. It is the same picker.
* **Today rows show the full title and the buttons under it.** The mock-up cuts
  the title to "Example p..." so two buttons fit beside it. A cut title hides
  which post it is, so the buttons sit on their own line.
* **Today's meter has as many segments as there are items.** The mock-up's 8 are
  example data.
* **Done rings keep a drawn check mark in a quiet grey circle**, like the
  mock-up, but the mark is drawn with CSS borders, not the mock-up's text
  character.
* **Templates shows what the real page has.** The mock-up's Templates example had
  no brain folder, so it has no Quick look and no Editor brief; the real page
  keeps both (restyled as cards), plus the loading and error states.
* **Submit's title field keeps the saved wording** (for example "Sample Client One
  · 5 Oct 2026" with the date the batch title already contains). That text is the
  batch title that is saved, not a display date, so it is not reformatted.
* **A time is still a time.** Today's "Cleared today" chips show "12:45 AM"; only
  dates use "Sat, 3 Oct 2026".
* **Touch screens lose three keyboard-only things:** the "Enter to accept" hint in
  the search boxes, the "Shift, paste last link" hint under each video in Submit,
  and the black hover tooltip (it pinned itself after a tap). Their actions are
  unchanged and still work with a keyboard.
* **The gallery's own picture frame** (status bar, home bar, B layout) is not part
  of the app.

## Not tested here

* A real signed-in staff session. Everything above is the real app with made-up
  answers. Real queue sizes, real client names and long values, the real brain and
  filming-plan answers and each real role's Today are for the later signed-in check
  by another session.
* Real phones and real touch keyboards (Chromium's phone emulation was used).
* No live writes of any kind were made; this slice needs none.

Entry: `docs/ops/OPEN_REPAIRS.md` 341.
