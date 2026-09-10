# Client approve, half-committed: the replication harness

## What it reproduces

A client pressed Approve. The gateway accepted it and the deliverable moved to
`approved`. The calendar row that her page actually READS never followed, so her
card kept saying "Awaiting your approval" with a live Approve button. She pressed
it again, and the gateway refused a request to set a status the row already held
(fixed 2026-09-09, `clientOperationAllowed`) with `403 operation_forbidden`,
whose dialog text tells a client her account is not permitted to make the change
and to ask an SMM. Nobody could have helped: nothing was wrong with her account.

Measured on card `p_mrb65aeu_cjq0m`, 2026-09-09 (one active client slug):

| Source | State |
|---|---|
| `deliverable_events` 19:18:09 | `status_change`, role `client`, `client_approval -> approved` |
| `deliverables` | `approved`, `status_at` 19:18:12 |
| `calendar_posts` | `video_status` still `Client Approval`, `client_video_approved_at` null |

The row only caught up at 19:32, and not by her doing: no client event exists
after 19:18 and no sign-off timestamp was ever written, so a staff browser
projected the canonical status back into the card.

## How to run

```
npm install            # playwright; browsers are pre-provisioned in CI
node qa/client-approve-half-commit/probe.js
```

It serves the repo, boots the real `index.html`, seeds one card at
`Client Approval`, and drives the REAL client approve path. The client branch is
reachable without a client token: `_calReviewMode()` returns `client` for any
view that is not `smmreview`, so `_calReviewApplyApprove` takes the same branch,
stamps the same `client_<comp>_approved_at`, and routes the same gateway write.
The only client-link-specific code it skips is the `_isClientLink` status gate,
which admits `Client Approval` anyway.

Leg 1 (the gateway) and leg 2 (the calendar row) are recorded separately, and
each fault is scored against the live fingerprint above: committed AND stale AND
unstamped AND still showing "Client Approval" to the client.

## What it found (2026-09-09)

| Fault | Leg 1 | Leg 2 | Verdict |
|---|---|---|---|
| none (control) | commits | writes | correct |
| **gateway response lost** | **commits** | **never** | **REPRODUCES** |
| browser storage refuses the checkpoint | commits | never | no: card stays Approved, storage error shown |
| calendar upsert rejects (500) | commits | attempted | no: card stays Approved, retry armed |

Only a LOST RESPONSE reproduces it. The browser cannot distinguish "the server
never received it" from "the server committed and the answer was lost", assumes
the first, rolls the card back to `Client Approval`, and abandons leg 2. That
rollback is what re-arms the Approve button and produces the repeat clicks.

## The part that decides the fix

The durable repair journal ALREADY handles this correctly. Case `A2` proves it:
lose the first response, restore connectivity, let `_writeUiResumeSourceRepairs`
run, and leg 2 completes with the right status and the right sign-off stamp.

The machinery is not missing. It only ever runs **in that client's browser, if
she comes back**. She met an error, reported it, and closed the tab, so nothing
server-side was ever going to finish a write the server had already committed.

That is the open defect: the completion of a committed write depends on one
particular browser session surviving.
