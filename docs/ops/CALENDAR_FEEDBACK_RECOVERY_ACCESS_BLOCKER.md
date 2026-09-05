# Calendar recovery access: blocked local experiment

This is an incomplete, unpushed experiment from preserved draft #1304 head
`78e6b3eaf35e254daa23dd69b2d8f9ee54974434`. It is not a release candidate.
The preserved PR and the separate consumption-recovery branch are untouched.

## Exact boundary

The new actual-UI regression fails on unchanged 78e: native comment acceptance
followed by source 403 removes the pending Calendar card from client Review.
The experiment retains a recovery-only panel by matching the current
principal/client/card/component, original captured comment ID/body and source
repair reference. It exposes no approval or new tweak action in that panel.
The same-document assertion passes, but same-link fresh-page assertions remain
red for both source refusal and accepted-source response loss.

`_calPostLinearComment` deliberately passes no comment repair journal for client
gateway writes. The card-save path owns the source edit. The surviving journal
in this fixture contains only the component's native status intent.
`_writeUiReplayJournalGroup` replays those status edits and assigns them to
`post._writeUiRetryEdits`. On the fresh source-refused page, the current card's
comment list is empty and that retry payload no longer contains the original
comment. The owned composer attempt still retains its exact text and ID in
native phase. This is not evidence of native comment loss.

For accepted-source/lost-response, the fresh card DOES contain the committed
comment; its status-only retry payload still fails this experiment's stricter
captured-comment binding. These outcomes must not be conflated.

Completing the requested source-only recovery after a fresh source refusal
needs an explicit decision about preserving or reconciling that comment debt
through the existing client writer/repair path. A status receipt alone does
not independently prove the captured comment body. This experiment stops
instead of widening that pipeline, inventing a queue or resubmitting native
feedback. The visibility predicate is not relaxed to call an unproven repair
complete. A narrower solution using existing canonical readback may be possible;
it has not been implemented or proven here.

## Local validation and limits

- New regression, unchanged 78e: FAIL at initial accepted-feedback access.
- Experiment, native accepted/source 403: same-document access PASS;
  fresh-page access FAIL.
- Experiment, both committed/source response lost: same-document access PASS;
  fresh-page access FAIL.
- Completely refused request, same document and fresh expanded Review: PASS.
- `node test/write-ui-writer-durability.js`: PASS.
- `node test/samples-legacy-save-order.js`: PASS.
- `node test/review-draft-ownership.js`: 13 isolated cases PASS.
- `node test/repo-map-sync.js`: 316 assertions PASS; `git diff --check`: PASS.

The browser runner is `qa/feedback-drafts/calendar-recovery-access.js`.
Its default runs all three outcomes; `CAL_RECOVERY_OUTCOMES` selects an explicit
subset for diagnosis. Failure assertions remain unchanged and exit nonzero.
Only fictional in-memory receivers and the local complete document were used.
Frozen Edge Functions and browser writer functions were not edited.

Pending repeat-click, original-ID conservation through completed recovery,
late acknowledgment/newer text, owner switching, removal of only resolved
access, and responsive/keyboard acceptance remain NOT_TESTED for this candidate
because the fresh-page prerequisite failed. Do not infer those from the two
passing existing source suites. No hosted CI, installed or live journey proof.

## Recovery and release hold

Discard this isolated experiment or restore the preserved 78e document locally;
no production rollback is required because nothing was published or deployed.
Do not use this document as approval to replace an installed build. Existing
review, monitoring, client-continuity and live release gates remain held.
