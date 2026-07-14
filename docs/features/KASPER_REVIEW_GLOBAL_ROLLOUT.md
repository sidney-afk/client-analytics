# Kasper review state — global cross-device contract

> **Current status (verified 2026-07-14): DEPLOYED.** This is a deployed-state record, not an
> executable rollout guide. Do not re-run the former SQL or edit a live n8n allowlist from this
> file. Canonical evidence is the committed schema, `calendar-upsert`, `index.html`, and
> `test/kasper-review-state-global.js`.

## Product contract

Kasper's **Finish reviewing** handoff and **X-close** state are global, not browser-local:

- `kasper_finished_at` records an explicit handoff when unresolved change requests remain. The
  card stays in **Tweaks pending** across refreshes and devices. A later message updates the thread
  in place and does **not** return the card to Waiting. Only an actionable component explicitly
  routed back to `Kasper Approval` creates a fresh ask.
- `kasper_closed_at` records an X-close. A genuinely newer message can reopen that hidden card.
- Browser-local dismissed/closed maps are same-device continuity only; persisted timestamps are
  the cross-device source of truth.

## Current implementation evidence

- Both fields exist in the committed `calendar_posts` schema baseline.
- `calendar-upsert` accepts both fields and protects their update semantics.
- Calendar and Samples/Kasper writers persist them; the normal echo and realtime paths return them.
- `_kasperIsFinished` implements the explicit-reroute-only rule. `_kasperIsClosed` compares the
  close stamp with the newest message creation time.
- `test/kasper-review-state-global.js` covers global state, local fallback, explicit reroute, reply
  behavior, and close behavior.

The historic migration and one-time catch-up instructions are complete and intentionally removed
from the operative tree. Git history preserves them if incident forensics needs the old sequence.

## Verification

Use two isolated TEST-client sessions, ideally separate profiles/devices. Request a change, finish
reviewing, and prove both sessions remain in **Tweaks pending** after refresh. Add an SMM/client
reply and prove it remains pending. Explicitly route an actionable component back to
`Kasper Approval` and prove it returns to Waiting. Separately X-close a card and prove only a newer
message reopens it. No verification step should touch a real-client record.
