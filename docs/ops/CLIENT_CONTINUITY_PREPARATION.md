# First Samples repair: inactive monitoring and recovery preparation

Status: **implemented and exercised locally with synthetic data only**. No monitor
installed, alert sent/delivered/acknowledged, live write journey proven, schedule
enabled, workflow dispatched, deployment, flag/credential change or n8n edit.
This is a preparation package, not closure of G0/G1, T1/T3/T8 or W01/W02/W10.

Baseline: fresh remote main `13e187a7d0043ed110b486feb50502758a026229`.
Strategy: draft [#1268](https://github.com/sidney-afk/client-analytics/pull/1268),
analysis commit `c1aa4d934d1a1532632842295cddaf0b176c1b73`, current G0/G1,
T1/T3/T8 and W01/W02/W10. Its historical appendix is nonoperative. Neither that
plan nor the Samples repair is merged by this work.

## What is reusable, and what this adds

Read AGENTS.md, FIND_ANYTHING, truth/BRIEFING and APP, SYSTEM_MAP, testing/README,
ops/MONITORING and the current readers before implementation. Existing
`qa/probes/ot4_t0_client_calendar.js` and `ot4_t0_client_samples.js` exercise live
seed/write/archive journeys with private identifiers: **do not run them for this
package's local checks**. Their controls/persistence sequence informed the runner.
`scripts/slice5-test-drills.js` supplies the precedent for fresh TEST guards,
durable reservations, bounded operations and safe public reports. Its Production
adapter is not a drop-in Calendar/Samples adapter and was not invoked.

The browser suite imports the existing fully intercepted `qa/boot` harness; its
only change is exports plus a direct-entry guard. Existing standalone behavior
is retained. Source checks follow `test/calendar-get-empty-200.js` and execute
the actual reader functions from index.html. The shared relay module supplies
the actual rendered fields and correlated n8n terminal-receipt lookup.
The existing watchdog's daily/hour-scale thresholds and two GitHub-hosted
observers cannot meet W10's independent five-minute observation requirement;
they are untouched. No workflow is added, avoiding accidental activation.

New entry points:

- `node test/client-continuity-monitor.js`: offline detector, source, routing,
  liveness and disk-backed TEST runner fixtures; automatically included by npm test.
- `node test/client-continuity-monitor.js --strict-source`: release blocker;
  current main fails with seven Samples false-empty cases. Passing the ordinary
  detector suite means those defects were detected, **not that Samples is fixed**.
- `node qa/client-continuity.js`: real document/renderer, anonymous Calendar
  boot/reload, Samples legacy alias/reload/Back/Forward, cached and cold Samples
  failures, and valid-fixture-link 401/403 on both surfaces. No live backend.
- `captureView(browser, config, readCensus)` in `scripts/client-continuity-view.js`:
  prepared fresh anonymous viewing runner, no default link/config; blocks all
  mutations except the exact configured token-verification POST. Missing read
  telemetry is `integration_missing`, never green. No storage state, tracing,
  screenshots, console logging or response bodies are exported.
- `runApprovedActions(config, adapter)` in `scripts/client-continuity-actions.js`:
  gated reserve/seed/approve/comment/request-changes/readback/cleanup sequence on
  both surfaces. Fixture transport is tested; **live adapter remains required**.

## Local validation record (2026-09-04)

- Final focused monitor suite: 124 assertions passed; seven current Samples
  false-empty cases detected. Strict-source mode exits nonzero as intended until
  the coordinator repairs the source; this is not a live failure measurement.
- Focused intercepted browser suite: 8 scenarios passed. Existing full boot
  harness: 23 scenario groups passed. Existing relay, watchdog and Calendar
  empty-200 regression suites passed.
- Full `node test/run-all.js`: 396 of 397 suites passed. Unchanged
  `test/asset-access-any-team.js` fails on Windows with
  `ERR_UNSUPPORTED_ESM_URL_SCHEME` because its dynamic import uses a drive-letter
  path instead of a file URL. No unrelated portability repair is included.
  Final focused checks were rerun after the last monitor-only edits.
- Repository map: 272 passed; truth sync: 526 passed; whitespace check passed.
  No live probes, alert sends, production workflow dispatches or mutation drills.
  Raw suite logs remain local and are not PR artifacts.

## Exact coordinator integration requirements

`_sxrFetchPosts` on baseline main ignores fallback HTTP status/envelope and
substitutes missing rows with `[]`. `_calV2FetchPosts` rejects the corresponding
unusable fallback. Samples loading can therefore overwrite cache and clear the
stale warning after a failed read. This PR does not edit either product path.

Provide a read-only `window.__syncviewReadHealth(lane)` hook (or agree a different
equivalent adapter with this monitor) for Calendar and Samples. Return a bounded
snapshot with:

`version:1`, `settled`, `correlated`, `outcome:success|failure|partial`,
`display:content|empty|error`, `renderedCount`, `warningVisible`, `retryVisible`,
`verifiedAt` (epoch milliseconds of the last **complete successful read**, not
render/retry time), `complete`, and an opaque `snapshot` correlation handle.

The outcome must be recorded before fallback normalization and cache writes;
correlate primary/fallback attempts, pagination completion, client-entry lease,
surface generation and the active visible filter to that same handle. Derive
warning/retry/display/count from the **visible DOM**, including retained content,
not merely in-memory intended state. Failure, partial pages, malformed JSON,
ok:false and missing arrays must never claim complete success. Emit on cold
load, cache paint, revalidation, retry, filter change and scope/lease revocation.
Revoke the old handle before a late response can paint another scope. No client
identity, URL, token or content belongs in the hook or public telemetry.

An independent private census adapter must return `{snapshot,count,complete}`
for the exact same authorized scope/filter and snapshot. It must read the
authoritative complete population, including pagination, independently of the
browser cache. Missing, mismatched or incomplete census fails closed. This is
necessary to distinguish true empty success from unsupported count loss; counting
DOM nodes alone is not completeness proof. The hook and census do not exist in
this PR. The viewing runner therefore reports an integration gap on current main.
Retained old-bundle viewing needs a separately sealed old-bundle context adapter;
the current prepared live viewing runner starts fresh each time.

## TEST action adapter contract (release prerequisite)

No live adapter, identifier discovery or guessed client is provided. The owner
must designate the TEST scope in private configuration. The launcher supplies
`mode:'live'`, `enabled:true`, `activation:'OWNER_APPROVED_TEST_ACTIONS'`,
`testScope`, identical 40-character `releaseSha`/`approvedSha`, and an approval
`expiresAt` at most one hour ahead. All are required; default use is inactive.
Approval must be renewed explicitly, never extended by the runner.

The reviewed adapter must implement `readScope`, `mutate`, `readback`, `quiesce`
and `cleanupReadback`, with `mode:'live'` and `atomicScopeFence:true`. These are
interfaces, not evidence of server enforcement. Before activation its tests
must prove the following against an isolated server fixture:

1. Fresh exact-ID scope read before **every** mutation, including reservation,
   seed and cleanup: `id` matches owner designation, `kind === 'test'`, active,
   and a current version. No broad roster discovery or first matching name.
2. Each mutation atomically rechecks that same scope/version server-side and
   run ownership; an HTTP preflight alone has a race. A scope change must reject
   at the transaction boundary. Existing open client writers are not changed or
   re-gated to implement a probe. If no suitable atomic TEST-only adapter exists,
   live mode stays blocked pending a separately reviewed integration.
3. Reserve a unique run ledger and new synthetic card/comment identities before
   seeding; no adoption, overwrite or deletion of pre-existing data. Drive actual
   offered anonymous controls. The browser request interceptor must apply the
   per-mutation scope fence to every resulting mutation, including hidden retries,
   source repair and external-provider intent. Never allow an unclassified writer.
4. `readback` opens a fresh anonymous context and independently reads persisted
   authoritative state/receipt: same run/scope/surface/action, exact action values,
   one receipt, one comment/change request, approval state, visible after reload.
   Return `persisted`, `freshContext`, `receiptCount` only after those assertions.
   The disk fixture simulates this boundary; it is not browser write proof.
5. Five-second per-call deadlines, 90-second run admission deadline, no mutation
   retry. Propagate AbortSignal. After response loss, inspect the reservation and
   persisted receipt; never resend speculatively. `quiesce` must prove all writes
   terminal and no delayed commit can arrive before cleanup. If unproven, leave
   ledger/residue private and page; no racing cleanup. Cleanup is one bounded,
   freshly gated, run-owned operation with CAS. Preserve unrelated rows and
   concurrent changes; report conflict/residue instead of overwriting them.
6. Cleanup readback must independently prove zero owned residue and unchanged
   pre-existing data. Expired approval, drift or disabled activation also blocks
   cleanup mutations; use a later explicitly approved private recovery drill.

## Activation and timing

Release approval is **not yet given**. Before enabling anything: merge/release
approval for exact reviewed SHA, strict-source green on the repaired product,
verified serving Pages bytes, read-hook/census integration, sealed baseline
source/config/backup readback, TEST scope/adapter proof, privacy review, named
incident owner and backup, confirmed private recipients and successful drills.

Required secret references (values stay in the operator secret store):
`CONTINUITY_CALENDAR_LINK`, `CONTINUITY_SAMPLES_LINK`,
`CONTINUITY_TEST_SCOPE`, `SLACK_ALERT_WEBHOOK`, `N8N_API_KEY`,
`CONTINUITY_FALLBACK_URL`, `CONTINUITY_FALLBACK_TOKEN`. The private launcher maps
these into the functions; no env or config file is auto-loaded. Never put links
in process arguments, repo files, public run names or screenshots. Pin source SHA
and dependency versions; use isolated browser profiles with no staff credentials.

An owner-installed scheduler outside GitHub/n8n should launch viewing checks
every five minutes and approved TEST action checks every fifteen minutes, also
after approved releases. Run Calendar/Samples lanes independently so one cannot
prevent the other's terminal receipt. One transient viewing retry maximum; auth,
false-empty, count and stale-without-warning invariants page immediately. Each
worker has a two-minute hard process deadline and no overlapping run in its lane.
The action runner stops admitting operations after 90 seconds, reserving shutdown
time. Approval expiration disables action admission until the owner renews it.

Persist authenticated start and terminal receipts in a private store keyed by
random run UUID/lane/source SHA: scheduled/start/finish timestamps, closed result
code/count, delivery status and acknowledgement. The launcher must create the
start record before browser work and a terminal record in finally; killed runs
remain visibly unterminated. Do not replace last success with a failed check.
Reuse `monitoring_heartbeat` only after a separately approved compatible adapter;
this package does not write Supabase events. A queued run never masks a missing
terminal or failure.

A second scheduler/observer outside the primary scheduler and n8n must run W10
every five minutes. Feed authenticated receipts to `assessLiveness`: missing two
view checks means ten minutes, missing two action checks thirty minutes; absent
terminal after two minutes, failed checks and undelivered pages also alarm.
Critical unacknowledged incidents escalate after ten minutes. The observer needs
its own independently monitored heartbeat and separate fallback credentials.
**Neither independent scheduler, private receipt store/adapter, recipients nor
observer is installed/confirmed here.** GitHub schedule/dispatch can be redundant
execution, but queue delay, skipped cron and vendor outage preclude an exact
five-minute guarantee. Failed-run email requires notification subscription and
a successful human drill; a red GitHub job alone proves no email delivery.

## Delivery and recovery drill (later explicit owner approval)

`routeAlert` requires `enabled:true` and
`activation:'OWNER_APPROVED_DELIVERY_DRILL'`, explicit primary/fallback URLs,
fallback credential and n8n receipt-read credential. Use a fallback hosted outside
n8n and the primary scheduler; different hostname validation alone is not proof
of operational independence, which the owner must confirm. No recipients are
committed here. It reuses the typed relay, one send attempt, two correlated receipt
reads, three-second request timeouts. Relay 2xx is acceptance only. Failure or
missing delivery receipt invokes the independent authenticated fallback, which
must return matching `run_id` and `delivered:true` after downstream delivery.
Human acknowledgement remains separate. Failed fallback returns exitCode 1.

1. Privately record owner approval, release, time window and recipient acknowledgers.
2. Inject one synthetic false-empty result and one valid-link auth failure; verify
   final delivery, exact correlation UUID and human acknowledgement within ten minutes.
3. Simulate primary refusal, accepted-but-no-terminal delivery, n8n outage and
   fallback failure separately. Confirm fallback delivery/ack or independent
   failed-run email. Never disable the shared relay to cause an outage: intercept
   only this runner's transport. Record aggregate receipts, no message bodies.
4. Withhold two expected checks, then withhold a terminal receipt while new starts
   continue. Verify independent observer alarms. Test unacknowledged escalation.
5. Restore successful checks; emit `report(lane,'recovered')` through the same
   routing function only after complete read/census/readback proof. Obtain recovery
   acknowledgement and close the private incident; silence never closes it.

## Disable and recover

One-step monitoring kill: set this package's private launcher `enabled:false`
and cancel its future admissions on both schedulers. Stop only this package;
do not disable existing shared watchdog/relay workflows. Mark deactivation in the
observer before removing its lane to distinguish intentional disable from silence.
Wait for accepted operations to become terminal; preserve private ledger receipts.
Never treat monitoring disable as deletion of TEST residue or product recovery.

For an action incident, stop new action admission, preserve reservation and exact
before/after/CAS evidence, quiesce requests, then request a fresh narrowly scoped
cleanup approval. Delete/archive only run-owned fixtures after scope/ownership
and concurrent-change checks; compare pre-existing data and prove residue zero.
No broad cleanup, retry loop, flag changes or authority reversals.

For a defective G1 browser release, the coordinator restores only captured prior
Pages bytes via its reviewed release procedure and verifies exact serving hash,
anonymous read behavior, and continued approvals/comments under a later approved
TEST drill. Preserve all accepted data/receipts. Do not restore a database snapshot,
change writer auth, redeploy writers, revert team authority or resurrect legacy
write routes. Prior Samples bytes retain the known read defect: restoration is
containment, not a green G1. Rerun strict-source, affected browser regressions and
approved delivery/recovery drills before resuming the gate clock.
