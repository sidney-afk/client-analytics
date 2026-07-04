# 2026-07-04 A3 Linear bridge preflight

Public-safe notes from the overnight A3 preflight. No A3 code was written, no workflow was edited,
no runtime flag was changed, and no real client was enabled.

## Scope checked

A3 covers the remaining Linear bridge endpoints:

- inbound `linear-status-sync`
- outbound `linear-set-status`
- outbound `linear-add-comment`
- outbound/read `linear-issue-statuses`

The locked Track A spec says these are mechanical ports only. The inbound port must use Linear
HMAC verification over the raw body and replay protection, then preserve the three live branches:
calendar patch, samples patch, and `workload_issues` upsert. The outbound ports keep the current
frontend outboxes and reconciler backstops.

## Live n8n state observed

Checked via n8n MCP on 2026-07-04. Raw workflow bodies were not copied into this repo because the
live code-node output contains secret-shaped values.

| Workflow | ID | Observed state |
|---|---|---|
| SyncView Calendar - Linear Status Sync | `MJbMZ789B5ExZz9x` | Active, version `405ab03a-12bb-43ca-b70a-14aee3ba7f35`; contains calendar, workload, and samples branches. |
| SyncView Calendar - Linear Set Status | `VQqqeY9B2GZbh2Bt` | Active, version `f3ec2123-17a0-4aea-b01d-983c9483dd07`; maps SyncView status to team state and keeps the overdue due-date bump behavior. |
| SyncView Calendar - Linear Add Comment | `8stSpZUiyG7f2LQX` | Active, version `6798ea93-5819-46aa-b618-bde8bb451571`; formats comments as SyncView-originated Linear comments. |
| SyncView Calendar - Linear Issue Statuses | `GP8CSZDNcy5sGdFr` | Active, version `2203cdde-62a2-492d-a3fc-27119430a773`; batched status/meta lookup with per-id fallback for poisoned batches. |

Execution health since `2026-07-04T00:00:00Z`:

- `linear-status-sync`: no error/crash executions returned in the small error check.
- `linear-set-status`: no error/crash executions returned in the small error check.
- `linear-add-comment`: no error/crash executions returned in the small error check.
- `linear-issue-statuses`: one error execution was observed, execution `198719`, from
  `2026-07-04T11:30:36Z` to `2026-07-04T11:31:36Z`. A later success search returned 365
  successful executions after that point, so this currently looks isolated. Full failed payload
  data was not pulled because execution details may expose sensitive node parameters.

## Repo fan-in found by symbol

Frontend constants live in `index.html`:

- `LINEAR_SET_STATUS_URL`
- `LINEAR_STATUSES_URL`
- `LINEAR_ADD_COMMENT_URL`

Calendar browser paths:

- `_linearOutboxFlush` retries queued status/comment pushes through `linear-set-status` or
  `linear-add-comment`.
- `_calPushStatusToLinear` sends direct status pushes and falls back to the durable outbox.
- `_calPostLinearComment` sends direct comment pushes and falls back to the durable outbox.
- `_calRefreshParentLinkFlags` reads `linear-issue-statuses` for parent/sub-issue metadata.
- `_calReconcileLinearStatuses` reads `linear-issue-statuses` only for the legacy non-v2 path.

Samples browser paths:

- `_sxrLinearOutboxFlush` retries queued status/comment pushes through the same two outbound
  endpoints.
- `_sxrPushStatusToLinear` sends direct status pushes and skips `Scheduled`/`Posted` because
  samples do not have those lifecycle states.
- `_sxrPostLinearComment` sends direct comment pushes.

Reconciler paths:

- `scripts/linear-sync-reconcile.js` reads `linear-issue-statuses` and writes `linear-set-status`.
- `scripts/sample-linear-reconcile.js` reads `linear-issue-statuses` and writes
  `linear-set-status`; sample pull-to-card writes route through the A2 sample-review runtime flag.

## Preflight risk

The outbound Linear endpoints are not currently client-scoped at the request boundary:

- `linear-set-status` payloads are `{ issue, status }`.
- `linear-add-comment` payloads are `{ issue, body, author }`.
- `linear-issue-statuses` payloads are `{ issues: [...] }`.

That means a TEST-client-only canary cannot be implemented safely by endpoint URL replacement alone.
Before A3 code, the routing design needs to either:

- add an explicit client slug to all browser/reconciler outbound payloads and make missing/unlisted
  clients fall back to n8n, or
- keep outbound Linear endpoints entirely on n8n until a global cutover gate, which is a larger
  blast radius and needs owner approval.

For old durable outbox entries that lack a client slug, the fail-safe behavior must remain n8n.

The inbound `linear-status-sync` has a different deployment model: the spec requires a second Linear
webhook pointing at the Edge Function in dry-run/shadow mode, covering all public teams or at least
VID and GRA, with comparison evidence before disabling the n8n webhook.

## A3 prerequisites before implementation

- A2 PR #670 must be owner-reviewed, merged, deployed, and gated before A3 starts.
- Take private raw n8n exports for all four A3 workflows immediately before any edit.
- Keep public docs to status summaries only; do not commit raw workflow JSON or Linear/Supabase
  secrets.
- Move the Linear API key into Supabase Edge Function secrets, not source code.
- Add a shared Edge Function status-map module plus a CI drift test against
  `_calMapLinearStatusStrict` and `CAL_PRIORITY` extracted from `index.html`.
- Build byte-parity harnesses for all four endpoints and include Linear-status edge cases:
  trailing-space/casing variants, missing state skip, overdue due-date bump, comment format,
  poisoned batch fallback, missing issue behavior, and sample `Scheduled`/`Posted` null mapping.
- For inbound shadow mode, compare expected patches for calendar, samples, and workload branches
  without writing until the owner approves the canary.

## Gate status

A3 is blocked at the normal owner gate. The safe next owner review item is A2 PR #670. No A3 code
should be written or deployed until the A2 gate is closed and the outbound client-routing decision
above is approved.
