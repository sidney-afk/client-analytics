# Client review recovery — successor hand-off

## Publication status: recovery packet, not a deployed fix

This packet preserves the recoverable work from an interrupted session.
It contains the exact 12-line product patch visible in that session's diff,
a reconstructed unit test, and the findings below. The patch is NOT applied
to index.html by this PR. No product behavior changes on merging this packet.

The earlier local checkout became inaccessible between turns. Its local commits
were 62452b8e and df109acb, based on main
b606b283f123347dae046aa82cf9076854e13d14. Git push failed because local
Git lacked credentials. API publication then hit automatic approval rejection
because the full existing ledger contained historical client identifiers,
despite the committed diff adding none. No new product PR was confirmed.
This packet is a transfer for an authorized successor, not evidence of deployment.

The original focused browser harness, raw result files, and exact complete
local git tree are NOT recovered in this packet. Do not claim byte-identical
restoration or treat the earlier reported results as fresh tests of this PR.

## What is fixed and live

PR #1371's repeat-approval refusal fix is recorded as production-write v70
in OPEN_REPAIRS 189. No fresh deployed-server inspection was performed here.
PR #1373's reproduction is merged.
PR #1374 merged at b606b283 with its instrument-only warning intact:
its counts are not trustworthy. That warning must remain. Read all fourteen
harness bugs before building another test.

## The candidate approval fix

The Calendar save passes component status to the durable repair journal but
omits the explicit client approval timestamp edit. The patch passes only the
action's existing video/graphic sign-off edit into that journal; it never
infers client approval from Approved status or manufactures a timestamp.

The journal-application helper also clears a captured stamp if the adopted
component state invalidates it, following the existing stale-approval rule.
Calendar video and graphic callers change; Samples callers do not.
The helper is shared, so regression checks must cover its existing callers.

This repairs future interrupted approvals when the originating browser resumes.
It cannot reconstruct missing stamps from old journals or fix a closed tab.
No Edge Function, schema, runtime flag, or n8n change is included.
No owner-run server deploy inputs are required for this browser-only candidate.

## Findings from the earlier run

All observations here used the actual app with mocked backend persistence.
No live client was changed.

The focused browser boot used a synthetic tokened Calendar link, required
the real verifier request and verified capability, and asserted a client
principal. Card data was seeded; real action handlers ran rather than UI clicks.

The initial change-request control failed because its fixture omitted the
client-comment gateway flag and therefore used the legacy path. Enabling
that flag and resolving a valid crosswalk through the real reader made
the control commit both the native and card writes. This was a harness
correction, not a product defect.

Approval outcomes:
- No fault: the exact original timestamp persisted.
- Lost response, 5xx after commit, rejected card write: the old app recovered
  status but omitted the timestamp; the patched app preserved it on resume.
- Never sent: no commit, no timestamp, explicit recovery held the status
  with status_reapply_required rather than blindly reissuing it.

The change-request lead was CONFIRMED as a storage split in that client
context: lost response and 5xx after commit left the native comment committed
but both card thread columns empty after explicit recovery. Rejected card
writes could recover status while still losing the thread.
Never-sent client comments did NOT commit on recovery; that earlier staff-boot
finding was an artifact.

This does not prove production frequency or that every editor misses the
request. A later read of the central comment store may show it; the fresh-editor
visual journey was not tested. The comment defect is not fixed by this patch.

The no-explicit-resume lane restored connectivity and observed 2.6 seconds
without calling recovery. It was not a browser-closed/fresh-browser test
and cannot prove that no external production process ever finishes the write.

## Earlier validation, not fresh validation of this packet

The prior session recorded:
- main: all 424 unit suites passed; the two historical failures in the brief
  did not reproduce in that environment.
- patched branch: all 425 unit suites passed.
- required prod-write-gateway-browser.js gate passed.
- focused client matrix passed with open comment/no-resume defects explicitly pinned.
- the SAME approval guard run against the pre-fix app failed on the missing
  recovered timestamp for all three committed-write faults.
- committed-diff identity gate: zero added client slugs or staff names.

The original browser matrix checked persisted status, overall status, exact
original stamp, and committed comment identity/body/tweak/audience/round/role
in both thread columns at both checkpoints. Rejected upserts were only attempts;
receipt mocks returned the current native row; commits were keyed by request id.
Empty runs, inert controls, page/handler errors and unexpected recovery errors
failed. Missing-stamp and committed-but-empty-thread scorer self-checks were
required. The recreated unit test here is NOT a replacement for that browser proof.

## Exact next actions

1. Read AGENTS.md and OPEN_REPAIRS 186, 189, 190; preserve #1374's warning.
2. Inspect and apply CLIENT_REVIEW_RECOVERY.patch on an isolated branch:
   git apply --check docs/ops/CLIENT_REVIEW_RECOVERY.patch
   git apply docs/ops/CLIENT_REVIEW_RECOVERY.patch
   Copy CLIENT_REVIEW_RECOVERY_TEST.js to test/client-review-repair-stamp.js.
3. Rebuild the focused token-verified client regression using the requirements
   above. Do not infer client behavior from a staff boot. Prove the negative
   control fails without the patch. Test newer-state stamp handling.
4. Run npm install, node test/run-all.js, and
   node docs/syncview-design/tests/prod-write-gateway-browser.js.
   Register new QA paths in REPO_MAP.md. Commit, then run
   node scripts/repo-identity-exposure-check.js --diff="origin/main"
   before pushing. Publish for review; do not merge inside the review window.
5. APPEND the verified outcome to OPEN_REPAIRS. The old attempted append used
   191 but was never published; choose the next unused number now.
   Earlier main already duplicated 13, 14, 22, 23, 175, 176.
   Do not silently rewrite historical references.
6. Investigate a fresh editor's view of the confirmed comment split, then
   design complete client comment/status recovery without duplicate comments
   or overwriting a newer decision. Do not simply enable staff replay for clients.
7. Leave the server reconciler separate. It needs an atomic newer-clock proof:
   repair only when the deliverable clock is demonstrably newer; newer cards,
   equal/unknown clocks must remain untouched and be logged. Calendar/SXR lack
   the Production-only CAS guard, and legacy status fallback can return skipped.
   CAS means checking that the stored value has not changed before writing.
8. Do not backfill missing historical stamps from status alone or today's time.
   First inventory card/deliverable IDs and establish authenticated client-event proof.
9. Retrieve the actual successful v70 Section 4 readback and append its receipt
   to EXECUTION_LOG.md; update the rollback row/baseline mechanically as its test
   documents. This paperwork remains open; no deploy receipt/hash was invented.

Deferred deliberately: durable server repair, historical backfill, comment
repair, Samples/Kasper/SMM browser coverage. A partially correct reconciler
could silently overwrite a newer client decision.

Fresh recovery checks: all three patch hunks matched the recorded main exactly;
the recovered journal helper passed 12 status/component checks. These are
limited checks, not a rerun of the earlier full browser or unit suites.
