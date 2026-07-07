# EF write-path end-to-end test harness

Validates SyncView's Supabase Edge-Function (EF) write path end-to-end on the **test client
`sidneylaruel` only**, so the owner can decide whether to move all clients onto it.

Full findings + GO/NO-GO: **`EF_WRITE_PATH_TEST_REPORT.md`** (this directory).

## What it does

Real headless Chromium runs the real `index.html`; a Node "courier" tunnels the page's backend
traffic to the LIVE backend (the sandbox blocks the browser's own egress — same mechanism as
`qa/sxr_courier_lib.js`). Every backend request is captured, so routing (EF vs n8n) is proven by
URL. Supabase rows are read back via the browser-safe anon key. Linear pushes are captured and
**mocked** by default (zero mutation); `EFWP_LINEAR_FORWARD=1` forwards ONLY the test client's
own allow-listed test issues to live n8n for the real round-trip (then reverted).

## Run

```
node qa/ef-writepath/run-all.js                    # capture+mock Linear (no mutation)
EFWP_LINEAR_FORWARD=1 node qa/ef-writepath/run-all.js   # + live Linear round-trip on test issues
```

Individual scripts: `00-smoke`, `10-status-linear` (Phase 1c/2), `11-calendar-writes`,
`12-samples`, `13-settings`, `14-realtime`, `20-routing-failsafe` (Phase 3), `21-drift-check`
(read-only, all flagged clients), `30-master-readonly` (Phase 4). Shared helpers: `lib.js`.

## Safety / rails

- Only `sidneylaruel` is ever written. All other clients are read-only.
- Linear mutations are limited to the test client's own allow-listed issues and reverted; any
  push to a non-allow-listed issue is blocked. The flagged-client roster is read from the live
  runtime flag at run time — no client identifiers are committed.
- No secrets: the only key used is the browser-safe publishable anon key already in `index.html`.
- Screenshots (if taken) stay local and are not committed.

## Sandbox note

The Supabase realtime WebSocket can't be tunneled here (proxy limitation), so the app's realtime
subscription times out and falls back to REST. `14-realtime.js` drives the app's own realtime
handler (the identical REST-refetch + pill re-render path a real push triggers). WS-timeout
browser errors are expected environmental noise and are filtered (same as the repo's courier).
