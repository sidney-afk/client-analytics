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
