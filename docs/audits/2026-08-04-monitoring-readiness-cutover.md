# 2026-08-04 — Monitoring readiness before the Graphics cutover

Scope: make the watchers that are supposed to guard the Graphics move off Linear
actually report a failure. The readiness audit listed five symptoms. Three of
them turned out to be one bug.

Everything below is public-safe: run handles, aggregate counts, team keys and
timestamps only.

---

## 1. The single bug behind three symptoms

`SLACK_ALERT_WEBHOOK` points at the n8n relay `Tfhc3vebZyG6obOg`
(`SyncView Edge Alert Relay -> DM Sidney`), not at a Slack incoming webhook.
Two consequences compounded.

**The success predicate.** `postSlack` required the response body to be
literally `"ok"`. That is a Slack-incoming-webhook contract. The relay answers
`200` with a JSON envelope, so the check threw **after** the POST had already
been accepted. In `linear-reconcile-inbound-pager.js` that throw happened
before `insertMarker`, so the incident never latched — and an unlatched
incident re-pages on the next scheduled run, forever.

**The payload shape.** The relay does not echo `text`. Its webhook node
`Receive Edge Alert` renders its own line from named fields:

```
[SyncView] Edge anomaly alert: type=<type> issue=<issue_identifier> team=<team> count=<count> run_id=<details.run_id>
```

defaulting the first three to `edge_alert` / `unknown` / `unknown`. Callers
posting `{ text }` alone therefore delivered a message containing nothing.

That is the whole of symptom 4 — the ~20-25 identical contentless owner DMs a
day — and it explains symptom 2. The alarm had **not** never fired. It had
fired on every scheduled run, arrived every time, and carried none of its
content, which is why searching Slack for its text found zero. Roughly 13
scheduled reconcile runs a day × 2 nonzero alert classes (`repair_list_size`,
`linkage_actionable`) ≈ 26 messages/day, matching the observed volume and its
irregular ~1–2 h spacing.

The contract above was **read back off live delivered messages**, not guessed.
`scripts/n8n-execution-quota-watchdog.js` was already sending the typed shape,
and its DMs render in full:

```
[SyncView] Edge anomaly alert: type=n8n_quota_80
  issue=month_2026-07_used_109287_cap_135000_remaining_25713_pct_81.0
  team=account count=109287 run_id=29268930214-1-80
```

### Fix

`scripts/monitoring-alert-relay.js` is now the only path repository monitors
use to reach the relay. It sends the typed shape, treats **HTTP 2xx** as
acceptance, and — when `N8N_API_KEY` is present — correlates the relay's
terminal execution by `details.run_id`, so acceptance is never reported as
delivery. Callers migrated: the reconciler pager and the Track-B backup
freshness alert.

### Two further relay properties, found only by delivering

The first real page showed the relay also **rewrites every non-alphanumeric
character to `_`** and **truncates the rendered summary at ~96 characters**.
The dead-man's-switch page lost two of its four lane names to that, silently.
Summaries are now assembled from an ordered, most-important-first list,
normalised locally to the relay's own alphabet, and anything trimmed is
announced in the message as `plusNmore`. A partial page that reads as complete
is its own failure mode.

---

## 2. Nothing alerted on failing to look

Every watcher in the repository alerted on what it **found**. None alerted on
not running. A crashed, unscheduled or silently disabled checker produced the
same signal as a healthy system: nothing. Both long outages below ran their
entire length inside that blind spot.

`scripts/monitoring-watchdog.js` adds `monitoring_heartbeat` events per lane —
written pass **or** fail, because a heartbeat proves the lane *ran*, not that
it passed — and pages when any lane's newest heartbeat exceeds its
`max_age_minutes`. A lane that has **never** checked in counts as stale; that
is precisely the lane nobody notices is dead. Pages latch per lane, so one dead
lane can neither spam nor mask another, and un-latch on recovery.

The watchdog is itself a lane and runs from two independent workflows —
`monitoring-deadman.yml` and the reconciler workflow — so each reads the
other's heartbeat and one dead workflow is still audible.

**Residual:** a total GitHub Actions outage silences both halves. Closing that
needs an observer outside Actions and is not something a workflow inside
Actions can do.

---

## 3. The refresh cursor could advance past work it never did

Three row kinds share the `linear_incremental_refresh` action:

| kind | `ok` | `finished_at` |
|---|---|---|
| terminal success summary | `true` | present |
| terminal failure summary | `false` | present |
| per-row deliverable write | absent | absent |

`latestIncrementalEvent()` took the newest of all three. A failed run stamped
`finished_at` and the next run started from it, so the failed run's window was
skipped and never re-read — the 2026-07-28 incident, and F131's
"advance/look green despite unwritten work".

The query now filters `payload->>ok=eq.true` and requires `finished_at`, which
excludes failure summaries and per-row events in one predicate. After a
failure the next window therefore starts at the last **success** and re-reads
the dropped span automatically. The filter was verified against live PostgREST
(HTTP 200, 1 row) before the scheduled lane was allowed to depend on it.

`scripts/b1-cursor-gap-report.js` reconstructs both cursor rules from the
summary ledger and asks Linear which dropped changes are still outstanding.
It is read-only against both systems. See §5 for its result.

---

## 4. The daily self-test proved nothing for three weeks

`production-write-drill` failed **22 consecutive nights** (2026-07-14 →
2026-08-04), every one at `video_verification`, on a description round-trip
that depends on an undeployed Edge Function revision. Because the drill
iterates Video first, **Graphics was never reached** — the only end-to-end
proof that graphics comments and status changes still flow was absent for the
entire period, while the workflow merely looked "red".

Nothing published said which check failed: 22 runs emitted only
`error_code: video_verification`. That is most of why it stayed broken.

The round-trip is now **parked, not deleted**, behind
`PRODUCTION_WRITE_DRILL_DESCRIPTION_ROUNDTRIP`. In the default `observe` mode
it is still attempted on a short budget and its real per-team outcome is
recorded — `parked_pending_deploy` while undeployed, the proved scope the
moment it starts passing. Every report carries `parked_assertions`, so a green
run cannot quietly cover less than the last one. Setting the variable to
`enforce` re-arms the blocking assertion with no other change.

Red runs also emit an allowlisted `error_class`; backend rejections classify by
surface, operation, HTTP status and machine code, and anything not matching a
known shape degrades to `unclassified` rather than carrying a response body
into a public artifact.

---

## 5. Findings this work uncovered

**A second Graphics failure was hiding behind the first.** With the description
round-trip parked, run `30945918826` became the first drill since 2026-07-13 to
complete Video (`teams_completed: 1`, `description_readback_scope.video:
parked_pending_deploy` — the gate behaving exactly as designed). It then failed
at `graphics_mutations` after the graphics fixture was created but before its
first status write completed (`operations_completed: 11` = Video's 10 plus the
Graphics create). This is a real defect on the write path of the team being
moved, and it was invisible for three weeks because an unrelated assertion
failed earlier in the run.

**Symptom 2 was mis-stated, and the correction matters.** The alarm was not
silent — it was loud and empty. Anything that reasoned from "it has never
fired" (including any inference that drift never persisted for two runs) should
be re-examined: `repair_list_size` and `linkage_actionable` have been nonzero
and paging for some time.

---

## 6. What is still open

- **F203 — description round-trip.** Parked pending an owner-gated Edge
  Function deploy. Flip `PRODUCTION_WRITE_DRILL_DESCRIPTION_ROUNDTRIP=enforce`
  after it lands.
- **Graphics status-write failure.** Newly visible, not yet diagnosed.
- **Other `{ text }`-only callers of the shared secret** (notably the
  onboarding fallback, F81) will keep producing contentless DMs until their
  payloads are fixed and redeployed — an owner-gated Edge Function deploy, not
  a repository change.
- **F131 remainder.** Distinct success-only event types, server run ID /
  high-water, exact count validation, and paging on a missing or
  count-mismatched terminal summary. Only the cursor half is closed.
- **Dead-man's-switch residual.** No observer outside GitHub Actions.
