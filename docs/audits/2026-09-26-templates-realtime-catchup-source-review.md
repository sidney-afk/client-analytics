# Templates live-update catch-up gap — source-only proposal

**Source snapshot:** `3f5bd46e6086911ae2a7bb0d32507f03d5a44da8` on 2026-09-26. This is a checked-in-source finding, not a hosted or live reproduction. It proposes no runtime change.

## Repeated pattern

Calendar's live-update repair in `ee787cb8` and OPEN_REPAIRS 264 measured a channel object that existed after every WebSocket handshake failed. Calendar now records the subscribe status and pulls while disconnected. Workload's `3f5bd46e` keeps a five-minute catch-up poll and reads again after reconnect (OPEN_REPAIRS 265). The shared lesson is that an existing channel object does not prove that an open page is receiving changes.

## Current Templates path

- `src/index/050-market-briefs.js.part:1348-1362` reads Templates rows from REST. `loadTemplates()` uses that read, then starts the channel (`:1420-1434`). The three direct `loadTemplates()` calls in `src/index/260-production-refresh-boot.js.part:1683,1695,1820` are boot calls; a second search of the built `index.html` found the same three call sites and no Templates catch-up timer.
- `src/index/050-market-briefs.js.part:1364-1382` stores the channel object and calls `.subscribe()` without a status callback. Its early return tests only whether the object exists. A later `CHANNEL_ERROR`, `TIMED_OUT`, or `CLOSED` status cannot clear that guard or request a new REST read.
- `docs/independence/SYSTEM_MAP.md` §4.11 confirms that Templates reads from REST plus the `syncview-templates` channel, and that the channel is deliberately kept across navigation. OPEN_REPAIRS 250 records the move to the single Supabase source. This is the current Templates read path, distinct from the Calendar approval notice in PR #1703 and the Samples retry proposal in PR #1714.

**Source inference:** If a staff member leaves Templates open while its channel fails or misses events during a disconnect, another staff member's saved working-link change may remain invisible until a page reload. Automatic reconnect could deliver future changes, but this code does not read back changes missed during the gap. No live frequency or actual missed edit is claimed.

## Separate fix to evaluate

Track the channel's real subscribe state. While an open Templates view is disconnected, use a bounded, visible-tab catch-up read; read once again after reconnect. Reuse `_tplLoadFromSupabase()` and `_tplKeepLocalEdits()` so a catch-up does not overwrite a local dirty or in-flight edit. Keep the existing staff-only write path and avoid polling continuously while connected.

An offline browser test should hold an open Templates view, fail the mocked subscription after a successful REST read, change the mocked server row, and prove a bounded catch-up paints the new value. It should also cover reconnect after a missed event, a dirty local field, and no extra reads while connected. The runtime fix and any hosted verification belong in a later PR.
