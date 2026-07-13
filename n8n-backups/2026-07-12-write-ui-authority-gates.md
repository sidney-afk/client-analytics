# Write-UI authority gates and soak pager — public-safe n8n snapshot stub

Status: **AUTHORITY GATES LIVE; SOAK PAGER STILL STAGED.**

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

At capture, `MJbMZ789B5ExZz9x` had five simultaneous blank crashed execution records at its
deactivation timestamp and no later execution. This PR treats inactive as the mandatory preserved
state; reactivation requires a separate owner decision.

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
  applied with private pre/post snapshots. Readback is active 3-node status, active 3-node comment,
  active 94-node forms, and inactive 5-node MJb; a second dry-run reported all four installed and
  made no new version. The workload branch stayed byte-identical. The qll pager transform remains
  unapplied until its scheduled workflows merge, so draft-review time cannot create false stale pages.

## Rollback and remaining pager apply

Prerequisite: merge/deploy the `production-write` gateway PR and provision its server-private TEST
project allowlist before merging the scheduled guard-plane PR. The daily job deliberately adds no
new GitHub secrets; it discovers the sole active `kind=test` client and the gateway resolves the
allowed TEST projects server-side.

1. The four authority-gate raw pre-edit workflows and their post-write readbacks are already in the
   required private directory with hashes recorded outside the repository.
2. After both scheduled workflows merge, apply the pager transform and read back the active pager
   before the 36-hour grace starts.
3. Focused rollback: restore/publish the corresponding private pre-edit JSON. Existing mutation
   nodes are guarded, never deleted. Pager-only rollback restores the private qll pre-edit JSON or
   removes/disables only its two new aggregate summary readers.
4. Global monitoring stop remains deactivating qll. This does not change production authority.

No runtime flag, Linear record, Supabase authoritative row, or workflow activation changed. Four
n8n workflows received only the documented authority gates; MJb remained inactive. The first apply
stopped safely after two successful guarded updates when n8n rejected a legacy read-only settings
field on the form workflow; the tool now omits that server-derived field, preserves the original
private snapshots on rerun, and the final readback is complete and idempotent.
