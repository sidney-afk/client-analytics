# Staff phone layout: before and after pictures

Pictures of the real generated app, drawn offline with invented data (made-up clients, people and posts) and every backend refused.
Nothing here was uploaded, saved or sent. Regenerate with `node qa/finch-phone/shots.js` (see `REPO_MAP.md`).

- `before/`: the base branch (client Calendar phone work) with none of this change, light, 360, 390 and 430 px wide.
- `after/`: this change.
  - Every state at 390 px, light: `<state>-light-390.jpg`.
  - The five main screens also at 360 and 430 px, light.
  - Eight states at 390 px in dark: `<state>-dark-390.jpg`.

State names: `tiktok-*` and `instagram-*` (Upload: empty, client chosen, no account, video or photos attached, schedule, options, queue tabs, queue error and loading, failed post, cancel dialog), `menu-*` (Tabs, More, client picker), `analytics-*` (overview table and cards, client view, Content Calendar, Brief, empty, error, loading, search), `workload-*` (week, month, Plan + Due Date, popover, empty, error, loading) and `linear-*` (list, detail, filter, More, search, empty, error, loading).
