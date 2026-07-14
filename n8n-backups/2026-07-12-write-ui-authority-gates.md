# Write-UI authority gates and soak pager — public-safe n8n snapshot stub

Status: **ACTIVE MUTATION GATES LIVE; MJb SAVED GATE INACTIVE; SOAK PAGER STILL STAGED.**

Raw workflow JSON is excluded because this repository is public and the live workflows contain
secret-shaped material. Before `--apply`, both transform tools require
`N8N_PRIVATE_BACKUP_DIR` to resolve outside the repository. They snapshot every affected workflow
before the first PUT, then snapshot and verify each readback. The owner keeps those private files.

## Read-only live preconditions captured 2026-07-13 UTC

| Workflow | Live state at capture | Guarded node hashes / invariant |
|---|---|---|
| `VQqqeY9B2GZbh2Bt` — Linear Set Status | active; version `0976710e-e56b-4707-b736-f1264f058b57` | `Apply Status to Linear`: `8d4d9c201d071e97f5cb79839789d91a4a6f4c29d1c6bfda4f75fc34ba7ab7ee` |
| `8stSpZUiyG7f2LQX` — Linear Add Comment | active; version `6798ea93-5819-46aa-b618-bde8bb451571` | `Post Comment To Linear`: `534b05750713de240047317f7613e0a92f65c80560f5c1c1ca1cc7fdd14229b5` |
| `BrJSe8zCKUccfmIq` — form monolith | active; version `0efdd2c7-a71e-43a7-8280-adc18934b526` | Both per-SMM key-lookup node hashes are pinned in the transform; the new guards must be the first nodes after `video-form` / `graphic-form`. |
| `MJbMZ789B5ExZz9x` — legacy Linear status sync | **inactive**; version `655b6aa5-e571-451e-8f65-f4fcf78aff02` | Calendar `4f33e9c…`, workload `1f555e6a…`, samples `6bb2df80…`; workload must remain byte-identical and the transform must not activate the workflow. |
| `qllIDZPkdNAPRj0b` — monitoring pager | active; version `16a436c6-5b49-4baa-9630-978cee2854a2` | `Check Pager Conditions`: `8c7837545f05e52111f3571352f9cebb5fd27094440880c0cf5c52e90f8dd4f0` |

The wider 2026-07-13 execution readback found **24** clustered crashed webhook records ending
2026-07-12 23:03:59 UTC (21 with no start and three started without a node), followed by no later
execution. This stub treats inactive as the mandatory preserved state. Reactivation requires a
separate owner topology decision, crash/soft-error explanation, intentional publish, and TEST drill.

## Applied authority transforms and staged pager

- `scripts/write-ui-n8n-authority-gates.js` gates the four public mutation webhook paths and only
  the calendar/sample write branches of MJb. Authority reads are shape-validated, store a
  last-known-good value in workflow static data for diagnostics, and freeze mutations on **every**
  non-live read. A cached pre-flip `linear` value can never authorize a stale request after a flip.
- Set-status/comment return the existing success response while Linear-authoritative, HTTP 409
  after their team flips to SyncView, and HTTP 503 on a cold authority failure. The fixture suite
  explicitly simulates the same stale queue request across those three stances. Form webhooks now
  wait for the same authority decision: accepted requests preserve their HTTP 200 and unchanged
  downstream graph, while blocked requests terminate before any project/key lookup or issue
  creation with a public-safe HTTP 409/503 response.
- `scripts/write-ui-soak-pager.js` adds aggregate-only readers for `production_write_drill` and
  `production_shadow_audit`. It does not dispatch either workflow or change any runtime flag.
- Both live dry-runs passed against the exact preconditions above. The authority transform was then
  applied with private pre/post snapshots. Readback is active 3-node status (current active version
  prefix `2ab7e91f…`), active 3-node comment (`f214d351…`), active 94-node forms (`d867fa43…`),
  and inactive 5-node MJb (`activeVersionId=null`); a second dry-run reported all four installed and
  made no new version. The workload branch stayed byte-identical. The scheduled write drill/shadow
  workflows have since merged; qll's soak-reader transform remains unapplied pending a fresh
  active-version/node-hash preflight and explicit owner apply/readback.

## Rollback and remaining pager apply

The gateway, guard plane, and daily schedules are already merged/deployed. The daily job adds no
new GitHub secrets; it discovers the active private TEST fixture and the gateway resolves allowed
TEST projects server-side. This dated capture is not authority for a later qll graph.

1. The four authority-gate raw pre-edit workflows and their post-write readbacks are already in the
   required private directory with hashes recorded outside the repository.
2. Before any soak-reader apply, privately snapshot the **current** qll active version, verify its
   current node hashes/topology (including live outbound dispatch/watchers), run the transform
   dry-run against that exact graph, obtain owner approval, then apply and read back the new active
   version/node hashes. Only then may the 36-hour grace start.
3. Focused rollback for an **active mutation workflow**: restore/publish the corresponding private
   pre-edit JSON. Existing mutation nodes are guarded, never deleted. Do not publish either MJb
   snapshot as a rollback until its separate topology decision is resolved. Pager-only rollback
   restores the private qll pre-edit JSON or removes/disables only its two aggregate summary readers.
4. Global monitoring stop remains deactivating qll. This does not change production authority.

No runtime flag, Linear record, Supabase authoritative row, or workflow activation changed. Four
n8n workflows received only the documented authority gates; MJb remained inactive. The first apply
stopped safely after two successful guarded updates when n8n rejected a legacy read-only settings
field on the form workflow; the tool now omits that server-derived field, preserves the original
private snapshots on rerun, and the final readback is complete and idempotent.
