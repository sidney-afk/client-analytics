# Snapshot: "Normal Sales — Booking Handler" (before the test-booking HubSpot skip)

- Workflow ID: `ghpbQQJizAnR6p2b` (sub-workflow, started only by "Sales — Call Booked (iClosed)")
- Active version before the change: `3b5667f6-f2ae-4a88-b79b-8a223ef7bd92`
- Version with the change: `fd551429-581e-4765-8c95-a2b093156336` (published 2026-10-22 ~17:50 UTC)
- A later, separate edit by the nurture work built on top of it: `811f4f65-855c-4cad-a39f-0d94baf8669b`
- Raw workflow JSON is NOT committed here (it carries credential references; rule 8). n8n keeps the
  full version history, which is the recovery copy for this change.
- ROLLBACK of this change only: open the workflow, delete the If node "Test Booking?", connect
  "Normal Booking Input" straight to "Find Contact", publish. Or restore `3b5667f6-...` from
  History (this also drops any later edit, so prefer the node removal).

## What changed
```
before: Normal Booking Input → Find Contact → Is New Lead? → … (HubSpot contact + deal) → email, text, nurture
after:  Normal Booking Input → Test Booking?
            ├─ true  (owner's own plus-address test email) → Normal New Booking Today? → email, text, Kasper alert, nurture
            └─ false (everyone else)                       → Find Contact → … exactly as before
```
See `docs/ops/N8N_EDIT_LOG.md`, 2026-10-22 entry.
