# Linear — current truth

> Last verified: 2026-07-19 @ fd3e0ea + F145 review branch (Production parent-link projection staged; live Linear state unchanged)
> Live-system facts below are from `docs/audits/2026-07-05-linear.md` +
> `2026-07-05-reaudit-summary.md` (verified 2026-07-05) and `2026-07-07-linear-state-map.md`
> unless noted. Spot-verify before relying on exact counts.

## Structure

- **Two live teams: VID and GRA.** `workload_issues` additionally carries CON/STR rows —
  any "2 teams" logic needs an explicit filter.
- **State-name hazards (char-exact, will break naive matching):** VID has `"Tweak Needed "`
  with a trailing space; VID "For Client Approval" vs GRA "For Client approval" (case).
  State UUIDs stable since 2026-07-03.
- 14 users; one house integration identity performs legacy bridge mutations. ~120 new issues/week.
- ~89 non-archived projects (~75 unique clients). Open issues at last count: 1,869
  (GRA 470 / VID 1,399), 841 of them backlog/triage outside cycles; ~44% of open issues are
  zombies older than 12 months (mostly 2023 VID backlog). **137 open issues have no project**
  (client-attribution gap).
- `updatedAt` is unusable for cutoffs (bulk touches make ~95% look recent) — cut on
  `createdAt`/`completedAt`.
- **Priority IS used again** on current batches (Urgent/High/Medium) — the old "unused"
  premise is stale. Labels remain unused.
- Batch mirroring is NOT universal: true GRA+VID mirrored pairs, VID-only, GRA-only, single
  parents with mixed-team children, and bidirectional cross-team parenting all exist.
  Archived history contains legacy states ("Tweak Applied"), ghost authors, and hard-deleted
  issue ids (QA probes delete).

## What syncs today (and what doesn't)

- **Status:** app → Linear via `webhook/linear-set-status` (n8n maps app statuses to Linear
  states; bumps dueDate +2d whenever called on an overdue issue). Calendar "Posted"/"Scheduled"
  ARE pushed (`_calPushStatusToLinear()` has no guard); only SXR rejects pushing them.
- **Status pills are Linear-link-locked** on both calendar and SXR cards — component status
  flow structurally depends on a linked Linear sub-issue today.
- **Legacy Calendar/Samples card comments:** app → Linear via `webhook/linear-add-comment`,
  prefixed `**{Reviewer} (via SyncView):**`. Those card-local arrays do not receive a complete
  inbound comment/lifecycle projection; see F42/F43.
- **Current caller-auth defect (F91):** `linear-set-status`, `linear-add-comment`, `video-form`, and
  `graphic-form` authenticate no incoming principal. Their authority checks only choose whether a
  team may still write toward Linear; with both teams Linear-authoritative they permit the route.
  The `?intake=1` page deliberately bypasses staff sign-in. Contain now with an active immutable
  principal or an owner-ratified short-lived exact-client intake capability; do not wait for B5.
- **Native deliverable mirror:** the two active HMAC Edge Function webhooks subscribe to Issue +
  Comment. `linear-inbound` mirrors state, title, due date, assignee, priority, parent,
  archive/restore/delete/team linkage into native deliverables and normalizes comment lifecycle into
  `production_comments`. That does **not** make the legacy card arrays, client links, or Workload
  feed canonical. For F145, the visible Production tree projects the persisted
  `linear_raw.issue.parent.id` and resolves it through `linear_issue_uuid` across all live
  deliverables. Creation batch, team, client, and title are not parent-election boundaries;
  unresolved or malformed links remain visible roots. Parent-only webhook changes remain
  refresh-eventual through the existing B1/reconcile path rather than becoming a new n8n dependency.
- **Workload dates remain one-way from Linear:** `workload_issues.due_date` is the client deadline
  displayed by Workload and the editable-plan candidate never writes it. Internal scheduling lives
  separately in the source-only `workload_plan.plan_date` sidecar keyed by the stable sub-issue id;
  clearing that value restores exact due-date placement. No column is added to the B3-managed
  `workload_issues` mirror, and no Linear API, n8n bridge, reconciler, or due-date writer is added.
  The sidecar migration and `workload-plan` Edge Function are not applied/deployed.
- The legacy n8n inbound receiver `MJbMZ789B5ExZz9x` is **inactive/unpublished**
  (`activeVersionId=null`). Its saved graph has A1/A2 routing and authority gates, but it is not a
  current real-time producer. Calendar/Samples status healing therefore depends on the scheduled
  reconcilers unless the owner deliberately chooses, repairs, publishes, and drills that fast path.
- Reconcilers (GitHub-cron scripts): `scripts/linear-sync-reconcile.js`,
  `scripts/sample-linear-reconcile.js`, `scripts/linear-deliverables-reconcile.js`. **F122:** the
  first two print live roster/diff identifiers and copy full output into public job summaries.
  Convert logs/summaries to bounded aggregate counts/reasons before treating the cadence as a safe
  monitor; no log body was opened during the finding.
- A nightly due-date roller fires ~23:45 UTC but is **NOT in n8n** and has degraded; actor
  unknown (needs Linear admin audit log).

## Replacement program

Track B (in-app Linear replacement) spec: `docs/independence/TRACK_B_LINEAR_REPLACEMENT_SPEC.md`;
system-wide view: `docs/independence/SYSTEM_MAP.md`. The visible **Linear** tab (internal
`production`, route `#production`, alias `?prod=1`) is the native mirror surface. #812 ships
authority-gated status/comment/due/assignee controls: real teams remain read-only while authority is
Linear; the bounded active-TEST lane can write. The visible **Submit** tab retains internal key
`linear` and route `#linear`; its #813 native reroute is merged in the Phase-2 candidate and
dark-gated behind `write_ui_reroute_clients` (TEST-only allowlist; a missing/unreadable flag
deliberately fails to the LEGACY lane), while the serving legacy intake for non-enrolled clients
remains caller-unauthenticated (F91).
