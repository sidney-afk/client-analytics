# Linear exit — step 29c alert consolidation

**Design only.** This changes no workflow, scheduled job, relay, database, n8n automation, runtime flag, or Slack destination.

## Current alerts, in plain language

| Current alert | Plain meaning | 29c disposition |
|---|---|---|
| `monitoring_heartbeat_stale` | A scheduled safety check has not reported back when it should. | Keep only for active retained lanes; render in the digest. |
| `monitoring_lane_failing` | A scheduled safety check ran but reported a failure. | Keep only for active retained lanes; render in the digest. |
| `monitoring_selftest` | A person tested the alert route; it is not a product problem. | Manual labelled test only; never open an incident. |
| `reconcile_repair_list_size` | For two checks in a row, the Linear comparison found work it thinks needs repair. | Retire with the Linear reconcile pager: Linear is frozen. |
| `reconcile_linkage_actionable` | For two checks in a row, the Linear comparison found a link it thinks needs a fix. | Retire with the Linear reconcile pager. A native check needs native truth. |
| `reconcile_outbound_diff_count` | For two checks in a row, Linear differs from the native record. | Retire: native writes intentionally leave Linear unchanged. |
| Samples nightly | The overnight Samples test failed. | Keep the condition, replace direct webhook; split Linear-deep assertions from native evidence first. |
| Calendar nightly | The overnight Calendar test failed. | Keep the condition, replace direct webhook. |
| `n8n_quota_80` | Automation use reached 80% of this month's allowance. | Keep as one monthly quota incident. |
| `n8n_quota_90` | Automation use reached 90% of this month's allowance. | Escalate the 80% incident; do not open a second one. |
| `backup_freshness` | A verified recovery backup is overdue. | Keep. |

Only the three `reconcile_*` alerts are already semantically obsolete because native writes send Linear nothing. Watchdog alerts are not dead by themselves: they become noise only when their lanes are formally retired. The native production-write drill remains useful; remove its incidental Linear credential requirement before retaining it.

## Proposed single problem message

```text
SyncView needs attention — 3 open problems (1 new)
1. Backup: no verified recovery backup within 7 hours. First seen: 06:10 UTC.
2. Calendar nightly: last scheduled test failed. Run: <run reference>.
3. Monitoring: native notification sender has not checked in within 360 minutes.
```

One delivery is the complete set of open retained problems, not one monitor's local view. It uses the existing private operator route and only public-safe aggregates and run references. The current relay's one-line field is too short: the implementation must render a bounded multi-line digest or look up a public-safe summary by run reference. It must never silently truncate incidents.

Each stored incident has a stable key, severity, plain one-sentence summary, first/last seen timestamps, bounded public-safe evidence references, and `open`, `updated`, or `resolved` state. A stale heartbeat and a failed heartbeat stay separate because one did not report and the other reported failure.

## Trigger and quiet default

1. A retained producer records an open or materially updated incident; it does not post directly.
2. A consolidation runner coalesces for five minutes, reads all open incidents, and sends one digest for a new problem, severity increase, or material evidence change.
3. A deterministic fingerprint of ordered incident keys, severity, and evidence revision suppresses unchanged repeats.
4. A healthy result resolves only its matching incident. Recovery and healthy schedules are quiet: no all-clear or healthy-heartbeat message.
5. The manual self-test bypasses incident state and sends one labelled test message through the final relay path.

With no open retained incidents, the runner posts nothing. The consolidator itself needs a retained heartbeat/failure check with an independently observable, bounded public-safe fallback; otherwise a broken consolidator would look like a healthy quiet system. That fallback is the sole exception to the one-message rule.

## Required later changes

| Area | Later change | Guardrail |
|---|---|---|
| Incident model | Durable public-safe incident lifecycle store and shared open/update/resolve helper. | Idempotency, producer identity, bounded evidence; no client data, names, secrets, or Slack payloads. |
| Consolidator | One scheduled digest runner with offline coalescing, dedupe, resolution, and quiet-behaviour tests. | Read all open incidents; never use a producer-local latch as global truth. |
| Relay | Support bounded multi-line digest and delivery receipt. | Reject unsafe or oversize fields rather than lose incidents. |
| Watchdog | Replace direct `sendAlert` calls with incident writes; exclude lanes only when formally retired with scheduled hosts disabled. | Preserve independent stale and ran-and-failed keys. |
| Nightlies | Replace both direct `curl` posts with incident writes. | Do not degrade scheduled failures to a log-only warning. |
| Quota and backup | Replace direct posts with incident updates. | Preserve monthly threshold dedupe and verified-backup semantics. |
| Linear pager | Retire its script and scheduled caller instead of translating its drift alerts. | Disable schedule and reconcile watchdog registry in the same approved change. |
| Docs/tests | Update monitoring docs and inventory; test producer, digest, relay, retry, dedupe, and fallback path. | Use only an approved internal test destination. |

## Acceptance

Build the new path before removing any existing producer, migrate one retained producer at a time, then retire the Linear pager with its workflow. Re-run the Step 29b inventory and prove every remaining active alert has one route. Success is silence when retained checks are healthy; one complete readable message for one or many open problems; no unchanged duplicate; visible severity escalation; and independently detectable consolidator failure.
