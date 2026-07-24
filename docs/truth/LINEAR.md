# Linear — current truth

> Last verified: 2026-07-24 @ f9fe855 + F200 owner-approved live data repair + source-only F201/F202/F203 candidates
> (F145 parent-link projection and the F200 roster/data correction are live; F201/F202 gateway/outbound/inbound
> plus F203 create additions remain gated pending their owner-approved migration/function/drill releases)
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
- ~89 non-archived projects (~75 unique clients). Open issues at the 2026-07-05 count: 1,869
  (GRA 470 / VID 1,399), 841 of them backlog/triage outside cycles; ~44% of open issues are
  zombies older than 12 months (mostly 2023 VID backlog). That snapshot had 137 open issues with no
  project. The 2026-07-23 native-mirror audit recorded **72 of 4,600 render-eligible rows
  `unattributed`** before the owner-approved F200 remediation; it remains historical evidence, not a
  current unresolved count.
- `updatedAt` is unusable for cutoffs (bulk touches make ~95% look recent) — cut on
  `createdAt`/`completedAt`.
- **Priority IS used again** on current batches (Urgent/High/Medium), but Workload no longer reads or
  displays it. SMMs may apply the exact `2× Workload` / `3× Workload` labels to difficult videos;
  they remain two or three video-capacity units, while Graphics remains 15 unweighted items.
  Source-only F201 now adds the real Linear catalog, complete native selected-label relation,
  searchable color/checkbox/description picker, guarded full-set write, and exact native Workload
  metadata path. It is not live until the separate owner-approved release gate.
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
  `production_comments`. F201 candidate source also normalizes the complete selected label IDs/nodes,
  advances a dedicated label field clock, and echo-drops only an exact full-set receipt. F202
  candidate source preserves description strings exactly, advances a description field clock, and
  echo-drops only the exact intended description. That does
  **not** make the legacy card arrays, client links, or base Workload issue feed canonical. For F145,
  the visible Production tree projects the persisted
  `linear_raw.issue.parent.id` and resolves it through `linear_issue_uuid` across all live
  deliverables. Creation batch, team, client, and title are not parent-election boundaries;
  unresolved or malformed links remain visible roots. Parent-only webhook changes remain
  refresh-eventual through the existing B1/reconcile path rather than becoming a new n8n dependency.
- **Production native creation (F203):** candidate source sends parent and sub-issue create intents
  through `production-write` and the existing outbound drainer. It validates the exact roster
  project/team/state/assignee/full-label scope, supplies one deterministic Linear UUID, and compares
  every original create field before accepting an already-existing Linear issue. A root owns one
  structural native batch; a child reuses its validated root batch and depends on the root create
  receipt when it is still pending. Acknowledgement patches only Linear ID/identifier/URL so later
  native field edits survive. No Calendar/Samples/card/link input or writer participates. This
  migration/function/UI source is not live and requires the separate owner-approved TEST release.
- **Client-attribution correction (F200):** candidate source makes the active SyncView roster the
  sole client catalog. It resolves direct mapped project → nearest mapped ancestor → owner-approved
  explicit roster/internal/TEST classification, records a mapping revision, and exposes unresolved,
  unanimous-child provisional, and conflicting families as repair states. B1 has no client-insert
  path and uses no Linear name/title identity inference; webhook project/hierarchy changes invalidate
  stale attribution and scheduled reconciliation compares project, client, hierarchy, and revision.
  On 2026-07-24, an owner-approved private 87-row CAS plan applied three active-roster project-map
  additions, one roster-kind correction, 11 direct-project resolutions, and 76 explicit roster
  classifications. It made no schema, flag, n8n, Linear, or outbound changes. Two projectless TEST
  parents remain intentionally unresolved pending owner choice; the exact private plan and row data
  are not committed. The full post-apply reconciler measured 2 current `unattributed` rows, 25
  needs-attribution states, and 2 provisional child-family states.
- **Current live Workload deadlines remain one-way from Linear.** Candidate source retains the
  isolated Admin/SMM-only `workload-linear` due-date writer for Linear-authoritative teams; Creative
  receives the same metadata but remains read-only. F201/F40 candidate source partitions metadata by
  `prod_authority`: Linear IDs use that protected reader, while SyncView IDs read native
  `deliverables.due_date` plus the complete `linear_raw.issue.labels` relation and never fall back to
  Linear. It does not change the still-foreign base issue feed, realtime, links, n8n, or frozen writers.
- Internal scheduling remains separate in the live `workload_plan.plan_date` sidecar keyed by the
  stable sub-issue id; clearing that value restores the item-local automatic day derived from the
  Linear deadline. No workload weight or deadline override is stored in that sidecar.
  The sidecar migration and Admin/SMM-authenticated `workload-plan` writer are live; release
  readback proved the mirrored deadline byte-identical before/after the private TEST set/clear cycle.
  Candidate source widens only the function's global plan projection to Creative so every staff role
  sees the same saved plan after manual deployment; Admin/SMM remain the only plan-date writers.
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
authority-gated status/comment/due/assignee controls; F201 candidate source adds protected label
catalog reads and Admin/SMM full-selected-set label writes, and F202 candidate source adds
Admin/SMM exact-Markdown description writes for root and child deliverables. F203 candidate source
adds Admin/SMM Production-only parent/sub-issue creation with deterministic replay and zero implicit
Calendar/Samples linkage. Real teams remain read-only while
authority is Linear; the bounded active-TEST drill stays service-only and is the sole path allowed
to seed a missing pre-F201 native selection from a complete Linear snapshot. The visible **Submit** tab retains internal key
`linear` and route `#linear`; its native reroute landed through PR #850 / `9968bd9` and is
dark-gated behind `write_ui_reroute_clients` (last verified TEST-only allowlist; a missing/unreadable flag
deliberately fails to the LEGACY lane), while the serving legacy intake for non-enrolled clients
remains caller-unauthenticated (F91).
