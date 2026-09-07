# Legacy Calendar card outcome uncertainty

This bounded G6 source correction starts at `9e75f4dcd3d5680da9d1c962498d6a79ed497922`, under the existing [execution checklist](../independence/GO_LIVE_CHECKLIST.md). No deployment, live data access or gate promotion is implied. The earlier [v1 retention checkpoint](2026-09-06-legacy-calendar-job-retention.md) remains historical evidence.

## Reproduced boundary

The actual extracted `_writeLinearVideoCardsToCalendar` and `_resumePendingCalCardJobs` functions run against a modeled receiver that records acceptance and then loses the response. On the unchanged base, an unlinked retry constructs a different card ID and produces two modeled rows. A linked retry reuses its ID but resends the initial empty caption over a modeled later human edit. These are browser-source payload failures, not observations of a production server or its triggers.

Uncertain attempts now remain in the existing `syncview_calCardJobs_v1` record without automatic replay. Historical actorless jobs with any run, heartbeat, partial completion or missing attempt counters stay held. Authority reversal cannot release that hold. Provably fresh old jobs and new first attempts retain existing provider discovery, linking and card payload behavior. No native request, actor, provider receipt or server nonacceptance is inferred.

## Persistence and completion

`_calCardJobCreate` verifies storage before the sole Submit caller proceeds with existing cleanup. Before each card transport the writer stores the exact proposed `{client, post}` fragment with an unconfirmed outcome and verifies readback. HTTP success plus `ok === true` is the positive acknowledgement boundary; the writer then persists its acknowledged attempt and completed number. This is not a server receipt or downstream-completion proof.

Pre-send storage/readback failure prevents that card send. Post-response checkpoint failure leaves the stored unconfirmed attempt, stops later cards and forbids automatic replay. Successful sibling checkpoints and attempt payloads remain for reconciliation. A partially failed first run can finish other never-attempted cards; it cannot replay the uncertain card on a later page load.

A real Web Lock per job and a short queue-store lock coordinate current callers. Every writer checkpoint compares the entire expected stored record; cleanup compares that same final record. A changed same-ID record survives, and failed cleanup reports retained/unconfirmed work. Missing Web Locks holds work without a runtime mutex fallback. The test models lock scheduling; no real multi-tab browser proof is included. Older code ignoring these locks can race between localStorage comparison and write: this is not cross-version atomic storage.

Registration failure preserves the current Submit form, last link and confirmed upstream parent receipts. After successful registration the original background behavior remains: the form may already have been cleared when a later card acknowledgement checkpoint fails. The saved v1 job, proposed card fragments and known completions remain; preservation of the entire original Submit form is not claimed.

Both legacy card notices now describe unconfirmed completion and request administrator review before recreation. They expose no client name, card ID, title, payload or raw error and give no automatic retry/Create Post advice. Existing diagnostic logging is not a new backup.

## Finite proof

`node test/legacy-card-outcome-uncertainty.js` runs **23 groups**: two unchanged-base lost-response counterexamples, corrected controls, successful first attempts, old fresh eligibility, held attempted/malformed jobs, storage/readback failures, post-ack failure, partial siblings, modeled concurrent callers, missing locks, and same-ID replacement before checkpoints and cleanup. Removing only the save comparison reproduces the reviewer's replacement defect.

The existing writer, retention, Submit durability and import-seal suites preserve their other contracts while adapting helper loading and uncertainty behavior. Three Submit controls distinguish failed registration from accepted upstream work. Four notice negatives reject false absence and unsafe recreation advice. Exact counts, hashes and commands are in the [source receipt](2026-09-06-legacy-card-outcome-uncertainty.json).

Classification: **ACTUAL_BROWSER_SOURCE_MODELED_RECEIVER**, synthetic storage/lock scheduling, zero external requests. No Chromium, PostgreSQL, installed writer, trigger, provider idempotency or real-client proof is included. Auth, Edge Functions, SQL, n8n, flags, storage-owner identity and transport selection are unchanged.

## Remaining gates and rollback

Staff reconciliation needs retained fragments plus authoritative acceptance and current-card evidence before recreation or edit. The actorless v1 record is incomplete and cannot safely receive a same-owner retry by analogy with v3. No recovery button is added. Eviction, corruption, storage loss, old bundles, nonparticipating tabs, in-flight work and original-source completeness remain held. The two n8n bypasses are unchanged. Browser localStorage is not the required durable backup.

Before real acceptance this unserved source can be withdrawn without changing clients. After uncertain attempts exist, restoring the old automatic writer can remint IDs or overwrite human edits. Preserve records and compatible uncertainty handling until reviewed reconciliation; do not clear storage, strip attempt metadata, assign a native ID or reverse authority as a retry mechanism. Combined review/CI, old-caller containment, serving and controlled live recovery proof remain required. G6 and switching off Linear remain held.
