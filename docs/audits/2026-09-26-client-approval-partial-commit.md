# Client approval can be saved while its Calendar card is still syncing

Source-only finding, 2026-09-26. This report does not establish hosted or live behavior. The separate, fully mocked browser reproduction is draft PR #1696; it never contacts a live service.

## Exact failure path

1. A client approval puts the approved status and sign-off stamp into the client review queue before sending (`src/index/190-calendar-approval-comments.js.part:768`, or the whole-post path in `src/index/170-calendar-links-status.js.part:671`).
2. The native status gateway acknowledges the video or graphic write. The Calendar save adopts that acknowledgement and marks the native operation committed (`src/index/170-calendar-links-status.js.part:1276-1295`).
3. If the subsequent `calendar-upsert` source save is refused, the save retains the committed status, records `_writeUiRetryEdits` and `_writeUiRetrySourceAt`, and schedules source sync retry (`src/index/170-calendar-links-status.js.part:1608-1631`). The card's existing label says **Saved, syncing** (`src/index/170-calendar-links-status.js.part:209-211`).
4. The review handler correctly avoids rolling that status back when the repair marker exists, but passes `_saveError` to `_calCrqFailed` (`src/index/190-calendar-approval-comments.js.part:780-788`). That queue handler drops a refused entry and announces **“Your approval was not saved”** and **“nothing was saved”** without checking the committed repair state (`src/index/185-client-review-queue.js.part:165-188`). The whole-post handler reaches the same queue message (`src/index/170-calendar-links-status.js.part:678-684`).

The client can therefore see **Approved** and **Saved, syncing** on the card while a notification says nothing was saved. Draft PR #1696's synthetic Track A case reproduces a native `production-write` success followed by a `calendar-upsert` 403; the source row remains at Client Approval, the native approval remains committed, and this contradictory notice appears. This is an offline reproduction, not a production observation.

## Narrow repair for a later code PR

Change only the queue's final-refusal notice when the queued action is an approval and the current post has `_writeUiRetrySourceAt` **and** `_writeUiRetryEdits` matching every status and client sign-off field in that exact queued approval. Then say: **“Approval saved; card still syncing”** and **“Your approval was saved. The card will retry syncing automatically. If the warning remains, tell your account manager.”** Keep the queue drop, inline error, native write, source retry and repair journal unchanged. A matching whole-post approval must include every component it approved; one successful sibling must never certify a refused sibling. Ordinary pre-commit refusals must continue to say the approval was not saved.

The regression should run in an offline browser with a native gateway acknowledgement and a refused source save, then assert the exact notice, approved component, pending repair marker, one gateway attempt and one active `/functions/v1/calendar-upsert` attempt. Add a pre-commit native refusal and a mixed whole-post outcome to prove the saved notice cannot appear for an uncommitted approval. Keep request-change copy as a separate decision: its native comment and card-status stages need their own exact commit proof.

This task cannot ship the runtime copy change: `index.html` is the served build output and is expressly protected for this work. Changing `src/index/185-client-review-queue.js.part` without a rebuilt `index.html` would leave hosted behavior unchanged and fail the index consistency check. No app, test registration, writer or repair code is changed here.
