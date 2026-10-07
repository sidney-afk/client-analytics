# Clients tab redesign: phase 1 mockups

Three directions for Kasper › Clients, for the owner to pick one. Fictional
clients and managers only (the repo is public).

- `gallery.html`: open it in a browser. Switch direction, desktop 1440 / phone
  390, light / dark, and "a client open" / "start". Inside each mockup the search
  (type, arrow keys, Enter, Esc), All clients, the manager picker, Edit / Save,
  history and the folded sections all work on fake data.
- `screenshots/`: `<direction>-<desktop|phone>-<light|dark>.png` for the
  profile, plus `-search`, `-all-clients`, `-manager-picker` and `-edit` states.

Directions: A Dossier (coloured header, one row of reach buttons, three colour
cards), B Index card (sticky identity card left, labelled rows with Open on the
right, drawer list), C Launchpad (every account a big clickable tile, manager
dialog showing each manager's client count, full-screen client grid).

Found while designing, for phase 2:
- `roster-write` is server-to-server only (n8n key, no browser access), so the
  picker must go through a new admin-only `assign_manager` action on
  `client-profile-write` that calls the same database function, keeping the
  history row and the Sheet copy queue.
- The Filming Plans pill filters but has no arrow keys; the up/down/Enter
  behaviour lives in the shared client dropdown (095). Phase 2 reuses the pill
  look and that keyboard code.
- Slack links need the workspace id (the managers' `slack_team_id`); Post for
  Me and Upload-Post links open the dashboard home until a stable per-account
  URL is confirmed.
