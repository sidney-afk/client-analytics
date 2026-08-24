# Slack creative-channel migration — n8n status (2026-08-24)

Covers two work sessions on 2026-08-24: the initial Roam→Slack rebuild (docs in PR #1125)
and a same-day fix pass triggered by a live smoke test (docs in PR #1126), which caught and
corrected two real bugs left over from the initial build.

## Process gap (disclosed, not hidden)

**No private pre-edit JSON export was taken before any of the edits below**, contrary to
ROLLBACK.md rule 2. This session runs in an ephemeral cloud container with no access to
Sidney's private weekly-backup Drive folder or local `private-backups/` path used by prior
sessions (see e.g. `n8n-backups/2026-07-06-n8n-hardening-status.md`), and a same-session
attempt to hand-transcribe the full workflow JSON into this repo as a substitute produced
JSON that failed `jq` structural validation twice on a 35-node workflow before the attempt
was abandoned as unreliable — a bracket-balanced-but-silently-wrong "backup" would be worse
than none, so nothing unverified was committed.

**What stands in for it:** n8n's own built-in version history is authoritative and durable
independent of this repo. Every version ID below can be fetched byte-exact at any time via
the n8n MCP `get_workflow_version` tool, and any of them can be made live again via
`restore_workflow_version` + `publish_workflow`. This is more reliable than a hand-copied
file would have been, but it is **not** the private-Drive-folder capture the rule calls for,
and it does not help with the one workflow below that is now unreadable (archived).
Recommend a real Drive export be taken for these four workflows the next time a session with
Drive/local-filesystem access touches them.

## Workflows touched

| Workflow | ID | Active | Pre-session version | Current version |
|---|---|---:|---|---|
| Client — Onboarding Provisioning | `t2RP7QNHrbQx52f4` | true | `4e35a740-f961-4ce6-9f60-29d72ba4915e` (2026-08-20, "Auto-advance to Closed Won after form") | `baabd198-8d3e-4fe6-92b1-84f5440fac00` |
| Sales — Call Booked (iClosed) | `xoPqojySDriQ8Mzh` | true | `328a77fc-5124-4439-a811-ef773ed1a205` (2026-08-12, "Attach Telegram credential") | `d9d981ec-f133-429d-972a-729189612a99` |
| Client — Slack Creative Channel Finalizer (new) | `udkwwzdFuPW3K2CE` | true | n/a — created this session | `924a9ab7-e3e8-407f-b9fb-0fc1dd51fd41` |
| Client — Roam Creative Group Finalizer | `8LN6ReEIPhhWxA6v` | **archived** | not captured (see gap below) | n/a — archived workflows return `"is archived and cannot be accessed"` from every n8n MCP read tool, including `get_workflow_history` |

For all three accessible workflows, `versionId === activeVersionId` was confirmed via
`get_workflow_details` after every publish in this status file — the live/active version is
the one listed under "Current version" above, not sitting unpublished in draft.

## Edits applied, in order

| Workflow | Change | Version after |
|---|---|---|
| `t2RP7QNHrbQx52f4` | Retargeted the onboarding queue from Roam to Slack, inlined account-access credentials into the kickoff message, added the `**`→`*` Slack-mrkdwn fold. **First attempt used `setNodeParameter` with a JSON-Pointer path, which silently wrote into a dead nested `parameters.parameters.*` key instead of the real field** — none of it was actually live. | `fcd12cd3-…` (broken, superseded) |
| `t2RP7QNHrbQx52f4` | Redone with `updateNodeParameters` (merge semantics) targeting the correct top-level fields, then republished. Read back afterward to confirm the real fields changed. | `baabd198-…` (current) |
| `xoPqojySDriQ8Mzh` | Removed the Roam chat leg (`Read Kasper Roam Identity` → `Send Kasper Roam Booking Alert`) from Kasper's booking alert; Telegram alone remains. Republished — this workflow had the same publish-gap issue as above (edit landed in draft, live traffic kept running the old graph until `publish_workflow` was called explicitly). | `d9d981ec-…` (current) |
| `udkwwzdFuPW3K2CE` | Built from scratch: queue → readiness gate (Clients Info + SMM assignment + filming plan) → create public `{client}-creative` channel → invite roster → verify → write back `creative_channel_id` → read-back verify → post kickoff → post full brief, with every uncertain step routing to a shared manual-reconciliation DM. Mirrors the archived Roam finalizer's safety pattern. | `b15815f2-…` |
| `udkwwzdFuPW3K2CE` | Rebound all Slack nodes from an auto-assigned placeholder credential to the real `SyncView Bot` credential used elsewhere in the instance. | `55ddf4c4-…` |
| `udkwwzdFuPW3K2CE` | **Real bug, caught by a live smoke test**: roster verification used `channel:get` + `includeNumMembers`, but that field does not reliably come back from Slack on this node version — a real execution's response contained no `num_members` at all, which would have parked every real onboarding in manual reconciliation forever. Switched to `channel:member` (`returnAll:true`) with exact required-ID matching. | `7b090799-…` |
| `udkwwzdFuPW3K2CE` | **Second real bug, also caught live**: the `channel:member` operation returns each member as `{"member":"U…"}`, not `{"id":"U…"}` as assumed — the roster check was reading the wrong field and would have flagged everyone as missing even with a correct invite. Fixed and re-verified against real Slack (smoke test returned `all_present:true`, zero missing). | `924a9ab7-…` (current) |
| `8LN6ReEIPhhWxA6v` | Archived (not deleted) now that its replacement is live. | n/a — archived |

## Rollback

- **Onboarding Provisioning**: `restore_workflow_version("t2RP7QNHrbQx52f4", "4e35a740-f961-4ce6-9f60-29d72ba4915e")` then `publish_workflow` restores the pre-migration Roam-queuing behavior. **Caveat: this alone is not a full rollback** — the workflow that used to drain that Roam queue (`8LN6ReEIPhhWxA6v`) is archived and could not be reactivated by this session (no unarchive tool was available via the n8n MCP surface used here). Restoring only the provisioning side would queue Roam jobs nothing processes. Full rollback needs the Roam finalizer reactivated first, from the n8n UI directly.
- **Sales Call Booked**: `restore_workflow_version("xoPqojySDriQ8Mzh", "328a77fc-5124-4439-a811-ef773ed1a205")` then `publish_workflow` brings back the Roam+Telegram dual alert to Kasper exactly as it was.
- **Slack Creative Channel Finalizer**: `restore_workflow_version("udkwwzdFuPW3K2CE", "<prior versionId>")` then `publish_workflow` to step back one fix at a time. To stop it entirely, deactivate (do not archive) — queued jobs will sit safely `pending`, but note `DM Brief Fallback` in the Onboarding Provisioning workflow only fires on an enqueue-time failure, not on "nothing is draining the queue," so pending jobs would need manual attention if this workflow is turned off without a replacement.
- **Roam Creative Group Finalizer**: cannot be reactivated by this session (archived workflows are unreadable via every n8n MCP tool tried, including a direct `get_workflow_details` read). Reactivating it, if ever needed, requires the n8n UI directly.
