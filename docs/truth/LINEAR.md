# Linear — current truth

> Last verified: 2026-07-11 @ ae8a492
> Live-system facts below are from `docs/audits/2026-07-05-linear.md` +
> `2026-07-05-reaudit-summary.md` (verified 2026-07-05) and `2026-07-07-linear-state-map.md`
> unless noted. Spot-verify before relying on exact counts.

## Structure

- **Two live teams: VID and GRA.** `workload_issues` additionally carries CON/STR rows —
  any "2 teams" logic needs an explicit filter.
- **State-name hazards (char-exact, will break naive matching):** VID has `"Tweak Needed "`
  with a trailing space; VID "For Client Approval" vs GRA "For Client approval" (case).
  State UUIDs stable since 2026-07-03.
- 14 users; `sidney@` is the integration identity. ~120 new issues/week.
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
- **Comments:** app → Linear via `webhook/linear-add-comment`, prefixed
  `**{Reviewer} (via SyncView):**`. **Inbound comment sync does not exist** (webhooks are
  Issues-only).
- **Name / due-date / assignee: NO sync in either direction.** Linear-side values reach only
  the read-only `workload_issues` mirror + a nudge banner.
- Inbound status sync: n8n workflow `MJbMZ789B5ExZz9x` (active, A1/A2 flag routing inside).
- Reconcilers (GitHub-cron scripts): `scripts/linear-sync-reconcile.js`,
  `scripts/sample-linear-reconcile.js`, `scripts/linear-deliverables-reconcile.js`.
- A nightly due-date roller fires ~23:45 UTC but is **NOT in n8n** and has degraded; actor
  unknown (needs Linear admin audit log).

## Replacement program

Track B (in-app Linear replacement) spec: `docs/independence/TRACK_B_LINEAR_REPLACEMENT_SPEC.md`;
system-wide view: `docs/independence/SYSTEM_MAP.md`. The Production tab (`?prod=1`) is the
read-only mirror surface — see `docs/truth/APP.md`.
