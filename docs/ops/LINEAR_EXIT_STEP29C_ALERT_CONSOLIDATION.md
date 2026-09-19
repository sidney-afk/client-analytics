# Linear exit — step 29c alert consolidation

**Design only.** This proposes a later change; it retires no alert, workflow, relay, database path, n8n automation, flag, or Slack destination.

## Coverage and unresolved names

Step 29b verifies the producers listed below. The execution map also names **edge anomaly** and **mirror-events-stale**. The inventory does not identify distinct producers with either exact name. `edge anomaly` may be the relay's generic rendering of typed alerts, but that is an inference, not a verified mapping. `mirror-events-stale` may describe a stale mirror/outbox monitor, but no verified producer is named in the inventory. Both remain **unresolved** until the retirement pass traces their delivered payloads to a producer; neither may be silently absorbed or retired by this design.

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

Add a public-safe incident store, a consolidation runner, relay support for a bounded multi-line digest, and tests for coalescing, dedupe, resolution, fallback, and complete rendering. Move retained watchdog, nightly, quota, and backup producers one at a time only after proof. Update monitoring docs and rerun the inventory. This design changes nothing now.
