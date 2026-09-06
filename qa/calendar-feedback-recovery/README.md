# Calendar feedback recovery: decisive local proof

Candidate based on `7e5a743cce8a1552bc822e0e560896451f983cdf` (branch
`fix/calendar-comment-receipt-fingerprint-20260905`). Contract:
`docs/ops/CALENDAR_FEEDBACK_RECOVERY_CONTRACT.md`. All identities, cards, text
and tokens here are fictional. No network, credential, live backend, TEST
client, workflow dispatch or deployment is used or required.

The preserved author head `a9d798e6120ddf13c6461bec496715dc06c4bcef` was
independently rerun: original 19 handler groups / 621 assertions and 11 browser
groups / 266 assertions passed. Independent probes nevertheless exposed the
defects recorded in
`docs/audits/2026-09-06-calendar-feedback-recovery-independent-corrections.md`.
The corrected handler has 22 groups / 855 assertions; the browser has 12 groups /
276 assertions, including an actual old document whose unbound status stays
visibly held. `node test/calendar-feedback-recovery-browser.js --precommit-probe`
adds one group / 6 assertions for ordinary root-note preservation after actual
gateway refusal. Set `CALENDAR_RECOVERY_DOCUMENT_REVISION` to the preserved
author SHA with that probe to reproduce its text-loss failure. Document bytes
remain pinned and verified by the harness.

The original counts below describe the preserved matrix. Multiple HTTP retries
use synchronous psql transport; `Promise.all` does not prove overlapping SQL
transactions or lock waits. Lifecycle hooks commit their edits before recovery
enters the RPC. Those limits remain explicit; no race proof is inferred from
the test names.

## What runs

- `pg.js`: starts a disposable PostgreSQL 16 (or uses the CI `postgres:16`
  service through the standard `PG*` variables, or `CALENDAR_RECOVERY_PG=
  host:port:user`), loads the live schema baseline plus the production-comment
  deltas and `migrations/2026-09-05-calendar-feedback-recovery.sql`, seeds one
  fictional client with one card whose video and graphic slots are bound to
  two calendar-origin deliverables, and counts rows.
- `seam.js`: a strict supabase-js-shaped client over psql. Only the builder
  methods the two handlers use exist; anything else throws.
- `edge.mjs`: loads the ACTUAL `production-write` handler (working tree, or an
  exact git revision for the baseline) and the FROZEN `calendar-upsert`
  handler in-process. Only the npm Supabase import is replaced; relative
  imports resolve to the real files; external fetch is refused; background
  work is collected and drained.
- `handler.mjs` (`node test/calendar-feedback-recovery-handler.js`): 19
  groups, 621 checks. For video/graphic x note/tweak: the client add and its own
  status through the real handler, the baseline handler ignoring the recovery
  request without materializing anything, the candidate materializing exactly
  once with every counted row (comments, receipts, outbox, status events,
  calendar events, materializations, card fields, alias) and an idempotent
  replay. Then: outbox-less acceptance, response loss (`already_present`),
  comment-copy-only debt (`source_fields_diverged`), native edit/delete/resolve
  holds, a later staff status move not blocking, unrelated source edit
  (`source_row_changed` then success with the current revision), concurrent
  review entries and tombstones preserved, wrong client token / unbound card /
  broken reciprocal link refused before any write, companion status
  unreserved / unproven / foreign, malformed, tombstoned and alias-divergent
  cells, malformed gateway requests, a transaction failure leaving no partial
  change followed by exactly one materialization, and three offered retries
  producing one materialization through the synchronous SQL seam.
- `browser.js` (`node test/calendar-feedback-recovery-browser.js`): 11
  groups, 266 checks, the complete document with the ACTUAL offered client
  controls. Review tweak
  button, the Sheet notes overlay for a root note, source refused, refresh,
  `Retry card sync`; both components; response loss of the source save and of
  the own status; native edit/delete racing the retry; unrelated source edit
  with newer typing kept; wrong client; old attempt without original context.
  `--baseline` with `FEEDBACK_SOURCE=<worktree of the base>` proves the exact
  base document and handler still hold and never materialize.

Reports and screenshots stay under ignored `.codex-tmp/`; set
`CALENDAR_RECOVERY_REPORT` to retain the handler JSON off-repository.

## What this does not prove

Serving parity (the deployed `production-write` and the applied migration),
live TEST-client journeys, the Samples surface, legacy `tweaks`-alias
reconciliation, replay of a missing native status, and any behavior after a
later native lifecycle change remain outside this lane and are release gates
owned by the coordinator.
# Local database boundary

The fixture drops and recreates its own database names. External `PGHOST` or
`CALENDAR_RECOVERY_PG` configuration is accepted only for loopback addresses or
local Unix sockets, with a valid port; remote targets refuse before any database
probe. `test/calendar-feedback-recovery-local-target.js` checks that boundary
without opening a connection. Use a separately owned disposable server.
