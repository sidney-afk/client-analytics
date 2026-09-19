# Linear exit — step 29c alert consolidation

**Design only.** This proposes a later change; it retires no alert, workflow, relay, database path, n8n automation, flag, or Slack destination.

## Coverage and named execution-map alerts

Step 29b verifies the producers listed below. The execution map also names **edge anomaly** and **mirror-events-stale**. **Edge anomaly is mapped:** `scripts/monitoring-alert-relay.js` is the verified relay that prefixes any typed alert with that phrase; it is message framing, not a separate monitor or producer.

Storage's read-only inspection verified a live `mirror_stale` producer. Its correspondence to the execution map's `mirror-events-stale` label is **provisional**, not proven: confirm the delivered message wording or payload before treating them as the same alert. Until then, neither label may be silently absorbed or retired.

| Alert | Plain meaning | Proposed treatment |
|---|---|---|
| `monitoring_heartbeat_stale` | A scheduled safety check has not reported back on time. | Keep for active retained lanes; digest item. |
| `monitoring_lane_failing` | A scheduled safety check ran but failed. | Keep for active retained lanes; digest item. |
| `monitoring_selftest` | A person tested delivery; not a product problem. | Manual labelled test outside incident state. |
| `reconcile_repair_list_size` | A Linear comparison repeatedly found work it thinks needs repair. | Do not retire yet; classify against native/legacy truth first. |
| `reconcile_linkage_actionable` | A Linear comparison repeatedly found a link it thinks needs attention. | Do not retire yet; linkage may still expose legacy dependencies. |
| `reconcile_outbound_diff_count` | Linear differs from the native record. | Candidate for retirement only after proving no retained path requires the comparison. |
| Samples nightly | The overnight Samples test failed. | Keep condition; split Linear-deep assertions from native evidence. |
| Calendar nightly | The overnight Calendar test failed. | Keep condition. |
| `n8n_quota_80` / `n8n_quota_90` | Automation use crossed 80% / 90% of the monthly allowance. | One monthly incident; 90% escalates it. |
| `backup_freshness` | A verified recovery backup is overdue. | Keep. |

Native writes leaving Linear unchanged makes outbound-difference comparisons misleading and can make repair counts noisy. It does **not** prove every repair or linkage finding is irrelevant while legacy browser queues, provider routes, foreign/legacy rows, or transition dependencies remain.

## Live pager conditions — Storage read-only inspection

The following are current live findings reported by Storage's read-only inspection. The six entries in the first table are the installed conditions from the two pager scripts; they are distinct from the retired soak definitions below. A later implementation must either route every live direct alert through the consolidated incident state and digest, or meet the measured retirement prerequisites. It must not leave a direct pager alert outside the design.

| Verified live condition | Plain meaning | Proposed path into the design |
|---|---|---|
| `incremental_refresh_stale` | The routine that keeps the incremental record current has not reported recently enough. | Retain as an incident source; replace its direct post with a digest item only in the approved implementation change. |
| `outbound_stale` | The outbound summary has not reported recently enough while outbound work is enabled. | Retain as an incident source; replace its direct post with a digest item only in the approved implementation change. |
| `outbound_failed` | One or more outbound writes failed. | Retain as an incident source; replace its direct post with a digest item only in the approved implementation change. |
| `outbound_backlog` | The queue of outbound work is both too large and still growing. | Retain as an incident source; replace its direct post with a digest item only in the approved implementation change. |
| `outbound_volume` | An unusually large amount of outbound work was written. | Retain as an incident source; replace its direct post with a digest item only in the approved implementation change. |
| `outbound_shadow_mismatch` | The outbound shadow record disagrees with what was actually written. | Retain as an incident source; replace its direct post with a digest item only in the approved implementation change. |

`outbound_oldest_pending` is defined in the repository, but Storage did not find it in the currently live pager. That is a current-state observation only; it does not establish whether it was installed at some earlier time. If it is reintroduced, the implementation must classify it explicitly before it can post or join the digest.

`mirror_stale` is also a verified live producer. It remains separately tracked until the provisional `mirror-events-stale` mapping is confirmed from a delivered message or payload. Once confirmed, it must either join the same incident state and digest or satisfy the measured retirement prerequisites; it cannot remain a parallel direct post.

### Other live checks in the same pager — exact keys from Storage's read

Storage's read-only read of the live pager workflow found these keys in the same condition-code node that emits the six conditions above, so the current producer for each is that live pager. Every message carries the same `[SyncView watcher]` prefix.

| Live key | Condition in the live code |
|---|---|
| `v2_stale` | The latest deliverables-reconcile v2 summary event is missing or older than 90 minutes. |
| `v2_nonzero` | The v2 summary reports actionable linkage (`linkage_actionable` above zero) on consecutive distinct events, or growing. Non-actionable drift is logged, not paged (owner ruling, 2026-08-21). |
| `calendar_reconcile_stale` | No completed Calendar reconciler run within 120 minutes. A run still in progress and under 30 minutes old suppresses it. |
| `calendar_reconcile_stale_not_green` | The latest completed Calendar reconciler run did not conclude `success`. |
| `samples_reconcile_stale` | As `calendar_reconcile_stale`, for the Samples reconciler. |
| `samples_reconcile_stale_not_green` | As `calendar_reconcile_stale_not_green`, for the Samples reconciler. |

These keys and conditions come from the live workflow's code, **not from a delivered message**. Storage has not observed a delivered payload for any of them. The same is true of `mirror_stale`, whose live template reads "mirror_in events stale during working hours" followed by the age and latest event, and fires on weekdays between 08:00 and 18:00 Guatemala time when the latest `mirror_in` event is missing or older than 120 minutes. Add each key as its own incident source or evaluate it against the retirement prerequisites; do not assume an existing table row covers it.

### Retired soak definitions — not live pager conditions

The six definitions in `scripts/write-ui-soak-pager.js` remain retired, not deleted, and were not counted as live by Storage's inspection: `production_write_drill_stale`, `production_write_drill_failed`, `production_write_drill_integrity`, `production_shadow_audit_stale`, `production_shadow_audit_failed`, and `production_shadow_audit_integrity`. They require a deliberate revival decision and fresh live-workflow verification before any future classification. They are not evidence of an active direct alert today.

### Reconcile-alert retirement prerequisites

A later approved retirement must establish all of these with measured evidence: (1) the scheduled reconciler and each alert class are traced to their current inputs and consumers; (2) no retained legacy browser queue, provider route, foreign-team row, repair procedure, or cutoff/recovery obligation depends on that comparison; (3) each still-actionable native condition has a defined native source and separate alert or documented owner disposition; (4) the workflow schedule is disabled and watchdog registry reconciled in the same change; and (5) the named execution-map alerts above are resolved or explicitly retained. Until then, these are retirement candidates, not obsolete alerts.

## Proposed single message and quiet default

```text
SyncView needs attention — 3 open problems (1 new)
1. Backup: no verified recovery backup within 7 hours.
2. Calendar nightly: last scheduled test failed. Run: <run reference>.
3. Monitoring: a retained lane has not checked in within its window.
```

Retained producers write public-safe open/update/resolve incident state; a consolidator reads all open incidents and sends one current digest only for a new problem, severity increase, or material evidence change. A deterministic fingerprint suppresses unchanged repeats. Healthy checks and recoveries are quiet. The manual self-test is separate. The consolidator itself needs an independently observable fallback, or its failure would look like healthy quiet. The relay must render the complete bounded digest rather than silently truncate incidents.

## Later implementation scope

Add a public-safe incident store, a consolidation runner, relay support for a bounded multi-line digest, and tests for coalescing, dedupe, resolution, fallback, and complete rendering. Move retained watchdog, nightly, quota, backup, and every verified live pager producer one at a time only after proof. The implementation inventory must include the six installed incremental/outbound conditions, `mirror_stale`, `v2_stale`, `v2_nonzero`, and the four Calendar/Samples reconciler keys listed above. Update monitoring docs and rerun the inventory. This design changes nothing now.
