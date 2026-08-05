# Production comment mark-done CAS audit — 2026-08-05

## Scope and release boundary

This audit covers the staff Calendar and Samples/SXR canonical-comment action
`Mark done`, including the `Mark done — don't change the status` destination.
The candidate is browser-only: it changes `index.html` and an offline contract
test. It does not change or deploy `production-write`, `production-comments`, a
database object, a runtime flag, authority, Linear, or n8n. Merging the candidate
would ship through the ordinary Pages path; this draft performs no deployment.

## Cause

The reported race is real, with two corrections to the initial diagnosis:

- Comment lifecycle does not use the gateway's generic `assertCas`. Its own
  guard compares the submitted integer `expected_version` and cleaned
  `expected_updated_at` with the selected `production_comments` row, then the
  lifecycle RPC repeats both checks under a row lock with a typed `timestamptz`.
- The browser did not capture a new cursor when `Mark done` was clicked. The
  post-dialog callback found the comment again in the same in-memory canonical
  projection. The vulnerable interval therefore began at the last successful
  canonical read, potentially before the click, and included the entire human
  destination-choice delay.

The browser preserves the reader's `updated_at` string; it does not reformat it.
That, plus the intermittent success on retry, does not support a timestamp
formatting mismatch. Linear inbound is a real concurrent writer: comment
create/update/remove events converge on `production_comment_upsert`, and a
meaningful change advances both `version` and `updated_at`. It has one shared
direct upsert call site for those event classes, rather than three independent
direct table writes.

There is no same-action double write. One browser lifecycle request reaches one
gateway RPC, exact intent replay is checked before CAS, and resolve creates no
Linear outbox item. The two staff-visible errors are two renderings of the same
caught 409: the general failure notice and the canonical-action banner.

## Candidate behavior

Only `action === 'resolve'` enters the new path:

1. After the destination dialog returns, force a replacement canonical reread
   of the exact deliverable. The reader discards every cached page, walks the
   lifetime cursor again, and fails closed if that walk is incomplete.
2. Recheck staff identity, verification epoch, card/deliverable binding,
   canonical gate, read completeness, refresh errors, root identity, component,
   lifecycle capability, integer version, and row timestamp before writing.
3. Reject the attempt if a background refresh replaced the captured card
   object while the read was in flight; Retry must bind to the current row.
4. If the current row is already resolved, adopt that idempotent success with
   zero lifecycle writes.
5. Otherwise submit the body-free resolve with the freshly read CAS.
6. On exactly `409/write_conflict`, reread and retry once. A second conflict
   follows the existing fail-closed error path.

The error-banner Retry also preserves the recorded semantic action. A failed
resolve retries resolve (and its already-chosen route, if any); it never enters
the resolve/reopen toggle and therefore cannot reopen a row another writer has
already resolved.

Edit, delete, and reopen continue through the original lifecycle helper. In
particular, a text-edit conflict performs one write attempt and still requires
the user to review/retry; it can never enter the resolve rebase helper.

## Before/after behavioral proof

These are deterministic mocked-browser call counts, not a live production
mutation:

| Case | Before | Candidate |
|---|---:|---:|
| Canonical reads after destination choice, before first resolve write | 0 | 1 complete reread |
| Resolve writes after one injected `409/write_conflict` | 1 per manual attempt | 2 total maximum, separated by one reread |
| Resolve writes after a second injected conflict | repeated manual attempts possible | 2 total, then fail closed |
| Resolve writes when the reread says already resolved | 1 stale attempt possible | 0 |
| Writes after identity drift, incomplete pagination, or failed refresh | stale attempt possible | 0 |
| Edit/delete/reopen writes after an injected conflict | 1 | 1; no automatic retry |
| Explicit status-transition calls on the `stay` destination | 0 | 0 |
| Implicit overall-status recomputations during a comment-only card flush | 2 per flush; could alter local state and the non-v2 whole-card fallback | 0 |
| Legacy card comment-projection saves after successful `stay` | 1 | 1 |

The stay destination does write the resolved canonical thread back to the
card's legacy component `*_tweaks` shadow and therefore advances that card row's
`updated_at`. Before this candidate, the shared flush also recomputed the local
overall card status twice even though the v2 patch omitted status; a non-v2
whole-card fallback could persist that recomputed value. The candidate gates
both recomputations on a real component-status edit (or a new card), so a
comment-only flush preserves the card status in memory and on the wire. It does
not invoke the status transition helper, enqueue a Linear status/comment
mutation, or write the card projection before canonical resolve succeeds.
Unrelated already-pending card edits can still coalesce in the shared save
mechanism; the stay action itself creates no status edit.

The dedicated contract test executes the real paginated reader against an
old-page resolved→reopened fixture and includes sabotage cases for a missing
fresh read, stale-card binding, more than one resolve retry, resolve Retry
becoming reopen, automatic retry leakage into edit/delete/reopen, reuse of a
stale ready cache after refresh failure, and status mutation on the stay route.

The focused mark-done, save-order, chooser, failure-message, coverage-hold, and
production-comment-slice guards passed after rebasing onto current `main`.
The complete repository run also passed all 201 unit suites.

## Rollback

Revert the browser commit through the normal reviewed path and verify the
resulting Pages deployment. No Edge Function, database, flag, authority, Linear,
or n8n rollback exists for this candidate because none is changed.
