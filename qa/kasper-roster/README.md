# Kasper roster readiness regression

This bounded **ISOLATED_BROWSER** follow-up reuses PR #1282's unchanged fictional
fixture, local server and fail-closed network guard. It does not copy its backend
or change its baseline ledger. Check out that draft separately at
`d2f67ba4037621484f1e08d0f9fb02635e9cbfcf`, install its documented browser dependencies,
then run:

```sh
node qa/kasper-roster/run.js --fixture /absolute/local/pr1282 --source /absolute/local/candidate
```

Both paths must be local Git checkouts. Results record both heads, source bytes,
the runner hash and observed serving hashes. Generated summaries, errors and
screenshots remain in ignored `.codex-tmp/kasper-roster/`; public handoffs contain
only synthetic counts, failure classes and hashes. No live runner is imported.

## Finite timing matrix

| Cell | Visible contract |
| --- | --- |
| calendar-fast | Direct Kasper entry: Calendar could reply before held roster; show eligible card once roster arrives |
| roster-first | Direct entry: roster completes while Calendar reply is held; same eligible queue |
| cached-reload | Keep the real cached card visible while reload waits for roster, then retain it after validation |
| roster-network-error | Show failure for rejected roster read; revisiting Review retries and restores queue |
| roster-http-error | Same contract for HTTP 503; failed response must not certify empty roster readiness |
| calendar-error | Preserve the existing unread-client failure notice and recover by revisiting Review |
| overlap-old-first | Older read completion cannot clear newer read's loading state |
| overlap-new-first | Late older snapshot cannot repaint over the completed newer read |
| mutation-during-roster | Actual approval during cached reload's roster wait cannot be resurrected by that read |

Calendar rows also contain an unlisted fictional client as a negative control;
waiting for the roster never permits arbitrary raw row slugs. The fix serializes
the roster snapshot before the Calendar request, so `calendar-fast` verifies that
the formerly dangerous completion order is prevented, not silently filtered.

The original PR #1282 `cache` cell remains the baseline/fresh-context comparison.
Its two other red cells (reopen status and client-note projection) are outside
this correction. CAS and accepted approval effects are fixture assumptions, not
server/RPC evidence. Live writers, authentication and deployed revision remain
**UNPROVEN**. No writer, auth, Samples or intake code is part of this change.


## Pinned baseline and candidate receipts

Remote main was fetched and observed at **2026-09-05T07:49:20.0698546Z**:
`a4925097aad2be1d8b4710e56da1220a19c850c5`. The old reviewer line references
were not used as authority; PR #1282's original cache cell reproduced on this base.
Its unchanged baseline ledger remains in that separate draft.

Implementation/tested head: `950bb8ce59f6ccc7d2691e64851d634bafe98c8c`.
The later handoff commit only updates this README. Candidate source was clean and
unchanged throughout both browser runs. Chromium `141.0.7390.37` timing matrix:
**2026-09-05T08:12:21.179Z to 2026-09-05T08:12:27.496Z**. Baseline: **3 PASS / 6 FAIL**;
candidate: **9 PASS / 0 FAIL**, with no skipped cells.

| Cell | Baseline | Candidate |
| --- | --- | --- |
| calendar-fast | FAIL | PASS |
| roster-first | FAIL | PASS |
| cached-reload | FAIL | PASS |
| roster-network-error | FAIL | PASS |
| roster-http-error | FAIL | PASS |
| calendar-error | PASS | PASS |
| overlap-old-first | FAIL | PASS |
| overlap-new-first | PASS | PASS |
| mutation-during-roster | PASS | PASS |

`calendar-fast` records **1** Calendar request before roster completion on the
baseline and **0** on the candidate. The existing scoped roster still filters an
unlisted fictional card. Expected/actual for each failing baseline cell are the
contracts in the matrix above: missing eligible card, missing visible roster
failure, or prematurely cleared newer loading state. No real client incidence is
claimed. Reproduce the baseline by supplying the base checkout as `--source`.

Serving was local loopback, separately checked against the document bytes:

- Baseline index SHA-256: `0fc2e652bcb03916a04c45ed8c3c40bb67940142214badacf7f898cecab89f5e`.
- Candidate index and all checked document SHA-256:
  `87d58fd0090c4db57434348afda446b04ef65e1b18f22c2f339f7399e3077f27`.
- Candidate tracked-source digest:
  `f4e85318bec45cc652ca39b55eab0877ee8c91341248523c29ffa7a9a3449b3d`.
- Baseline receipt SHA-256: `a1c4485e0415bb73556e4599cf553835bba89bd88cda8e1f94db010d7651280e`.
- Candidate receipt SHA-256: `aea550cc6aa11273d5cc590acbedc3f7651f4f3a2c8854866a9bcca0557ad89d`.
- Both timing receipts live under ignored `.codex-tmp/kasper-roster/`, in
  `2026-09-05T08-07-26-078Z-KdXX9h` and
  `2026-09-05T08-12-20-578Z-XWKwxw` respectively. Summaries record the
  fixture/runner hashes independently; private captures are not published.

At the same tested head, the unchanged PR #1282 runner passes **5/5 selected cells,
19/19 steps**: both video/graphic journeys, `cache`, `delayed-refresh`, and
`archive-race`. Receipt in that fixture checkout:
`.codex-tmp/card-lifecycle/2026-09-05T08-12-20-496Z/summary.json`;
SHA-256 `a390c5e088b3ec70fab13ed830e87d5cefc808d96596510eb9058b5fdcaa01e3`.
Other PR #1282 cells were not rerun; its reopen contract and client-note backend
projection remain separate questions, with assertions unchanged.

**Additional validation:** 23 targeted offline suites passed; the existing
visible boot lane passed **23/23 scenario groups**; the full offline suite ran
once for this correction, **399/400 suites passing**. Its sole failure is the
existing Windows absolute-drive ESM-import error in `asset-access-any-team`.
Disposable PostgreSQL execution proofs were skipped by existing local guards.
The boot/full-suite receipts bind the precommit staged source (base head above,
tracked digest `e42b9c8db0e614ec7ccd5c76f3be7a32127149862e6d1f9c8e685ec9b7701cae`,
diff digest `92486ec22832262007c20304915f44607900764958bed156f3e767910c247f51`).
Their application bytes exactly match the implementation index hash above;
only the browser driver's isolation checks were tightened afterward. These
private receipts are `checks/boot-summary.json` and `checks/unit-summary.json`
under the ignored task directory. Live drills and deployed revision are unproven.

Client-visible effect if adopted: direct entry/reload retains eligible review
cards while the roster loads; failed roster reads show the existing queue error;
revisiting Review retries; older reads cannot end a newer refresh or resurrect an
approved card. Rollback is a revert of the implementation commit, restoring the
prior timing and known omission. No data rollback or writer/auth change is involved.
Next gate: review and run against the coordinator's assembled local candidate;
any deployment/live verification is a separate authorized step.
