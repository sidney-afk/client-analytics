# Calendar card: video and thumbnail buttons get their own icons (2026-10-16)

Owner request: the two Production buttons in a Calendar card's pile both showed
the same "open in a new tab" arrow, so only the outline colour told them apart.

- Video button (pink outline): play icon, tooltip "Open video".
- Thumbnail button (blue outline): picture icon, tooltip "Open thumbnail".

Size, colours and outline are unchanged. The Samples card draws the same pair
from the same helper (`_calProdBtnIconSvg`), so it changed too.

Pictures are from `docs/syncview-design/tests/calendar-prod-button-icons-browser.js`
on fictional data (`PROD_ICON_SHOTS=<dir>`), before = main, after = this change.
Nothing here ships to the site.
